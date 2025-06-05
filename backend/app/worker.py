# backend/app/worker.py

import logging
import datetime as dt
import uuid
from pathlib import Path

from faster_whisper import WhisperModel
import openai
from sqlmodel import Session, select, func, create_engine

from .config import settings
from .models import Meeting, MeetingChunk
from .templates import TEMPLATES

# ─────────────────────────────────────────────────────────────────────────────
# Module-level Whisper model and DB engine. Each RQ worker process imports
# this file once on startup, so we load Whisper immediately at import time.

_whisper_model_instance: WhisperModel | None = None
_db_engine_instance = None

LOGGER = logging.getLogger("rq_worker")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s][%(module)s.%(funcName)s:%(lineno)d] %(message)s",
)

def get_db_engine():
    """
    Create (or reuse) a single SQLModel/SQLAlchemy engine per worker process.
    """
    global _db_engine_instance
    if _db_engine_instance is None:
        LOGGER.info("Initializing DB engine for RQ worker.")
        _db_engine_instance = create_engine(f"sqlite:///{settings.db_path}", echo=False)
    return _db_engine_instance

def get_whisper_model():
    """
    Create (or reuse) a single WhisperModel per worker process.
    Because we call this at module import below, the model will be loaded
    once, up front, before any job runs.
    """
    global _whisper_model_instance
    if _whisper_model_instance is None:
        LOGGER.info("🔊 Loading Whisper model (%s) in RQ worker…", settings.whisper_model_size)
        _whisper_model_instance = WhisperModel(
            settings.whisper_model_size,
            device="cpu",
            compute_type="int8"
        )
        LOGGER.info("✅ Whisper model loaded in RQ worker.")
    return _whisper_model_instance

# ─────────────────────────────────────────────────────────────────────────────

# Force model loading at import time. This ensures that as soon as RQ worker
# does "import app.worker", the model is in memory and ready to go.
get_whisper_model()


def transcribe_webm_chunk(chunk_path_str: str) -> str:
    """
    Given a path to a .webm chunk, optionally concatenate with chunk_000.webm (WebM header)
    and then run WhisperModel.transcribe(). Returns the full transcription text.
    """
    chunk_path = Path(chunk_path_str)
    whisper = get_whisper_model()
    try:
        first_chunk_path = chunk_path.parent / "chunk_000.webm"
        path_to_transcribe = chunk_path
        temp_path_to_unlink = None

        if (
            first_chunk_path.exists()
            and chunk_path.name != first_chunk_path.name
            and chunk_path.stat().st_size > 0
        ):
            # If header chunk is small (<500 KB), concatenate it with this chunk.
            if 0 < first_chunk_path.stat().st_size < 500 * 1024:
                temp_path = chunk_path.parent / f"temp_concat_{chunk_path.name}"
                with first_chunk_path.open("rb") as f_first, temp_path.open("wb") as f_out:
                    f_out.write(f_first.read())
                    with chunk_path.open("rb") as f_cur:
                        f_out.write(f_cur.read())
                path_to_transcribe = temp_path
                temp_path_to_unlink = temp_path
            else:
                LOGGER.warning(
                    f"First chunk {first_chunk_path.name} is too large or empty; transcribing {chunk_path.name} standalone."
                )

        segments, _info = whisper.transcribe(str(path_to_transcribe), beam_size=5)
        transcription = " ".join(s.text for s in segments).strip()

        if temp_path_to_unlink:
            temp_path_to_unlink.unlink(missing_ok=True)

        return transcription

    except Exception as e:
        LOGGER.error(f"RQ Worker: Failed to transcribe {chunk_path.name}: {e}", exc_info=True)
        if temp_path_to_unlink and temp_path_to_unlink.exists():
            temp_path_to_unlink.unlink(missing_ok=True)
        return ""


