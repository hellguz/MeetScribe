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
from langdetect import detect, DetectorFactory
from langdetect.lang_detect_exception import LangDetectException


from .config import settings
from .models import Meeting, MeetingChunk

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
    # === Resilience Change: Only acknowledge tasks after they complete successfully ===
    task_acks_late=True,
    # === Resilience Change: Add a periodic task to clean up stuck meetings ===
    beat_schedule={
        "cleanup-every-30-minutes": {
            "task": "app.worker.cleanup_stuck_meetings",
            "schedule": 1800.0,  # 30 minutes in seconds
        },
    },
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

# It's recommended to set a seed for consistent results for short texts
DetectorFactory.seed = 0

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
def on_worker_startup(**kwargs):
    """
    On worker startup, pre-load the AI model and trigger an immediate
    cleanup task to recover any jobs interrupted by a restart.
    """
    LOGGER.info("Celery worker ready. Pre-loading models and running startup tasks.")
    # Pre-load the model to have it ready for the first task
    get_whisper_model()
    # === Resilience Change: Queue a janitor task to run immediately on startup ===
    LOGGER.info("Queueing initial cleanup task for any jobs interrupted by a restart.")
    cleanup_stuck_meetings.delay()


def transcribe_webm_chunk_in_worker(chunk_path_str: str) -> str:
    """
    Transcribes an audio chunk using either a cloud API (Groq) or a local model.
    """
    chunk_path = Path(chunk_path_str)
    whisper = get_whisper_model()
    try:
        if settings.recognition_in_cloud:
            path_to_transcribe = chunk_path
            output_flac_path = None
            if shutil.which("ffmpeg"):
                output_flac_path = chunk_path.with_suffix(".flac")
                try:
                    command = [
                        "ffmpeg",
                        "-i",
                        str(chunk_path),
                        "-y",
                        "-vn",
                        "-ac",
                        "1",
                        "-ar",
                        "16000",
                        "-sample_fmt",
                        "s16",
                        str(output_flac_path),
                    ]
                    subprocess.run(command, check=True, capture_output=True, text=True)
                    path_to_transcribe = output_flac_path
                    LOGGER.info(f"Successfully converted {chunk_path.name} to FLAC.")
                except subprocess.CalledProcessError as e:
                    LOGGER.error(
                        f"ffmpeg conversion failed for {chunk_path.name}: {e.stderr}. Will send original."
                    )
                    path_to_transcribe = chunk_path
            else:
                LOGGER.warning(
                    "ffmpeg not found. Sending original WebM file to cloud API."
                )

            try:
                with open(path_to_transcribe, "rb") as audio_file:
                    resp = _groq_client.audio.transcriptions.create(
                        file=(path_to_transcribe.name, audio_file.read()),
                        model="whisper-large-v3",
                        response_format="verbose_json",
                    )
                LOGGER.info(
                    f"Cloud transcription succeeded for {path_to_transcribe.name}"
                )
                return resp.text.strip()
            finally:
                if output_flac_path and output_flac_path.exists():
                    output_flac_path.unlink()
        else:
            segments, _info = whisper.transcribe(
                str(chunk_path),
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(
                    threshold=0.1, min_silence_duration_ms=500, speech_pad_ms=300
                ),
            )
            return " ".join(s.text for s in segments).strip()
    except Exception as e:
        LOGGER.error(
            f"Celery Worker: Failed to transcribe {chunk_path.name}: {e}", exc_info=True
        )
        return ""


def generate_title_for_meeting(summary: str, full_transcript: str) -> str:
    """Generates a concise, meaningful title from the meeting summary."""
    if not summary or "error" in summary.lower() or "too short" in summary.lower():
        LOGGER.info("Summary is too short or an error, cannot generate title.")
        return ""  # Return empty string, let the calling function handle it

    try:
        title_prompt = f"""
Analyze the following meeting summary and the full transcript. Your task is to generate a short, dense, and meaningful title for the meeting.
**Instructions:**
1.  **Language:** The title MUST be in the same language as the summary and transcript.
2.  **Length:** The title must be between 6 and 15 words.
3.  **Content:** The title should accurately reflect the main topics, decisions, or outcomes of the meeting. Avoid generic titles like "Meeting Summary" or "Project Update". It should be specific.
4.  **Format:** Output ONLY the title text, with no extra formatting, quotes, or preamble.
**Meeting Summary:**
---
{summary}
---

**Full Transcript (for context):**
---
{full_transcript[:2000]}
---

Based on the content, generate the title now.
"""
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.5,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that creates concise meeting titles.",
                },
                {"role": "user", "content": title_prompt},
            ],
        )
        generated_title = response.choices[0].message.content.strip().strip('"')
        LOGGER.info(f"Generated meeting title: '{generated_title}'")
        return generated_title
    except Exception as e:
        LOGGER.error(f"Celery Worker: Title generation failed: {e}", exc_info=True)
        return ""  # Return empty string on failure


