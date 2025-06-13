# backend/app/worker.py
# ─────────────────────────────────────────────────────────────────────────────
import logging
import datetime as dt
import uuid
from pathlib import Path
import shutil
import subprocess

from celery import Celery
from celery.signals import worker_ready
from faster_whisper import WhisperModel
from groq import BadRequestError, Groq
import openai
from sqlmodel import Session, select, func, create_engine

from .config import settings
from .models import Meeting, MeetingChunk
from .templates import TEMPLATES

# Configure Celery
celery_app = Celery(
    "worker_tasks",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.worker"],
)

celery_app.conf.update(
    task_track_started=True,
    broker_connection_retry_on_startup=True,
)

_whisper_model_instance = None
_db_engine_instance = None
_groq_client = (
    Groq(api_key=settings.groq_api_key) if settings.recognition_in_cloud else None
)


LOGGER = logging.getLogger("celery_worker")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s][%(module)s.%(funcName)s:%(lineno)d] %(message)s",
)


def get_db_engine():
    global _db_engine_instance
    if _db_engine_instance is None:
        LOGGER.info("Initializing DB engine for Celery worker.")
        _db_engine_instance = create_engine(f"sqlite:///{settings.db_path}", echo=False)
    return _db_engine_instance


def get_whisper_model():
    global _whisper_model_instance
    if _whisper_model_instance is None:
        LOGGER.info(
            "🔊 Loading Whisper model (%s) in Celery worker…",
            settings.whisper_model_size,
        )
        _whisper_model_instance = WhisperModel(
            settings.whisper_model_size, device="cpu", compute_type="int8"
        )
        LOGGER.info("✅ Whisper model loaded in Celery worker.")
    return _whisper_model_instance


@worker_ready.connect
def load_whisper_on_startup(**kwargs):
    get_whisper_model()


def transcribe_webm_chunk_in_worker(chunk_path_str: str) -> str:
    """
    Transcribes an audio chunk using either a cloud API (Groq) or a local model.
    - For cloud transcription, it first converts the chunk to a standardized
      16kHz mono FLAC file using ffmpeg for maximum compatibility and speed.
    - For local transcription, it uses the faster-whisper model with VAD.
    """
    chunk_path = Path(chunk_path_str)
    whisper = get_whisper_model()

    try:
        if settings.recognition_in_cloud:
            path_to_transcribe = chunk_path
            output_flac_path = None

            # Best practice: Convert to a standard format (16kHz mono FLAC) for cloud APIs.
            if shutil.which("ffmpeg"):
                output_flac_path = chunk_path.with_suffix(".flac")
                try:
                    # ffmpeg command to convert to 16kHz mono FLAC
                    command = [
                        "ffmpeg",
                        "-i",
                        str(chunk_path),
                        "-y",  # Overwrite output file if it exists
                        "-vn",  # No video
                        "-ac",
                        "1",  # Mono audio
                        "-ar",
                        "16000",  # 16kHz sample rate
                        "-sample_fmt",
                        "s16",  # 16-bit samples
                        str(output_flac_path),
                    ]
                    subprocess.run(command, check=True, capture_output=True, text=True)
                    path_to_transcribe = output_flac_path
                    LOGGER.info(
                        f"Successfully converted {chunk_path.name} to FLAC for cloud transcription."
                    )
                except subprocess.CalledProcessError as e:
                    LOGGER.error(
                        f"ffmpeg conversion failed for {chunk_path.name}: {e.stderr}. Will attempt to send original file."
                    )
                    # Fallback to original path if conversion fails
                    path_to_transcribe = chunk_path
                finally:
                    # The file will be cleaned up after the API call
                    pass
            else:
                LOGGER.warning(
                    "ffmpeg not found. Sending original WebM file to cloud API. Install ffmpeg for better results."
                )

            try:
                with open(path_to_transcribe, "rb") as audio_file:
                    resp = _groq_client.audio.transcriptions.create(
                        file=(path_to_transcribe.name, audio_file.read()),
                        model="whisper-large-v3",  # whisper-large-v3-turbo is not a valid model
                        response_format="verbose_json",
                    )
                LOGGER.info(
                    f"Cloud transcription succeeded for {path_to_transcribe.name}"
                )
                return resp.text.strip()
            finally:
                # Clean up the temporary FLAC file if it was created
                if output_flac_path and output_flac_path.exists():
                    output_flac_path.unlink()

        else:  # Local transcription
            segments, _info = whisper.transcribe(
                str(chunk_path),
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(
                    threshold=0.1,
                    min_silence_duration_ms=500,
                    speech_pad_ms=300,
                ),
            )
            return " ".join(s.text for s in segments).strip()

    except Exception as e:
        LOGGER.error(
            f"Celery Worker: Failed to transcribe {chunk_path.name}: {e}", exc_info=True
        )
        return ""


