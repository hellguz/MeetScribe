# backend/app/worker.py
# ─────────────────────────────────────────────────────────────────────────────
import logging
import datetime as dt
import uuid
from pathlib import Path

from celery import Celery
from celery.signals import worker_ready
from faster_whisper import WhisperModel
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
    include=['app.worker']
)

celery_app.conf.update(
    task_track_started=True,
    broker_connection_retry_on_startup=True,
)

_whisper_model_instance = None
_db_engine_instance = None

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
        LOGGER.info("🔊 Loading Whisper model (%s) in Celery worker…", settings.whisper_model_size)
        _whisper_model_instance = WhisperModel(
            settings.whisper_model_size,
            device="cpu",
            compute_type="int8"
        )
        LOGGER.info("✅ Whisper model loaded in Celery worker.")
    return _whisper_model_instance


@worker_ready.connect
def load_whisper_on_startup(**kwargs):
    get_whisper_model()


def transcribe_webm_chunk_in_worker(chunk_path_str: str) -> str:
    chunk_path = Path(chunk_path_str)
    whisper = get_whisper_model()
    try:
        # If this is a non-header chunk (chunk_index != 0), and we have a valid header (000),
        # concatenate them so Whisper gets a proper WebM stream. Otherwise transcribe directly.
        first_chunk_path = chunk_path.parent / "chunk_000.webm"
        path_to_transcribe = chunk_path
        temp_path_to_unlink = None

        if (
            first_chunk_path.exists()
            and chunk_path.name != first_chunk_path.name
            and chunk_path.stat().st_size > 0
        ):
            if 0 < first_chunk_path.stat().st_size < 500 * 1024:  # < 500 KB
                temp_path = chunk_path.parent / f"temp_concat_{chunk_path.name}"
                with first_chunk_path.open("rb") as f_first, temp_path.open("wb") as f_out:
                    f_out.write(f_first.read())
                    with chunk_path.open("rb") as f_cur:
                        f_out.write(f_cur.read())
                path_to_transcribe = temp_path
                temp_path_to_unlink = temp_path
            else:
                LOGGER.warning(
                    f"First chunk {first_chunk_path.name} is too large or empty, transcribing {chunk_path.name} standalone."
                )

        segments, _info = whisper.transcribe(str(path_to_transcribe), beam_size=5)
        transcription = " ".join(s.text for s in segments).strip()

        if temp_path_to_unlink:
            temp_path_to_unlink.unlink(missing_ok=True)

        return transcription
    except Exception as e:
        LOGGER.error(f"Celery Worker: Failed to transcribe {chunk_path.name}: {e}", exc_info=True)
        if temp_path_to_unlink and temp_path_to_unlink.exists():  # type: ignore
            temp_path_to_unlink.unlink(missing_ok=True)  # type: ignore
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
You are a meeting-summary generator.

RULES
• Choose (or adapt) one template 1-6 from the provided list.
• Translate all headings and subheadings in the chosen template to the meeting’s dominant language.
• Replace placeholders: [YYYY-MM-DD] with "{date_str}"; [HH:MM - HH:MM] with "{time_range}".
• Carefully review the transcript to fill in relevant details for sections like "Key Discussion Points", "Decisions Made", "Action Items", etc.
• If a section in the template has no corresponding information in the transcript, OMIT that section entirely from the output.
• Remove all instructional bracketed placeholders (e.g., "[Summary/Details]", "[if available]") from the final Markdown.
• Return ONLY the generated Markdown content. Do not include any prefatory remarks or apologies.