def detect_language_local(text_snippet: str) -> str:
    """Detects language locally from a text snippet."""
    if not text_snippet:
        return "English"
    try:
        # langdetect uses ISO 639-1 codes (e.g., 'en', 'es')
        lang_code = detect(text_snippet)
        # We need to map the code to a full language name for the prompt
        LANG_MAP = {
            "en": "English", "es": "Spanish", "fr": "French",
            "de": "German", "it": "Italian", "pt": "Portuguese",
            "ru": "Russian", "ja": "Japanese", "zh-cn": "Chinese (Simplified)",
        }
        language = LANG_MAP.get(lang_code, "English")
        LOGGER.info(f"Detected language via langdetect: {language} ({lang_code})")
        return language
    except LangDetectException:
        # This can happen if the text is too short or ambiguous
        LOGGER.warning("Langdetect failed for snippet, defaulting to English.")
        return "English"


def summarise_transcript_in_worker(
    full_transcript: str,
    meeting_title: str,
    started_at_iso: str,
    summary_length: str,
) -> str:
    if not full_transcript or len(full_transcript.strip().split()) < 25:
        return "Recording is too brief to generate a meaningful summary."

    if not openai.api_key:
        openai.api_key = settings.openai_api_key

    try:
        transcript_snippet = full_transcript[:500]
        detected_language = detect_language_local(transcript_snippet)

        started_at_dt = dt.datetime.fromisoformat(started_at_iso.replace("Z", "+00:00"))
        date_str = started_at_dt.strftime("%Y-%m-%d")
        end_time = dt.datetime.now(dt.timezone.utc).strftime("%H:%M")
        time_range = f"{started_at_dt.strftime('%H:%M')} - {end_time}"

        # --- Stricter Length Instructions ---
        LENGTH_PROMPTS = {
            "quar_page": "The final summary MUST be very concise, approximately 125 words. This is a strict word count requirement.",
            "half_page": "The final summary MUST be concise, approximately 250 words. This is a strict word count requirement.",
            "one_page": "The final summary MUST be detailed but well-balanced, approximately 500 words. This is a strict word count requirement.",
            "two_pages": "The final summary MUST be comprehensive, approximately 1000 words. This is a strict word count requirement.",
            "auto": "Use your expert judgment to determine the appropriate length for the summary based on the transcript's content. The goal is to be as helpful as possible to a non-attendee.",
        }
        length_instruction = LENGTH_PROMPTS.get(summary_length, LENGTH_PROMPTS["auto"])

        system_prompt = f"""
You are 'Scribe', an expert AI analyst with the writing style of a seasoned consultant. Your primary goal is to create a summary that is insightful, easy to read, and appropriately detailed.
**Core Philosophy:**
- **Balance:** Find the perfect balance between detail and conciseness. The summary should be a true distillation, not a verbose reconstruction, but it must contain all critical information for a non-attendee.
- **Readability:** The output must be easy to read. Use well-structured paragraphs to explain concepts and bullet points for lists (like feedback, action items, or key takeaways). This creates a varied and engaging format.

<thinking_steps>
**1. Internal Analysis (Do Not Output This Section)**
- **Confirm Language:** The user has identified the language as **{detected_language}**. Your entire output MUST be in **{detected_language}**. This is the most important rule.
- **Identify Key Themes:** Deconstruct the transcript into its main thematic parts or topics of discussion.
- **Assess Content Type for Each Theme:** For each theme, determine if it's primarily a presentation of an idea, a collaborative discussion, a critique/feedback session, or a monologue. This will inform how you structure the summary for that section.
</thinking_steps>

<output_rules>
**2. Final Output Generation**
- Your response MUST BE ONLY the Markdown summary.
- **WORD COUNT:** {length_instruction} You must strictly adhere to this constraint. Do not deviate.
- Start directly with the `##` heading.
---
## {meeting_title}
_{date_str} — {time_range}_

#### Summary
Write an insightful overview paragraph (3-5 sentences). It should set the scene, describe the main purpose of the conversation, and touch upon the key conclusions or outcomes.
---
*(...Thematic Sections Go Here...)*
---

#### Key Decisions & Action Items
- This section is mandatory unless there were absolutely no decisions or actions.
- List all firm decisions made and all actionable next steps. This section should use bullet points.
- **Format:** `- **[Topic/Owner]:** [Detailed description of the action or decision, including necessary context].`
</output_rules>

<thematic_body_instructions>
This is the core of the summary. For each **Key Theme** you identified, create a `###` heading.
- **Summarize the Discussion:** Write a clear paragraph summarizing the main points of the discussion for this theme. Explain the core arguments, proposals, and conclusions.
- **Add Feedback (ONLY if critique is present):** If a theme consists of clear feedback or a critique session, add a sub-section titled `**Feedback & Discussion:**`. In this sub-section, use a detailed bulleted list to present every specific piece of feedback. **This is crucial for design reviews.**
- **For Simple Topics or Lists:** If a theme is just a list of ideas or a very simple point, feel free to use bullet points directly under the heading instead of a full paragraph to keep the summary concise and scannable.
</thematic_body_instructions>
"""

        response = openai.chat.completions.create(
            model="gpt-4.1-mini",
            temperature=0.5,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"Please summarize the following transcript, following all instructions including the language and length requirement:\n\n{full_transcript}",
                },
            ],
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        LOGGER.error(f"Celery Worker: Summary generation failed: {e}", exc_info=True)
        return "Error: Summary generation failed."


