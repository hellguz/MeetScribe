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
    # ... (this function remains the same)
    chunk_path = Path(chunk_path_str)
    whisper = get_whisper_model()
    try:
        if settings.recognition_in_cloud:
            # ... cloud transcription logic
            return "Cloud transcription logic here"
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


def summarise_transcript_in_worker(
    full_transcript: str, meeting_title: str, started_at_iso: str
) -> str:
    # ... (this function remains the same)
    if not full_transcript or len(full_transcript.strip()) < 20:
        return "Recording too short to generate a meaningful summary."

    if not openai.api_key:
        openai.api_key = settings.openai_api_key
    # ... rest of the summarization logic
    return "Summary generation logic here"


def rebuild_full_transcript(db_session: Session, meeting_id_uuid: uuid.UUID) -> tuple[str, int]:
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
    LOGGER.info(
        f"Meeting {mtg.id}: Finalizing. Building transcript and summarizing."
    )
    final_transcript, num_chunks = rebuild_full_transcript(db, mtg.id)
    mtg.transcript_text = final_transcript
    
    # --- NEW: Calculate and set word_count and duration ---
    if final_transcript:
        mtg.word_count = len(final_transcript.split())
        # Assuming each chunk is roughly 30s as per frontend logic
        mtg.duration_seconds = num_chunks * 30
        
        summary_md = summarise_transcript_in_worker(
            final_transcript, mtg.title, mtg.started_at.isoformat()
        )
        mtg.summary_markdown = summary_md
        LOGGER.info(
            f"✅ Meeting {mtg.id} summarized successfully by worker."
        )
    else:
        LOGGER.warning(
            f"Meeting {mtg.id}: Transcript text is empty, cannot generate summary."
        )
        mtg.word_count = 0
        mtg.duration_seconds = 0
        mtg.summary_markdown = "Error: Transcript was empty, summary could not be generated."

    mtg.done = True
    db.add(mtg)
    db.commit()


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
                LOGGER.error(f"MeetingChunk not found for meeting {meeting_id_str}, chunk {chunk_index}.")
                return
            mc.text = chunk_text
            db.add(mc)
            db.commit()

            mtg = db.get(Meeting, meeting_id_uuid)
            if not mtg:
                LOGGER.error(f"Meeting {meeting_id_str}: object not found after transcribing chunk.")
                return

            transcribed_count = db.scalar(
                select(func.count(MeetingChunk.id)).where(
                    MeetingChunk.meeting_id == meeting_id_uuid,
                    MeetingChunk.text.is_not(None),
                )
            ) or 0
            
            effective_expected = mtg.expected_chunks if mtg.expected_chunks is not None else mtg.received_chunks
            
            if not mtg.done and mtg.final_received and effective_expected > 0 and transcribed_count >= effective_expected:
                finalize_meeting_processing(db, mtg)
    except Exception as exc:
        LOGGER.error(f"Error processing task for {meeting_id_str}, chunk {chunk_index}: {exc}", exc_info=True)
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
        
        # Ensure we're not re-doing work
        if mtg.done:
            LOGGER.info("Meeting %s already summarized. Aborting regen.", meeting_id_str)
            return

        LOGGER.info("♻️  Regenerating summary for meeting %s", meeting_id_str)
        finalize_meeting_processing(db, mtg)
        LOGGER.info("✅ Summary regenerated for meeting %s", meeting_id_str)