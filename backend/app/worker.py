# backend/app/worker.py
# ─────────────────────────────────────────────────────────────────────────────
import logging
import datetime as dt
import uuid
from pathlib import Path
import shutil
import subprocess
import os
import sqlite3

from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_ready
from faster_whisper import WhisperModel
from groq import BadRequestError, Groq
import openai
from sqlmodel import Session, select, func, create_engine
from langdetect import detect, DetectorFactory
from langdetect.lang_detect_exception import LangDetectException


from .config import settings
from .models import Meeting, MeetingChunk, MeetingSection

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
        "cleanup-every-15-minutes": {
            "task": "app.worker.cleanup_stuck_meetings",
            "schedule": 900.0,  # 15 minutes in seconds
        },
        # --- NEW: Nightly database backup task ---
        "backup-db-midnight": {
            "task": "app.worker.backup_database",
            "schedule": crontab(minute=0, hour=0),  # Runs every day at midnight
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
    On worker startup, pre-load the AI model (if not in cloud mode) and
    trigger a cleanup task to recover any jobs interrupted by a restart.
    """
    LOGGER.info("Celery worker ready. Running startup tasks.")
    if not settings.recognition_in_cloud:
        # Pre-load the model to have it ready for the first task
        LOGGER.info("Pre-loading local Whisper model...")
        get_whisper_model()
    else:
        LOGGER.info("Cloud recognition is enabled, skipping local model pre-load.")
    # === Resilience Change: Queue a janitor task to run immediately on startup ===
    LOGGER.info("Queueing initial cleanup task for any jobs interrupted by a restart.")
    cleanup_stuck_meetings.delay()


def transcribe_webm_chunk_in_worker(chunk_path_str: str) -> str:
    """
    Transcribes an audio chunk using either a cloud API (Groq) or a local model.
    """
    chunk_path = Path(chunk_path_str)
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
            whisper = get_whisper_model()
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
3.  **Content:** The title should accurately reflect the main topics, decisions, or outcomes of the meeting.
Avoid generic titles like "Meeting Summary" or "Project Update". It should be specific.
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
        response = openai.responses.create(
            model="gpt-5-mini-2025-08-07",
            input=f"""Create a concise meeting title efficiently. Follow instructions precisely with minimal reasoning.

{title_prompt}""",
            reasoning={"effort": "minimal"},
        )
        generated_title = response.output_text.strip().strip('"')
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

        # Expanded map for common languages
        LANG_MAP = {
            "ar": "Arabic",
            "cs": "Czech",
            "da": "Danish",
            "de": "German",
            "en": "English",
            "es": "Spanish",
            "fi": "Finnish",
            "fr": "French",
            "he": "Hebrew",
            "hi": "Hindi",
            "hu": "Hungarian",
            "id": "Indonesian",
            "it": "Italian",
            "ja": "Japanese",
            "ko": "Korean",
            "nl": "Dutch",
            "no": "Norwegian",
            "pl": "Polish",
            "pt": "Portuguese",
            "ro": "Romanian",
            "ru": "Russian",
            "sk": "Slovak",
            "sv": "Swedish",
            "sw": "Swahili",
            "th": "Thai",
            "tr": "Turkish",
            "vi": "Vietnamese",
            "zh-cn": "Chinese (Simplified)",
            "zh-tw": "Chinese (Traditional)",
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
    summary_length: str,
    summary_language_mode: str | None,
    summary_custom_language: str | None,
    context: str | None,
) -> str:
    if not full_transcript or len(full_transcript.strip().split()) < 25:
        return "Recording is too brief to generate a meaningful summary."
    if not openai.api_key:
        openai.api_key = settings.openai_api_key

    try:
        # Use a larger snippet for more reliable language detection
        transcript_snippet = full_transcript[:2000]
        detected_language = detect_language_local(transcript_snippet)

        # Determine target language based on user's preference
        if summary_language_mode == "custom" and summary_custom_language:
            target_language = summary_custom_language
        elif summary_language_mode == "english":
            target_language = "English"
        else:  # 'auto' or any other case
            target_language = detected_language

        # Stricter and clearer length instructions
        LENGTH_PROMPTS = {
            "quar_page": "The final summary must be **exactly** around 125 words. This word count is a **strict, non-negotiable requirement**.",
            "half_page": "The final summary must be **exactly** around 250 words. This word count is a **strict, non-negotiable requirement**.",
            "one_page": "The final summary must be **exactly** around 500 words. This word count is a **strict, non-negotiable requirement**.",
            "two_pages": "The final summary must be **exactly** around 1000 words. This word count is a **strict, non-negotiable requirement**.",
            "auto": "Use your expert judgment to determine the appropriate length for the summary based on the transcript's content. The goal is to be as helpful as possible to a non-attendee.",
        }
        length_instruction = LENGTH_PROMPTS.get(summary_length, LENGTH_PROMPTS["auto"])

        context_section = ""
        if context and context.strip():
            context_section = f"""
<user_provided_context>
This is critical context provided by the user. You MUST use it as a source of truth for the spelling of names, projects, and specific technical terms. Refer to this context to ensure accuracy. Do not contradict it.
---
{context}
---
</user_provided_context>
"""

        system_prompt = f"""
You are 'Scribe', an expert AI analyst. Work efficiently with minimal reasoning - follow instructions precisely to create an insightful, well-structured summary.
{context_section}
**Core Philosophy:**
- **Balance:** Find the perfect balance between detail and conciseness. The summary should be a true distillation, not a verbose reconstruction, but it must contain all critical information for a non-attendee.
- **Readability:** The output must be easy to read. Use well-structured paragraphs to explain concepts and bullet points for lists (like feedback, action items, or key takeaways). This creates a varied and engaging format.

<thinking_steps>
**1. Internal Analysis (Do Not Output This Section)**
- **Confirm Language:** The user wants the summary in **{target_language}**. Your entire output MUST be in **{target_language}**. This is the most important rule.
- **Identify Key Themes:** Deconstruct the transcript into its main thematic parts or topics of discussion.
- **Assess Content Type for Each Theme:** For each theme, determine if it's primarily a presentation of an idea, a collaborative discussion, a critique/feedback session, or a monologue. This will inform how you structure the summary for that section.
</thinking_steps>

<output_rules>
**2. Final Output Generation**
- Your response MUST BE ONLY the Markdown summary. DO NOT include a title, heading, or date at the top. Start directly with the 'Summary' section.
- **WORD COUNT:** {length_instruction} You must strictly adhere to this constraint. Do not deviate.
---
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
- **Add Feedback (ONLY if critique is present):** If a theme consists of clear feedback or a critique session, add a sub-section titled `**Discussion:**`. In this sub-section, use a detailed bulleted list to present every specific piece of feedback or discussion centering around the current section. **This is crucial for design reviews.**
- **For Simple Topics or Lists:** If a theme is just a list of ideas or a very simple point, feel free to use bullet points directly under the heading instead of a full paragraph to keep the summary concise and scannable.
</thematic_body_instructions>
"""
        full_prompt = f"""{system_prompt}

Please summarize the following transcript. CRITICALLY IMPORTANT: Strictly follow all instructions, especially the language ({target_language}) and the word count rule: {length_instruction}

TRANSCRIPT:
---
{full_transcript}"""

        response = openai.responses.create(
            model="gpt-5-mini-2025-08-07",
            input=full_prompt,
            reasoning={"effort": "minimal"},
        )
        return response.output_text.strip()
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
            mtg.summary_length,
            mtg.summary_language_mode,
            mtg.summary_custom_language,
            mtg.context,
        )
        mtg.summary_markdown = summary_md

        # Only generate a title if the current one is still a default placeholder.
        is_default_title = mtg.title.startswith("Recording ") or mtg.title.startswith(
            "Transcription of "
        )
        if summary_md and "error" not in summary_md.lower() and is_default_title:
            new_title = generate_title_for_meeting(summary_md, final_transcript)
            if new_title:
                mtg.title = new_title

        LOGGER.info(
            f"✅ Meeting {mtg.id} summarized and titled successfully by worker."
        )
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


@celery_app.task(name="app.worker.backup_database")
def backup_database():
    """
    Performs a nightly backup of the SQLite database and enforces a
    retention policy, keeping the last 30 backups.
    """
    db_path = settings.db_path
    # Backups will be stored in a 'backups' subdirectory next to the database.
    backup_dir = db_path.parent / "backups"
    retention_count = 30

    backup_dir.mkdir(exist_ok=True)

    if not db_path.exists():
        LOGGER.error(f"Database file not found at {db_path}. Skipping backup.")
        return

    LOGGER.info("Starting nightly database backup...")

    try:
        timestamp = dt.datetime.utcnow().strftime("%Y-%m-%d_%H-%M-%S")
        backup_filename = f"backup_{timestamp}.sqlite3"
        backup_filepath = backup_dir / backup_filename

        # Use SQLite's online backup API for a safe, non-blocking copy.
        # Connecting with mode=ro ensures we don't lock the main DB.
        source_conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        backup_conn = sqlite3.connect(backup_filepath)
        with backup_conn:
            source_conn.backup(backup_conn)
        backup_conn.close()
        source_conn.close()

        LOGGER.info(f"Backup successful: {backup_filename}")

        # --- Retention Policy ---
        LOGGER.info(f"Applying retention policy (keeping last {retention_count})...")
        # Get a list of all backup files, sorted by creation time (newest first).
        all_backups = sorted(
            [
                f
                for f in backup_dir.iterdir()
                if f.is_file() and f.name.startswith("backup_")
            ],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )

        if len(all_backups) > retention_count:
            # Identify the files that are older than the 30 newest ones.
            backups_to_delete = all_backups[retention_count:]
            LOGGER.info(f"Found {len(backups_to_delete)} old backups to delete.")
            for f in backups_to_delete:
                f.unlink()
                LOGGER.info(f"Deleted old backup: {f.name}")

        LOGGER.info("Backup and retention policy complete.")
    except Exception as e:
        LOGGER.error(f"Database backup failed: {e}", exc_info=True)


@celery_app.task(name="app.worker.cleanup_stuck_meetings")
def cleanup_stuck_meetings():
    """
    Finds meetings that are not done and have been inactive for a while,
    then re-queues transcription tasks for any chunks that are missing text.
    Also finalizes meetings that were abandoned mid-recording.
    """
    engine = get_db_engine()
    STUCK_THRESHOLD_MINUTES = 15
    INACTIVITY_TIMEOUT_MINUTES = 5

    with Session(engine) as db:
        # 1. Finalize meetings that were abandoned mid-recording and never got a final chunk.
        inactivity_threshold = dt.datetime.utcnow() - dt.timedelta(
            minutes=INACTIVITY_TIMEOUT_MINUTES
        )
        inactive_meetings = db.exec(
            select(Meeting).where(
                Meeting.done == False,
                Meeting.final_received == False,
                Meeting.last_activity < inactivity_threshold,
            )
        ).all()

        if inactive_meetings:
            LOGGER.info(
                f"Janitor: Found {len(inactive_meetings)} inactive, un-finalized meetings. Finalizing them."
            )
            for mtg in inactive_meetings:
                mtg.final_received = True
                if mtg.expected_chunks is None:
                    mtg.expected_chunks = mtg.received_chunks
                db.add(mtg)
            db.commit()  # Commit finalization before potentially re-queueing

        # 2. Re-queue tasks for finalized meetings that got stuck during transcription.
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
            f"Janitor: Found {len(stuck_meetings)} potentially stuck finalized meetings."
        )

        for mtg in stuck_meetings:
            unprocessed_chunks = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == mtg.id, MeetingChunk.text.is_(None)
                )
            ).all()

            if not unprocessed_chunks:
                LOGGER.info(
                    f"Janitor: Meeting {mtg.id} has no unprocessed chunks, but isn't 'done'. Re-triggering finalization."
                )
                # This can happen if the finalization task itself failed.
                finalize_meeting_processing(db, mtg)
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
                        f"Janitor: Chunk path {chunk.path} for meeting {mtg.id}, chunk {chunk.index} does not exist. Cannot re-queue."
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


def generate_section_content_for_type(
    section_type: str,
    transcript: str,
    context: str | None,
    meeting_title: str,
    section_title: str = "",
    summary_length: str = "auto",
    target_language: str = "English",
) -> str:
    """Generate AI content for different section types."""
    if not openai.api_key:
        openai.api_key = settings.openai_api_key

    # Length adjustments based on summary length setting
    LENGTH_ADJUSTMENTS = {
        "quar_page": "Keep extremely brief: 2-3 key points maximum",
        "half_page": "Keep concise: 3-4 key points maximum", 
        "one_page": "Keep moderate: 4-5 key points maximum",
        "two_pages": "Can be detailed: 5-7 key points maximum",
        "auto": "Keep concise: 3-5 key points maximum"
    }
    length_instruction = LENGTH_ADJUSTMENTS.get(summary_length, LENGTH_ADJUSTMENTS["auto"])

    SECTION_PROMPTS = {
        "timeline": {
            "system": f"Create chronological breakdowns efficiently in {target_language}. Work with minimal reasoning, following instructions precisely.",
            "prompt": f"""Create a chronological timeline of the key moments in this meeting titled "{meeting_title}". 

CRITICAL REQUIREMENTS:
- {length_instruction}
- Write your entire response in {target_language}
- Use simple bullet points or short paragraphs
- NO subsections, NO markdown headers (###, ##, #)
- Focus only on the most important transitions and decisions

Format as brief timeline entries.

Context: {context or 'None provided'}

Transcript: {transcript[:3000]}""",
        },
        "key_points": {
            "system": f"Extract key points efficiently in {target_language}. Work with minimal reasoning, following instructions precisely.",
            "prompt": f"""Extract the most important key points from this meeting titled "{meeting_title}".

CRITICAL REQUIREMENTS:
- {length_instruction}
- Write your entire response in {target_language}
- Use simple bullet points or short paragraphs
- NO subsections, NO markdown headers (###, ##, #)
- Focus only on the most critical insights and information

Format as brief key points.

Context: {context or 'None provided'}

Transcript: {transcript[:3000]}""",
        },
        "feedback_suggestions": {
            "system": f"Provide improvement recommendations efficiently in {target_language}. Work with minimal reasoning, following instructions precisely.",
            "prompt": f"""Analyze this meeting titled "{meeting_title}" and provide constructive feedback and suggestions for improvement.

CRITICAL REQUIREMENTS:
- {length_instruction}
- Write your entire response in {target_language}
- Use simple bullet points or short paragraphs
- NO subsections, NO markdown headers (###, ##, #)
- Focus only on the most actionable improvements

Provide brief, specific recommendations.

Context: {context or 'None provided'}

Transcript: {transcript[:3000]}""",
        },
        "metrics": {
            "system": f"Extract quantitative insights efficiently in {target_language}. Work with minimal reasoning, following instructions precisely.",
            "prompt": f"""Analyze the metrics and measurable aspects of this meeting titled "{meeting_title}".

CRITICAL REQUIREMENTS:
- {length_instruction}
- Write your entire response in {target_language}
- Use simple bullet points or short paragraphs
- NO subsections, NO markdown headers (###, ##, #)
- Focus only on the most relevant quantitative insights

Present as brief data points.

Context: {context or 'None provided'}

Transcript: {transcript[:3000]}""",
        },
    }

    if section_type not in SECTION_PROMPTS:
        # Handle AI-generated or custom section types
        prompt = f"""Create focused content for a section titled "{section_title}" based on this meeting.

CRITICAL REQUIREMENTS:
- Do NOT repeat the section title "{section_title}" in your response
- {length_instruction}
- Write your entire response in {target_language}
- NO subsections, NO markdown headers (###, ##, #)
- Use simple bullet points or short paragraphs
- Be concise and to-the-point

Based on the section title, extract only the most essential information:
- Actions/tasks: List only the most critical action items
- Decisions: Highlight only key decisions made
- Discussions: Summarize only main points discussed
- Outcomes: Focus only on final conclusions
- Participants: Note only key contributors
- Follow-ups: List only immediate next steps

Keep it brief, actionable, and scan-friendly.

Meeting: "{meeting_title}"
Context: {context or 'None provided'}
Transcript: {transcript[:3000]}"""

        try:
            response = openai.responses.create(
                model="gpt-5-mini-2025-08-07",
                input=f"""Create helpful section content efficiently. Work with minimal reasoning, following instructions precisely.

{prompt}""",
                reasoning={"effort": "minimal"},
            )
            return response.output_text.strip()
        except Exception as e:
            LOGGER.error(
                f"Generic section content generation failed for {section_type}: {e}",
                exc_info=True,
            )
            return f"Error generating content for {section_type}: {str(e)}"

    try:
        prompt_config = SECTION_PROMPTS[section_type]

        response = openai.responses.create(
            model="gpt-5-mini-2025-08-07",
            input=f"""{prompt_config["system"]}

{prompt_config["prompt"]}""",
            reasoning={"effort": "minimal"},
        )

        return response.output_text.strip()
    except Exception as e:
        LOGGER.error(
            f"Section content generation failed for {section_type}: {e}", exc_info=True
        )
        return f"Error generating content for {section_type}: {str(e)}"


@celery_app.task(
    name="app.worker.generate_section_content",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=60,
)
def generate_section_content(self, section_id_str: str, meeting_id_str: str):
    """Generate AI content for a specific section."""
    engine = get_db_engine()
    section_id = int(section_id_str)
    meeting_id = uuid.UUID(meeting_id_str)

    try:
        with Session(engine) as db:
            section = db.get(MeetingSection, section_id)
            if not section:
                LOGGER.error(f"Section {section_id} not found")
                return

            meeting = db.get(Meeting, meeting_id)
            if not meeting:
                LOGGER.error(f"Meeting {meeting_id} not found")
                return

            # Get transcript text
            transcript = meeting.transcript_text
            if not transcript:
                # Try to build from chunks
                transcript, _ = rebuild_full_transcript(db, meeting_id)

            if not transcript:
                section.content = (
                    "Error: No transcript available for content generation"
                )
                section.is_generating = False
                db.add(section)
                db.commit()
                return

            LOGGER.info(
                f"Generating content for section {section_id} ({section.section_type})"
            )

            # Determine target language based on meeting settings
            if meeting.summary_language_mode == "custom" and meeting.summary_custom_language:
                target_language = meeting.summary_custom_language
            elif meeting.summary_language_mode == "english":
                target_language = "English"
            else:  # 'auto' or any other case
                # Use detected language from transcript
                transcript_snippet = transcript[:2000] if transcript else ""
                target_language = detect_language_local(transcript_snippet)

            # Generate content
            content = generate_section_content_for_type(
                section.section_type,
                transcript,
                meeting.context,
                meeting.title,
                section.title,
                meeting.summary_length,
                target_language,
            )

            # Update section
            section.content = content
            section.is_generating = False
            section.updated_at = dt.datetime.utcnow()
            db.add(section)
            db.commit()

            LOGGER.info(f"✅ Generated content for section {section_id}")

    except Exception as exc:
        LOGGER.error(
            f"Error generating section content {section_id}: {exc}", exc_info=True
        )

        # Mark as failed
        try:
            with Session(engine) as db:
                section = db.get(MeetingSection, section_id)
                if section:
                    section.content = f"Error generating content: {str(exc)}"
                    section.is_generating = False
                    section.updated_at = dt.datetime.utcnow()
                    db.add(section)
                    db.commit()
        except:
            pass

        self.retry(exc=exc)
