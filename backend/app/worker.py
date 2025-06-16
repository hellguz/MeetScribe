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


def summarise_transcript_in_worker(
    full_transcript: str, meeting_title: str, started_at_iso: str
) -> str:
    if not full_transcript or len(full_transcript.strip()) < 20:
        return "Recording too short to generate a meaningful summary."

    if not openai.api_key:
        openai.api_key = settings.openai_api_key

    try:
        started_at_dt = dt.datetime.fromisoformat(started_at_iso.replace("Z", "+00:00"))
        date_str = started_at_dt.strftime("%Y-%m-%d")
        end_time = dt.datetime.now(dt.timezone.utc).strftime("%H:%M")
        time_range = f"{started_at_dt.strftime('%H:%M')} - {end_time}"

        system_prompt = f"""
You are 'Scribe', an AI analyst with deep expertise in project management and architectural critique. Your primary goal is to transform a raw meeting transcript into a comprehensive, clear, and actionable summary. The final document must be so thorough and insightful that a team member who missed the meeting can grasp all concepts, discussions, and critical feedback as if they were there. Prioritize completeness and clarity over brevity.

<thinking_steps>
**1. Internal Analysis (Do Not Output This Section)**
Before writing, you MUST first perform a deep, silent analysis of the transcript:
- **Purpose & Vibe:** What is the main goal of this meeting (e.g., project critique, brainstorm, planning)? What is the overall tone (e.g., formal, collaborative, critical)?
- **Key Concepts Presented:** Identify the 2-4 core ideas or components that were presented or discussed (e.g., "Modular Housing Typologies," "Zoning Strategy").
- **Critiques & Directives:** This is critical. Create a detailed list of every piece of specific feedback, criticism, or suggestion given. For each, note *what* was criticized and *what the specific recommendation was*. Do not generalize; capture the exact suggestions.
- **Narrative Flow:** How do the concepts and critiques connect? What is the story of the meeting from start to finish?
- **Dominant Language:** Identify the primary language of the conversation.
</thinking_steps>

<output_rules>
**2. Final Output Generation**
Your final response MUST BE ONLY the Markdown summary. It must start directly with the `##` heading for the meeting title. DO NOT include any commentary, preamble, or the content from your `<thinking_steps>`. The summary should be detailed and adopt a clear, professional-yet-human tone.

---
## {meeting_title}
_{date_str} — {time_range}_

### Summary
Write an approachable and insightful paragraph (3-5 sentences) that sets the scene for the meeting. It should summarize the project's state, the main topics discussed, and the overall 'vibe' of the conversation, including the nature of the feedback received. Use a natural, conversational tone.

---
*(...Thematic Sections Go Here...)*
---

### Key Decisions & Actionable Next Steps
- This section must be comprehensive.
- **Decisions:** List any firm decisions made.
- **Action Items:** List both EXPLICIT and IMPLICIT tasks. If someone says, "It would be nice to see a section view," that is an implicit action item. Capture everything a team member would need to act on.
- **Format:** `- **[Topic/Owner]:** [Detailed description of the action or decision, including the 'why' or context].`
- *(Omit this section ONLY if there were absolutely no decisions or actionable suggestions).*
</output_rules>

<thematic_body_instructions>
This is the core of the summary. For each **Key Concept** you identified, create a `###` heading.
- **Explain the Concept:** First, use a paragraph to describe the idea as it was presented by the team.
- **Capture All Specific Critiques and Suggestions:** Then, create a sub-section titled `**Feedback & Discussion:**`. Under this, use a detailed bulleted list to present EVERY piece of critique and all suggestions you extracted for that topic.
- **Do not generalize with phrases like "suggestions were made."** Instead, list the exact suggestions. For example, instead of "The visuals needed to be clearer," write "- It was suggested to use grey for existing buildings and saturated colors for new interventions to improve clarity on the masterplan." This level of detail is mandatory.

**CRITICAL:** The entire summary, including all headings and text, **MUST be in the dominant language** you identified in your internal analysis.
</thematic_body_instructions>
"""

        response = openai.chat.completions.create(
            model="gpt-4.1-mini",  # Using a cost-effective model with strong reasoning.
            temperature=0.3,  # Slightly higher temperature for more natural language
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"Full meeting transcript:\n{full_transcript}",
                },
            ],
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        LOGGER.error(f"Celery Worker: Summary generation failed: {e}", exc_info=True)
        return "Error: Summary generation failed."


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