def rebuild_full_transcript(
    db_session: Session, meeting_id_uuid: uuid.UUID
) -> tuple[str, int]:
    """Returns the full transcript text and the total number of chunks used."""
    chunks = db_session.exec(
        select(MeetingChunk.text)
        .where(MeetingChunk.meeting_id == meeting_id_uuid)
        .where(MeetingChunk.text.is_not(None))
        .order_by(MeetingChunk.chunk_index)
    ).all()
    transcript_text = " ".join(text for text in chunks if text).strip()
    return transcript_text, len(chunks)


def finalize_meeting_processing(db: Session, mtg: Meeting):
    """Centralized logic to finalize a meeting."""
    LOGGER.info(f"Meeting {mtg.id}: Finalizing. Building transcript and summarizing.")
    final_transcript, num_chunks = rebuild_full_transcript(db, mtg.id)
    mtg.transcript_text = final_transcript

    if final_transcript:
        # These fields were added later, so we calculate them here.
        mtg.word_count = len(final_transcript.split())
        mtg.duration_seconds = num_chunks * 30  # Assuming 30s chunks

        summary_md = summarise_transcript_in_worker(
            final_transcript,
            mtg.title,
            mtg.started_at.isoformat(),
            mtg.summary_length,
        )
        mtg.summary_markdown = summary_md

        # New: Generate and update the title
        if summary_md and "error" not in summary_md.lower():
            new_title = generate_title_for_meeting(summary_md, final_transcript)
            if new_title:
                mtg.title = new_title

        LOGGER.info(f"✅ Meeting {mtg.id} summarized and titled successfully by worker.")
    else:
        LOGGER.warning(
            f"Meeting {mtg.id}: Transcript text is empty, cannot generate summary."
        )
        mtg.word_count = 0
        mtg.duration_seconds = 0
        mtg.summary_markdown = (
            "Error: Transcript was empty, summary could not be generated."
        )

    mtg.done = True
    db.add(mtg)
    db.commit()