TEMPLATES
{TEMPLATES}
"""
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
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
    default_retry_delay=60
)
def process_transcription_and_summary(self, meeting_id_str: str, chunk_index: int, chunk_path_str: str):
    LOGGER.info(f"Task started for meeting {meeting_id_str}, chunk {chunk_index} at path {chunk_path_str}")
    engine = get_db_engine()
    meeting_id_uuid = uuid.UUID(meeting_id_str)

    # Do not process the header chunk (index 0). It's for compatibility only.
    if chunk_index == 0:
        LOGGER.info(f"Skipping transcription for header chunk (index 0) of meeting {meeting_id_str}.")
        with Session(engine) as db:
            # We must still find the corresponding MeetingChunk and mark its text
            # as a non-null empty string so it's not considered "pending".
            mc = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == meeting_id_uuid,
                    MeetingChunk.chunk_index == chunk_index,
                )
            ).first()
            if mc:
                mc.text = ""  # Mark as processed with empty text
                db.add(mc)
                db.commit()
            else:
                LOGGER.warning(f"Could not find DB record for header chunk 0 of meeting {meeting_id_str} to mark as processed.")
        return # End the task here

    try:
        chunk_text = transcribe_webm_chunk_in_worker(chunk_path_str)
        LOGGER.info(f"Transcription result for chunk {chunk_index} (meeting {meeting_id_str}): '{chunk_text[:100]}...'")

        with Session(engine) as db:
            mc = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == meeting_id_uuid,
                    MeetingChunk.chunk_index == chunk_index,
                )
            ).first()

            if not mc:
                LOGGER.error(f"MeetingChunk not found for meeting {meeting_id_str}, chunk {chunk_index}. Aborting task.")
                return

            mc.text = chunk_text
            db.add(mc)
            db.commit()

            # Rebuild full transcript for the meeting
            mtg = db.get(Meeting, meeting_id_uuid)
            if not mtg:
                LOGGER.error(f"Meeting {meeting_id_str}: object not found after transcribing chunk. Aborting.")
                return

            mtg.transcript_text = rebuild_full_transcript(db, meeting_id_uuid)
            db.add(mtg)
            db.commit()
            db.refresh(mtg)

            # Count how many non-header chunks have transcription
            real_transcribed_count = db.scalar(
                select(func.count(MeetingChunk.id)).where(
                    MeetingChunk.meeting_id == meeting_id_uuid,
                    MeetingChunk.text.is_not(None),
                    MeetingChunk.chunk_index != 0,
                )
            ) or 0

            # effective_expected = mtg.expected_chunks if set, else mtg.received_chunks
            if mtg.expected_chunks is not None:
                effective_expected = mtg.expected_chunks
            else:
                effective_expected = mtg.received_chunks

            LOGGER.info(
                f"Meeting {meeting_id_str}: real_transcribed={real_transcribed_count}, "
                f"effective_expected={effective_expected}, final_received={mtg.final_received}, done={mtg.done}"
            )

            # ── NEW: Only summarize once final_received=True AND we've transcribed all real chunks ──
            if (
                not mtg.done
                and mtg.final_received
                and effective_expected > 0
                and real_transcribed_count >= effective_expected
            ):
                if mtg.transcript_text:
                    summary_md = summarise_transcript_in_worker(mtg.transcript_text, mtg.started_at.isoformat())
                    mtg.summary_markdown = summary_md
                    mtg.done = True
                    LOGGER.info(f"✅ Meeting {meeting_id_str} summarized successfully by worker.")
                else:
                    LOGGER.warning(f"Meeting {meeting_id_str}: Transcript text is empty, cannot generate summary.")
                    mtg.summary_markdown = "Error: Transcript was empty, summary could not be generated."
                    mtg.done = True

                db.add(mtg)
                db.commit()
            else:
                LOGGER.info(f"Meeting {meeting_id_str}: Waiting for more real chunks or already done.")

    except Exception as exc:
        LOGGER.error(f"Error processing task for meeting {meeting_id_str}, chunk {chunk_index}: {exc}", exc_info=True)
        try:
            raise self.retry(exc=exc, countdown=60)
        except self.MaxRetriesExceededError:
            LOGGER.error(f"Max retries exceeded for task: meeting {meeting_id_str}, chunk {chunk_index}.")