# backend/app/tasks.py
import logging
import datetime as dt
import uuid
import time
from pathlib import Path
import shutil
import subprocess
import sqlite3
import re

from faster_whisper import WhisperModel
from groq import Groq
import openai
from sqlmodel import Session, select, func, create_engine
from langdetect import detect, DetectorFactory
from langdetect.lang_detect_exception import LangDetectException

from .config import settings
from .models import Meeting, MeetingChunk

LOGGER = logging.getLogger("meetscribe_tasks")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s][%(module)s.%(funcName)s:%(lineno)d] %(message)s",
)

DetectorFactory.seed = 0

SUMMARY_MODEL = "gpt-5.4"
SUMMARY_REASONING = {"effort": "none"}

# Module-level executor reference — set by main.py at startup via set_executor().
# Needed so cleanup_stuck_meetings() can re-queue tasks without a circular import.
_executor = None


def set_executor(executor):
    global _executor
    _executor = executor


_whisper_model_instance = None
_db_engine_instance = None
_groq_client = (
    Groq(api_key=settings.groq_api_key) if settings.recognition_in_cloud else None
)


def get_db_engine():
    global _db_engine_instance
    if _db_engine_instance is None:
        LOGGER.info("Initializing DB engine for task worker.")
        _db_engine_instance = create_engine(f"sqlite:///{settings.db_path}", echo=False)
    return _db_engine_instance


def get_whisper_model():
    global _whisper_model_instance
    if _whisper_model_instance is None:
        LOGGER.info(
            "🔊 Loading Whisper model (%s)…",
            settings.whisper_model_size,
        )
        _whisper_model_instance = WhisperModel(
            settings.whisper_model_size, device="cpu", compute_type="int8"
        )
        LOGGER.info("✅ Whisper model loaded.")
    return _whisper_model_instance