def summarise_transcript_in_worker(text: str, started_at_iso: str) -> str:
    if not text or len(text.strip()) < 10:
        return "Recording too short to generate a meaningful summary."

    if not openai.api_key:
        openai.api_key = settings.openai_api_key

    try:
        started_at_dt = dt.datetime.fromisoformat(started_at_iso.replace("Z", "+00:00"))
        date_str = started_at_dt.strftime("%Y-%m-%d")
        time_range = f"{started_at_dt.strftime('%H:%M')} - {dt.datetime.now(dt.timezone.utc).strftime('%H:%M')}"

        system_prompt = f"""
You are MeetScribe, an expert meeting-summary generator.

RULES
• Pick (or merge) the best-fit template 1-7 from TEMPLATES below.
• For all other recordings choose the layout that reads best:
    – **Paragraphs** for conversational / explanatory / narratory parts.  
    – **Bullet lists** for discrete points (**each bullet must be 1-2 full sentences**).
• Translate **all headings and body text** into the dominant language of the recording.
• Replace every placeholder  
  [YYYY-MM-DD] → “{date_str}”, [HH:MM–HH:MM] → “{time_range}”, etc.
• **If you do NOT have solid content for a section (like Decisions, Action Items), DELETE that entire heading and body.  
  NEVER OUTPUT PLACEHOLDERS, “[Not specified]”, “No …”, “None”, “…”, or empty bullets.**
• Markdown only — headings, lists, and paragraphs. **No tables, no code fences.**
• Target length ≈ 450-1100 words (about 1-2 A4 pages): detailed enough to replace
  the recording, but still concise.
• Keep prose readable: clear headings, logical order, numbered/bulleted lists where useful.
• Strip EVERY leftover placeholder or bracketed hint.
• Return **only the finished Markdown** — no commentary, no extra text.

TEMPLATES
{TEMPLATES}
"""

        response = openai.chat.completions.create(
            model="gpt-4.1-mini-2025-04-14",
            temperature=0.3,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Full meeting transcript:\n{text}"},
            ],
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        LOGGER.error(f"Celery Worker: Summary generation failed: {e}", exc_info=True)
        return "Error: Summary generation failed."


def rebuild_full_transcript(db_session: Session, meeting_id_uuid: uuid.UUID) -> str:
    chunk_texts = db_session.exec(
        select(MeetingChunk.text)
        .where(MeetingChunk.meeting_id == meeting_id_uuid)
        .where(MeetingChunk.text.is_not(None))
        .order_by(MeetingChunk.chunk_index)
    ).all()
    return " ".join(text for text in chunk_texts if text).strip()