@celery_app.task(name="app.worker.cleanup_stuck_meetings")
def cleanup_stuck_meetings():
    """
    Finds meetings that are not done and have been inactive for a while,
    then re-queues transcription tasks for any chunks that are missing text.
    """
    engine = get_db_engine()
    STUCK_THRESHOLD_MINUTES = 15

    with Session(engine) as db:
        stuck_threshold = dt.datetime.utcnow() - dt.timedelta(
            minutes=STUCK_THRESHOLD_MINUTES
        )

        stuck_meetings = db.exec(
            select(Meeting).where(
                Meeting.done == False,
                Meeting.final_received == True,
                Meeting.last_activity < stuck_threshold,
            )
        ).all()

        if not stuck_meetings:
            return

        LOGGER.info(
            f"Janitor task: Found {len(stuck_meetings)} potentially stuck meetings."
        )

        for mtg in stuck_meetings:
            unprocessed_chunks = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == mtg.id, MeetingChunk.text.is_(None)
                )
            ).all()

            if not unprocessed_chunks:
                LOGGER.info(
                    f"Janitor task: Meeting {mtg.id} has no unprocessed chunks, skipping."
                )
                continue

            LOGGER.warning(
                f"Meeting {mtg.id} is stuck. Re-queueing {len(unprocessed_chunks)} chunk(s)."
            )
            mtg.last_activity = dt.datetime.utcnow()
            db.add(mtg)
            db.commit()

            for chunk in unprocessed_chunks:
                chunk_path = Path(chunk.path)
                if chunk_path.exists():
                    process_transcription_and_summary.delay(
                        meeting_id_str=str(mtg.id),
                        chunk_index=chunk.chunk_index,
                        chunk_path_str=str(chunk_path.resolve()),
                    )
                else:
                    LOGGER.error(
                        f"Janitor task: Chunk path {chunk.path} for meeting {mtg.id}, chunk {chunk.chunk_index} does not exist. Cannot re-queue."
                    )


@celery_app.task(
    name="app.worker.process_transcription_and_summary",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def process_transcription_and_summary(
    self, meeting_id_str: str, chunk_index: int, chunk_path_str: str
):
    engine = get_db_engine()
    meeting_id_uuid = uuid.UUID(meeting_id_str)
    try:
        chunk_text = transcribe_webm_chunk_in_worker(chunk_path_str)
        with Session(engine) as db:
            mc = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == meeting_id_uuid,
                    MeetingChunk.chunk_index == chunk_index,
                )
            ).first()
            if not mc:
                LOGGER.error(
                    f"MeetingChunk not found for meeting {meeting_id_str}, chunk {chunk_index}."
                )
                return
            mc.text = chunk_text
            db.add(mc)
            db.commit()

            mtg = db.get(Meeting, meeting_id_uuid)
            if not mtg:
                LOGGER.error(
                    f"Meeting {meeting_id_str}: object not found after transcribing chunk."
                )
                return

            transcribed_count = (
                db.scalar(
                    select(func.count(MeetingChunk.id)).where(
                        MeetingChunk.meeting_id == meeting_id_uuid,
                        MeetingChunk.text.is_not(None),
                    )
                )
                or 0
            )

            effective_expected = (
                mtg.expected_chunks
                if mtg.expected_chunks is not None
                else mtg.received_chunks
            )

            if (
                not mtg.done
                and mtg.final_received
                and effective_expected > 0
                and transcribed_count >= effective_expected
            ):
                finalize_meeting_processing(db, mtg)
    except Exception as exc:
        LOGGER.error(
            f"Error processing task for {meeting_id_str}, chunk {chunk_index}: {exc}",
            exc_info=True,
        )
        self.retry(exc=exc)


@celery_app.task(
    name="app.worker.generate_summary_only",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=60,
)
def generate_summary_only(self, meeting_id_str: str):
    engine = get_db_engine()
    meeting_id = uuid.UUID(meeting_id_str)
    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
        if not mtg:
            LOGGER.error("Meeting %s not found for summary regen.", meeting_id_str)
            return

        if mtg.done:
            LOGGER.info(
                "Meeting %s already summarized. Aborting regen.", meeting_id_str
            )
            return

        LOGGER.info("♻️  Regenerating summary for meeting %s", meeting_id_str)
        finalize_meeting_processing(db, mtg)
        LOGGER.info("✅ Summary regenerated for meeting %s", meeting_id_str)