def transcribe_webm_chunk_in_worker(chunk_path_str: str) -> str:
    """Transcribes an audio chunk using either a cloud API (Groq) or a local model."""
    chunk_path = Path(chunk_path_str)
    try:
        if settings.recognition_in_cloud:
            path_to_transcribe = chunk_path
            output_flac_path = None
            if shutil.which("ffmpeg"):
                output_flac_path = chunk_path.with_suffix(".flac")
                try:
                    command = [
                        "ffmpeg", "-i", str(chunk_path), "-y", "-vn",
                        "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
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
                LOGGER.warning("ffmpeg not found. Sending original WebM file to cloud API.")

            try:
                with open(path_to_transcribe, "rb") as audio_file:
                    resp = _groq_client.audio.transcriptions.create(
                        file=(path_to_transcribe.name, audio_file.read()),
                        model="whisper-large-v3",
                        response_format="verbose_json",
                    )
                LOGGER.info(f"Cloud transcription succeeded for {path_to_transcribe.name}")
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
        LOGGER.error(f"Failed to transcribe {chunk_path.name}: {e}", exc_info=True)
        return ""


def generate_title_for_meeting(summary: str, full_transcript: str) -> str:
    if not summary or "error" in summary.lower() or "too short" in summary.lower():
        LOGGER.info("Summary is too short or an error, cannot generate title.")
        return ""
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
        response = openai.responses.create(
            model=SUMMARY_MODEL,
            input=f"""Create a concise meeting title efficiently. Follow instructions precisely with minimal reasoning.

{title_prompt}""",
            reasoning=SUMMARY_REASONING,
        )
        generated_title = response.output_text.strip().strip('"')
        LOGGER.info(f"Generated meeting title: '{generated_title}'")
        return generated_title
    except Exception as e:
        LOGGER.error(f"Title generation failed: {e}", exc_info=True)
        return ""


def detect_language_local(text_snippet: str) -> str:
    if not text_snippet:
        return "English"
    try:
        lang_code = detect(text_snippet)
        LANG_MAP = {
            "ar": "Arabic", "cs": "Czech", "da": "Danish", "de": "German",
            "en": "English", "es": "Spanish", "fi": "Finnish", "fr": "French",
            "he": "Hebrew", "hi": "Hindi", "hu": "Hungarian", "id": "Indonesian",
            "it": "Italian", "ja": "Japanese", "ko": "Korean", "nl": "Dutch",
            "no": "Norwegian", "pl": "Polish", "pt": "Portuguese", "ro": "Romanian",
            "ru": "Russian", "sk": "Slovak", "sv": "Swedish", "sw": "Swahili",
            "th": "Thai", "tr": "Turkish", "vi": "Vietnamese",
            "zh-cn": "Chinese (Simplified)", "zh-tw": "Chinese (Traditional)",
        }
        language = LANG_MAP.get(lang_code, "English")
        LOGGER.info(f"Detected language via langdetect: {language} ({lang_code})")
        return language
    except LangDetectException:
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
        transcript_snippet = full_transcript[:2000]
        detected_language = detect_language_local(transcript_snippet)

        if summary_language_mode == "custom" and summary_custom_language:
            target_language = summary_custom_language
        elif summary_language_mode == "english":
            target_language = "English"
        else:
            target_language = detected_language

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
- Your response MUST BE ONLY the Markdown summary. DO NOT include a title or date at the top.
- **WORD COUNT:** {length_instruction} You must strictly adhere to this constraint. Do not deviate.
- **HEADINGS:** Use `####` for the initial overview and `###` for subsequent thematic sections. Headings should be descriptive and concise. **DO NOT** start headings with prefixes like "Theme:", "Topic:", or "Summary:".
---
#### Overview
Write an insightful overview paragraph (3-5 sentences). It should set the scene, describe the main purpose of the conversation, and touch upon the key conclusions or outcomes. Start the paragraph directly, without any prefix.

*(...Generate thematic sections below this point, each starting with a `###` heading...)*

---
#### Key Decisions & Action Items
- This section is mandatory unless there were absolutely no decisions or actions.
- List all firm decisions made and all actionable next steps. This section should use bullet points.
- **Format:** `- **[Topic/Owner]:** [Detailed description of the action or decision, including necessary context].`
</output_rules>

<thematic_body_instructions>
After the 'Overview' section, create a `###` heading for each major theme you identified.
- Under each heading, write a clear paragraph summarizing the main points of discussion for that theme. Explain the core arguments, proposals, and conclusions. **Start the paragraph directly, without any prefix.**
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
            model=SUMMARY_MODEL,
            input=full_prompt,
            reasoning=SUMMARY_REASONING,
        )
        return response.output_text.strip()
    except Exception as e:
        LOGGER.error(f"Summary generation failed: {e}", exc_info=True)
        return "Error: Summary generation failed."


def rebuild_full_transcript(
    db_session: Session, meeting_id_uuid: uuid.UUID
) -> tuple[str, int]:
    chunks = db_session.exec(
        select(MeetingChunk.text)
        .where(MeetingChunk.meeting_id == meeting_id_uuid)
        .where(MeetingChunk.text.is_not(None))
        .order_by(MeetingChunk.chunk_index)
    ).all()
    transcript_text = " ".join(text for text in chunks if text).strip()
    return transcript_text, len(chunks)