@celery_app.task(
    name="app.worker.process_transcription_and_summary",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def process_transcription_and_summary(
    self, meeting_id_str: str, chunk_index: int, chunk_path_str: str
):
    LOGGER.info(
        f"Task started for meeting {meeting_id_str}, chunk {chunk_index} at path {chunk_path_str}"
    )
    engine = get_db_engine()
    meeting_id_uuid = uuid.UUID(meeting_id_str)

    try:
        chunk_text = transcribe_webm_chunk_in_worker(chunk_path_str)
        LOGGER.info(
            f"Transcription result for chunk {chunk_index} (meeting {meeting_id_str}): '{chunk_text[:100]}...'"
        )

        with Session(engine) as db:
            mc = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == meeting_id_uuid,
                    MeetingChunk.chunk_index == chunk_index,
                )
            ).first()

            if not mc:
                LOGGER.error(
                    f"MeetingChunk not found for meeting {meeting_id_str}, chunk {chunk_index}. Aborting task."
                )
                return

            mc.text = chunk_text
            db.add(mc)
            db.commit()

            mtg = db.get(Meeting, meeting_id_uuid)
            if not mtg:
                LOGGER.error(
                    f"Meeting {meeting_id_str}: object not found after transcribing chunk. Aborting."
                )
                return

            # Count how many chunks have transcription
            transcribed_count = (
                db.scalar(
                    select(func.count(MeetingChunk.id)).where(
                        MeetingChunk.meeting_id == meeting_id_uuid,
                        MeetingChunk.text.is_not(None),
                    )
                )
                or 0
            )

            if mtg.expected_chunks is not None:
                effective_expected = mtg.expected_chunks
            else:
                effective_expected = mtg.received_chunks

            # Only summarize once final_received=True AND we've transcribed all expected chunks.
            if (
                not mtg.done
                and mtg.final_received
                and effective_expected > 0
                and transcribed_count >= effective_expected
            ):
                LOGGER.info(
                    f"Meeting {meeting_id_str}: All chunks transcribed. Building final transcript and summarizing."
                )
                final_transcript = rebuild_full_transcript(db, meeting_id_uuid)
                mtg.transcript_text = (
                    final_transcript  # Store the final, complete transcript
                )

                if final_transcript:
                    summary_md = summarise_transcript_in_worker(
                        final_transcript, mtg.started_at.isoformat()
                    )
                    mtg.summary_markdown = summary_md
                    mtg.done = True
                    LOGGER.info(
                        f"✅ Meeting {meeting_id_str} summarized successfully by worker."
                    )
                else:
                    LOGGER.warning(
                        f"Meeting {meeting_id_str}: Transcript text is empty, cannot generate summary."
                    )
                    mtg.summary_markdown = (
                        "Error: Transcript was empty, summary could not be generated."
                    )
                    mtg.done = True

                db.add(mtg)
                db.commit()
            else:
                LOGGER.info(
                    f"Meeting {meeting_id_str}: Waiting for more chunks. "
                    f"Status: transcribed={transcribed_count}, expected={effective_expected}, final_received={mtg.final_received}"
                )

    except Exception as exc:
        LOGGER.error(
            f"Error processing task for meeting {meeting_id_str}, chunk {chunk_index}: {exc}",
            exc_info=True,
        )
        try:
            raise self.retry(exc=exc, countdown=60)
        except self.MaxRetriesExceededError:
            LOGGER.error(
                f"Max retries exceeded for task: meeting {meeting_id_str}, chunk {chunk_index}."
            )
            # MODIFICATION 2 STARTS HERE
            # Attempt to update the database to mark this chunk as permanently failed
            # Ensure engine is available. If `get_db_engine()` was called inside try, it might need to be called again
            # or ensure `engine` variable is accessible here.
            # Similarly, `meeting_id_uuid` must be accessible.
            fail_engine = get_db_engine()
            fail_meeting_id_uuid = uuid.UUID(
                meeting_id_str
            )  # Re-define or ensure scope

            with Session(fail_engine) as db_fail_session:
                mc_fail = db_fail_session.exec(
                    select(MeetingChunk).where(
                        MeetingChunk.meeting_id == fail_meeting_id_uuid,
                        MeetingChunk.chunk_index == chunk_index,
                    )
                ).first()
                if mc_fail:
                    mc_fail.text = None  # Set to None on max retries exceeded
                    db_fail_session.add(mc_fail)
                    db_fail_session.commit()
                    LOGGER.info(
                        f"Set chunk {chunk_index} of meeting {meeting_id_str} text to None after max retries."
                    )
                else:
                    LOGGER.error(
                        f"Could not find chunk {chunk_index} of meeting {meeting_id_str} to update after max retries."
                    )
            # MODIFICATION 2 ENDS HERE


# ─── NEW!  on-demand summary task ───────────────────────────────────
@celery_app.task(
    name="app.worker.generate_summary_only",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=60,
)
def generate_summary_only(self, meeting_id_str: str):
    """
    Regenerates a summary for an already-transcribed meeting.
    Called from GET /api/meetings when the user opens the summary page.
    """
    engine = get_db_engine()
    meeting_id = uuid.UUID(meeting_id_str)

    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
        if not mtg:
            LOGGER.error("Meeting %s not found for summary regen.", meeting_id_str)
            return

        final_transcript = mtg.transcript_text or rebuild_full_transcript(
            db, meeting_id
        )
        if not final_transcript:
            LOGGER.warning(
                "Meeting %s has no transcript – aborting regen.", meeting_id_str
            )
            return

        # <<< FIX: Persist the rebuilt transcript if it was missing >>>
        mtg.transcript_text = final_transcript

        LOGGER.info("♻️  Regenerating summary for meeting %s", meeting_id_str)
        summary_md = summarise_transcript_in_worker(
            final_transcript, mtg.started_at.isoformat()
        )

        mtg.summary_markdown = summary_md
        mtg.done = True
        db.add(mtg)
        db.commit()
        LOGGER.info("✅ Summary regenerated for meeting %s", meeting_id_str)