def summarise_transcript_in_worker(text: str, started_at_iso: str) -> str:
    """
    Given a full transcript string and the meeting’s start time, call OpenAI
    to generate a Markdown summary. Returns the summary string.
    """
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
        LOGGER.error(f"RQ Worker: Summary generation failed: {e}", exc_info=True)
        return "Error: Summary generation failed."


def process_transcription_and_summary(meeting_id_str: str, chunk_index: int, chunk_path_str: str):
    """
    This function is called by RQ when you do:
        queue.enqueue("app.worker.process_transcription_and_summary", meeting_id, chunk_index, chunk_path)

    Steps:
      1) Transcribe the given chunk.
      2) Write chunk.text into MeetingChunk row.
      3) Append chunk.text to Meeting.transcript_text.
      4) If final_received AND all expected chunks are transcribed, generate summary.
    """
    LOGGER.info(f"RQ task started for meeting={meeting_id_str}, chunk={chunk_index}")

    engine = get_db_engine()
    meeting_id_uuid = uuid.UUID(meeting_id_str)

    try:
        # 1) Transcribe chunk
        chunk_text = transcribe_webm_chunk(chunk_path_str)
        LOGGER.info(f"Transcription (chunk {chunk_index}): '{chunk_text[:100]}...'")

        with Session(engine) as db:
            # 2) Update or create MeetingChunk record
            mc = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == meeting_id_uuid,
                    MeetingChunk.chunk_index == chunk_index,
                )
            ).first()

            if not mc:
                mc = MeetingChunk(
                    meeting_id=meeting_id_uuid,
                    chunk_index=chunk_index,
                    path=str(chunk_path_str),
                    text=chunk_text,
                )
            else:
                mc.path = str(chunk_path_str)
                mc.text = chunk_text

            db.add(mc)
            db.commit()

            # 3) Append to Meeting.transcript_text
            mtg = db.get(Meeting, meeting_id_uuid)
            if mtg:
                if chunk_index > 0 and chunk_text:
                    if mtg.transcript_text:
                        mtg.transcript_text += " " + chunk_text
                    else:
                        mtg.transcript_text = chunk_text
                    db.add(mtg)
                    db.commit()
                    db.refresh(mtg)

                # Count how many non-header chunks are transcribed
                real_transcribed_count = db.scalar(
                    select(func.count(MeetingChunk.id)).where(
                        MeetingChunk.meeting_id == meeting_id_uuid,
                        MeetingChunk.text.is_not(None),
                        MeetingChunk.chunk_index != 0,
                    )
                ) or 0

                # Determine how many we expect
                if mtg.expected_chunks is not None:
                    effective_expected = mtg.expected_chunks
                else:
                    effective_expected = mtg.received_chunks

                LOGGER.info(
                    f"Meeting {meeting_id_str}: transcribed={real_transcribed_count}, "
                    f"expected={effective_expected}, final_received={mtg.final_received}, done={mtg.done}"
                )

                # 4) If final_received AND all chunks done AND not yet summarized → summarize
                if (
                    not mtg.done
                    and mtg.final_received
                    and effective_expected > 0
                    and real_transcribed_count >= effective_expected
                ):
                    if mtg.transcript_text:
                        summary_md = summarise_transcript_in_worker(
                            mtg.transcript_text, mtg.started_at.isoformat()
                        )
                        mtg.summary_markdown = summary_md
                        mtg.done = True
                        LOGGER.info(f"✅ Meeting {meeting_id_str} summarized successfully by RQ worker.")
                    else:
                        LOGGER.warning(f"Meeting {meeting_id_str}: empty transcript, cannot summarize.")
                        mtg.summary_markdown = "Error: Transcript empty; summary could not be generated."
                        mtg.done = True

                    db.add(mtg)
                    db.commit()
                else:
                    LOGGER.info(f"Meeting {meeting_id_str}: waiting for more chunks or already done.")

    except Exception as exc:
        LOGGER.error(f"Error in RQ task for meeting {meeting_id_str}, chunk {chunk_index}: {exc}", exc_info=True)
        # RQ will mark this job as failed. You can inspect Redis or requeue if needed.