def finalize_meeting_processing(db: Session, mtg: Meeting):
    LOGGER.info(f"Meeting {mtg.id}: Finalizing. Building transcript and summarizing.")
    final_transcript, num_chunks = rebuild_full_transcript(db, mtg.id)
    mtg.transcript_text = final_transcript

    if final_transcript:
        mtg.word_count = len(final_transcript.split())
        mtg.duration_seconds = num_chunks * 30

        summary_md = summarise_transcript_in_worker(
            final_transcript,
            mtg.summary_length,
            mtg.summary_language_mode,
            mtg.summary_custom_language,
            mtg.context,
        )
        mtg.summary_markdown = summary_md

        is_default_title = mtg.title.startswith("Recording ") or mtg.title.startswith(
            "Transcription of "
        )
        if summary_md and "error" not in summary_md.lower() and is_default_title:
            new_title = generate_title_for_meeting(summary_md, final_transcript)
            if new_title:
                mtg.title = new_title

        LOGGER.info(f"✅ Meeting {mtg.id} summarized and titled successfully.")
    else:
        LOGGER.warning(f"Meeting {mtg.id}: Transcript text is empty, cannot generate summary.")
        mtg.word_count = 0
        mtg.duration_seconds = 0
        mtg.summary_markdown = "Error: Transcript was empty, summary could not be generated."

    mtg.done = True
    db.add(mtg)
    db.commit()


def backup_database():
    """Nightly backup of the SQLite database with 30-file retention."""
    db_path = settings.db_path
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

        source_conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        backup_conn = sqlite3.connect(backup_filepath)
        with backup_conn:
            source_conn.backup(backup_conn)
        backup_conn.close()
        source_conn.close()

        LOGGER.info(f"Backup successful: {backup_filename}")

        all_backups = sorted(
            [f for f in backup_dir.iterdir() if f.is_file() and f.name.startswith("backup_")],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        if len(all_backups) > retention_count:
            for f in all_backups[retention_count:]:
                f.unlink()
                LOGGER.info(f"Deleted old backup: {f.name}")

        LOGGER.info("Backup and retention policy complete.")
    except Exception as e:
        LOGGER.error(f"Database backup failed: {e}", exc_info=True)


def cleanup_stuck_meetings():
    """
    Finds stuck/inactive meetings and recovers them.
    Re-queues transcription tasks via the module-level executor.
    """
    engine = get_db_engine()
    STUCK_THRESHOLD_MINUTES = 15
    INACTIVITY_TIMEOUT_MINUTES = 5

    with Session(engine) as db:
        inactivity_threshold = dt.datetime.utcnow() - dt.timedelta(minutes=INACTIVITY_TIMEOUT_MINUTES)
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
            db.commit()

        stuck_threshold = dt.datetime.utcnow() - dt.timedelta(minutes=STUCK_THRESHOLD_MINUTES)
        stuck_meetings = db.exec(
            select(Meeting).where(
                Meeting.done == False,
                Meeting.final_received == True,
                Meeting.last_activity < stuck_threshold,
            )
        ).all()

        if not stuck_meetings:
            return

        LOGGER.info(f"Janitor: Found {len(stuck_meetings)} potentially stuck finalized meetings.")

        for mtg in stuck_meetings:
            unprocessed_chunks = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == mtg.id, MeetingChunk.text.is_(None)
                )
            ).all()

            if not unprocessed_chunks:
                LOGGER.info(
                    f"Janitor: Meeting {mtg.id} has no unprocessed chunks but isn't done. Re-triggering finalization."
                )
                finalize_meeting_processing(db, mtg)
                continue

            LOGGER.warning(f"Meeting {mtg.id} is stuck. Re-queueing {len(unprocessed_chunks)} chunk(s).")
            mtg.last_activity = dt.datetime.utcnow()
            db.add(mtg)
            db.commit()

            for chunk in unprocessed_chunks:
                chunk_path = Path(chunk.path)
                if chunk_path.exists():
                    if _executor:
                        _executor.submit(
                            process_transcription_and_summary,
                            str(mtg.id),
                            chunk.chunk_index,
                            str(chunk_path.resolve()),
                        )
                    else:
                        LOGGER.error("Janitor: executor not set, cannot re-queue chunk.")
                else:
                    LOGGER.error(
                        f"Janitor: Chunk path {chunk.path} does not exist. Cannot re-queue."
                    )


def process_transcription_and_summary(
    meeting_id_str: str, chunk_index: int, chunk_path_str: str
):
    engine = get_db_engine()
    meeting_id_uuid = uuid.UUID(meeting_id_str)

    for attempt in range(3):
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
                    mtg.expected_chunks if mtg.expected_chunks is not None else mtg.received_chunks
                )
                if (
                    not mtg.done
                    and mtg.final_received
                    and effective_expected > 0
                    and transcribed_count >= effective_expected
                ):
                    finalize_meeting_processing(db, mtg)
            return  # success
        except Exception as exc:
            LOGGER.error(
                f"Error processing task for {meeting_id_str}, chunk {chunk_index} (attempt {attempt + 1}): {exc}",
                exc_info=True,
            )
            if attempt < 2:
                time.sleep(60)


def generate_summary_only(meeting_id_str: str):
    engine = get_db_engine()
    meeting_id = uuid.UUID(meeting_id_str)

    for attempt in range(3):
        try:
            with Session(engine) as db:
                mtg = db.get(Meeting, meeting_id)
                if not mtg:
                    LOGGER.error("Meeting %s not found for summary regen.", meeting_id_str)
                    return
                if mtg.done:
                    LOGGER.info("Meeting %s already summarized. Aborting regen.", meeting_id_str)
                    return
                LOGGER.info("♻️  Regenerating summary for meeting %s", meeting_id_str)
                finalize_meeting_processing(db, mtg)
                LOGGER.info("✅ Summary regenerated for meeting %s", meeting_id_str)
            return  # success
        except Exception as exc:
            LOGGER.error(
                f"Error regenerating summary for {meeting_id_str} (attempt {attempt + 1}): {exc}",
                exc_info=True,
            )
            if attempt < 2:
                time.sleep(60)


def translate_text(text: str, target_language: str, context: str | None) -> str:
    if not text or not text.strip():
        return text
    context_prompt = ""
    if context and context.strip():
        context_prompt = (
            f"Use this context for consistent terminology: <context>{context}</context>"
        )
    try:
        response = openai.responses.create(
            model=SUMMARY_MODEL,
            input=f"""Translate the following text into {target_language}.
Maintain original formatting (like markdown headers and lists).
{context_prompt}
Only return the translated text.

<text_to_translate>
{text}
</text_to_translate>""",
            reasoning=SUMMARY_REASONING,
        )
        return response.output_text.strip()
    except Exception as e:
        LOGGER.error(f"Text translation failed: {e}", exc_info=True)
        return f"Error: Translation to {target_language} failed."


def translate_meeting_markdown(meeting_id_str: str, target_language: str):
    """Translates the full summary_markdown of a meeting to a new language."""
    engine = get_db_engine()
    meeting_id = uuid.UUID(meeting_id_str)

    for attempt in range(3):
        try:
            LOGGER.info(f"Starting markdown translation for meeting {meeting_id} to {target_language}")
            with Session(engine) as db:
                meeting = db.get(Meeting, meeting_id)
                if not meeting:
                    LOGGER.error(f"Meeting {meeting_id} not found for translation.")
                    return

                if not meeting.summary_markdown:
                    LOGGER.warning(f"No summary markdown to translate for meeting {meeting_id}.")
                    meeting.done = True
                    db.add(meeting)
                    db.commit()
                    return

                translated = translate_text(meeting.summary_markdown, target_language, meeting.context)
                meeting.summary_markdown = translated
                meeting.done = True
                db.add(meeting)
                db.commit()
                LOGGER.info(f"✅ Markdown translation complete for meeting {meeting_id}")
            return
        except Exception as exc:
            LOGGER.error(
                f"Markdown translation failed for {meeting_id_str} (attempt {attempt + 1}): {exc}",
                exc_info=True,
            )
            if attempt < 2:
                time.sleep(60)

    # Ensure meeting is marked done even if all attempts failed
    try:
        with Session(engine) as db:
            meeting = db.get(Meeting, meeting_id)
            if meeting and not meeting.done:
                meeting.done = True
                db.add(meeting)
                db.commit()
    except Exception:
        pass
