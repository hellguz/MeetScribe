# backend/app/tasks.py
from __future__ import annotations

import logging
import datetime as dt
import uuid
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shutil
import subprocess
import sqlite3
import re

from faster_whisper import WhisperModel
from groq import Groq
import anthropic
from sqlmodel import Session, select, func, create_engine
from langdetect import detect, DetectorFactory
from langdetect.lang_detect_exception import LangDetectException

import json
from dataclasses import dataclass, field

from .config import settings
from .models import Meeting, MeetingChunk
from . import prompts as P
from . import diarization

LOGGER = logging.getLogger("meetscribe_tasks")

DetectorFactory.seed = 0

# Module-level executor reference — set by main.py at startup via set_executor().
# Needed so cleanup_stuck_meetings() can re-queue tasks without a circular import.
_executor: ThreadPoolExecutor | None = None


def set_executor(executor: ThreadPoolExecutor) -> None:
    global _executor
    _executor = executor


_whisper_model_instance: WhisperModel | None = None
_db_engine_instance = None
_groq_client: Groq | None = (
    Groq(api_key=settings.groq_api_key) if settings.recognition_in_cloud else None
)
_anthropic_client: anthropic.Anthropic = anthropic.Anthropic(api_key=settings.anthropic_api_key)


def get_db_engine():
    global _db_engine_instance
    if _db_engine_instance is None:
        LOGGER.info("Initializing DB engine for task worker.")
        _db_engine_instance = create_engine(f"sqlite:///{settings.db_path}", echo=False)
    return _db_engine_instance


def get_whisper_model() -> WhisperModel:
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


@dataclass
class ChunkTranscription:
    """Text plus per-segment timings, both chunk-relative."""

    text: str
    segments: list[dict] = field(default_factory=list)


def _normalise_segments(raw) -> list[dict]:
    """Coerce Groq/Whisper segment objects (dicts or attr objects) to plain dicts."""
    out = []
    for seg in raw or []:
        get = seg.get if isinstance(seg, dict) else lambda k, d=None: getattr(seg, k, d)
        text = (get("text") or "").strip()
        if not text:
            continue
        try:
            out.append({"start": float(get("start") or 0.0), "end": float(get("end") or 0.0), "text": text})
        except (TypeError, ValueError):
            continue
    return out


def transcribe_webm_chunk_in_worker(chunk_path_str: str) -> ChunkTranscription:
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
                    LOGGER.info("Successfully converted %s to FLAC.", chunk_path.name)
                except subprocess.CalledProcessError as e:
                    LOGGER.error(
                        "ffmpeg conversion failed for %s: %s. Will send original.",
                        chunk_path.name, e.stderr,
                    )
                    path_to_transcribe = chunk_path
            else:
                LOGGER.warning("ffmpeg not found. Sending original WebM file to cloud API.")

            assert _groq_client is not None, "Groq client not initialised"
            try:
                with open(path_to_transcribe, "rb") as audio_file:
                    resp = _groq_client.audio.transcriptions.create(
                        file=(path_to_transcribe.name, audio_file.read()),
                        model="whisper-large-v3",
                        response_format="verbose_json",
                    )
                LOGGER.info("Cloud transcription succeeded for %s", path_to_transcribe.name)
                # verbose_json carries segments, but the SDK only types `text`,
                # so read them from the model's extra fields.
                extra = getattr(resp, "model_extra", None) or {}
                raw_segments = getattr(resp, "segments", None) or extra.get("segments")
                return ChunkTranscription(
                    text=resp.text.strip(), segments=_normalise_segments(raw_segments)
                )
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
            segment_list = list(segments)
            # Text is joined exactly as before, so switching diarization on
            # cannot change the words themselves.
            return ChunkTranscription(
                text=" ".join(s.text for s in segment_list).strip(),
                segments=_normalise_segments(segment_list),
            )
    except Exception as e:
        LOGGER.error("Failed to transcribe %s: %s", chunk_path.name, e, exc_info=True)
        # Must be a ChunkTranscription, not "": callers read .text off it.
        return ChunkTranscription(text="")


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
        response = _anthropic_client.messages.create(
            model=settings.summary_model,
            max_tokens=256,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": f"""Create a concise meeting title efficiently. Follow instructions precisely.

{title_prompt}"""}],
        )
        generated_title = response.content[0].text.strip().strip('"')
        LOGGER.info("Generated meeting title: '%s'", generated_title)
        return generated_title
    except Exception as e:
        LOGGER.error("Title generation failed: %s", e, exc_info=True)
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
        LOGGER.info("Detected language via langdetect: %s (%s)", language, lang_code)
        return language
    except LangDetectException:
        LOGGER.warning("Langdetect failed for snippet, defaulting to English.")
        return "English"


_SPEAKER_LINE = re.compile(r"^Speaker \d+:", re.MULTILINE)


def looks_diarized(transcript: str) -> bool:
    """True if the transcript carries speaker labels.

    Derived from the text itself so regenerating a summary from a stored
    transcript keeps the speaker guidance without extra bookkeeping.
    """
    return bool(transcript) and bool(_SPEAKER_LINE.search(transcript))


def summarise_transcript_in_worker(
    full_transcript: str,
    summary_length: str,
    summary_language_mode: str | None,
    summary_custom_language: str | None,
    context: str | None,
    meeting_date: str | None = None,
    duration_seconds: int | None = None,
) -> str:
    if not full_transcript or len(full_transcript.strip().split()) < 25:
        return "Recording is too brief to generate a meaningful summary."
    try:
        detected_language = detect_language_local(full_transcript[:2000])

        if summary_language_mode == "custom" and summary_custom_language:
            target_language = summary_custom_language
        elif summary_language_mode == "english":
            target_language = "English"
        else:
            target_language = detected_language

        context_section = ""
        if looks_diarized(full_transcript):
            # Kept in the instruction section rather than inside the transcript
            # block, so every summary template picks it up unchanged.
            context_section += P.SPEAKER_NOTE
        if context and context.strip():
            # `+=` not `=`: a plain assignment here discarded the speaker note
            # whenever the user had supplied context.
            context_section += f"""
<user_provided_context>
Critical context from the user — use as source of truth for names, projects, and technical terms.
---
{context}
---
</user_provided_context>
"""

        # Map legacy / unknown modes to narrative
        mode = summary_length if summary_length in ("briefing", "essence", "narrative", "minutes") else "narrative"

        date_str = meeting_date or dt.datetime.utcnow().strftime("%Y-%m-%d")
        duration_str = f"~{duration_seconds // 60} min" if duration_seconds else "unknown"

        template_map = {
            "briefing": P.BRIEFING,
            "essence": P.ESSENCE,
            "narrative": P.NARRATIVE,
            "minutes": P.MINUTES,
        }
        prompt = template_map[mode].format(
            target_language=target_language,
            context_section=context_section,
            full_transcript=full_transcript,
            date=date_str,
            duration=duration_str,
        )

        # Restate the target language after the transcript. The instruction at
        # the top of the template is a long way from where generation starts,
        # and has been observed to drift (a German transcript summarised in
        # Polish). This also covers the briefing template, which never
        # interpolated {target_language} at all.
        prompt += (
            f"\n\n---\n\nWrite the entire summary in {target_language}, "
            "regardless of the language of the transcript. Quotations may stay "
            "in their original language."
        )

        response = _anthropic_client.messages.create(
            model=settings.summary_model,
            max_tokens=8096,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        LOGGER.error("Summary generation failed: %s", e, exc_info=True)
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


def finalize_meeting_processing(db: Session, mtg: Meeting) -> None:
    LOGGER.info("Meeting %s: Finalizing. Building transcript and summarizing.", mtg.id)
    plain_transcript, num_chunks = rebuild_full_transcript(db, mtg.id)

    # Word count comes from the unlabelled text so the number stays comparable
    # with meetings recorded before diarization existed.
    word_count = len(plain_transcript.split()) if plain_transcript else 0

    final_transcript = plain_transcript
    duration_seconds = num_chunks * 30

    if plain_transcript and diarization.is_enabled():
        mtg.processing_stage = "diarizing"
        db.add(mtg)
        db.commit()  # publish the stage before a multi-minute job

        chunk_rows = db.exec(
            select(
                MeetingChunk.chunk_index, MeetingChunk.text,
                MeetingChunk.segments_json, MeetingChunk.path,
            )
            .where(MeetingChunk.meeting_id == mtg.id)
            .order_by(MeetingChunk.chunk_index)
        ).all()

        result = diarization.diarize_meeting(
            [(r.chunk_index, Path(r.path)) for r in chunk_rows if r.path],
            [(r.chunk_index, r.text, r.segments_json) for r in chunk_rows],
        )
        if result:
            final_transcript, speakers, audio_seconds = result
            mtg.speaker_count = speakers
            # Real decoded length; chunk_count * 30 is only a guess.
            duration_seconds = int(round(audio_seconds))

    mtg.transcript_text = final_transcript

    if final_transcript:
        mtg.word_count = word_count
        mtg.duration_seconds = duration_seconds

        mtg.processing_stage = "summarizing"
        db.add(mtg)
        db.commit()

        summary_md = summarise_transcript_in_worker(
            final_transcript,
            mtg.summary_length,
            mtg.summary_language_mode,
            mtg.summary_custom_language,
            mtg.context,
            meeting_date=mtg.started_at.strftime("%Y-%m-%d") if mtg.started_at else None,
            duration_seconds=duration_seconds,
        )
        mtg.summary_markdown = summary_md

        is_default_title = mtg.title.startswith("Recording ") or mtg.title.startswith(
            "Transcription of "
        )
        if summary_md and "error" not in summary_md.lower() and is_default_title:
            new_title = generate_title_for_meeting(summary_md, final_transcript)
            if new_title:
                mtg.title = new_title

        LOGGER.info("✅ Meeting %s summarized and titled successfully.", mtg.id)
    else:
        LOGGER.warning("Meeting %s: Transcript text is empty, cannot generate summary.", mtg.id)
        mtg.word_count = 0
        mtg.duration_seconds = 0
        mtg.summary_markdown = "Error: Transcript was empty, summary could not be generated."

    mtg.processing_stage = None
    mtg.done = True
    db.add(mtg)
    db.commit()


def meeting_audio_chunks(db: Session, meeting_id: uuid.UUID) -> list[MeetingChunk]:
    """
    Chunks whose audio is still on disk. Audio is only removed when a meeting is
    deleted, but meetings recorded before retention existed may have none — and
    without audio there is nothing to diarize.
    """
    chunks = db.exec(
        select(MeetingChunk)
        .where(MeetingChunk.meeting_id == meeting_id)
        .order_by(MeetingChunk.chunk_index)
    ).all()

    available = []
    for chunk in chunks:
        if not chunk.path:
            continue
        try:
            path = Path(chunk.path)
            # The final chunk is an empty signalling blob; ignore those.
            if path.exists() and path.stat().st_size > 100:
                available.append(chunk)
        except OSError:
            continue
    return available


def rediarize_meeting_in_worker(meeting_id_str: str, retranscribe: bool = True) -> None:
    """
    Re-run diarization and the summary for a meeting that already finished.

    Used for recordings made before speaker labels existed, and after changing
    the diarization settings. Meetings from before `segments_json` existed have
    no timings to merge against, so their chunks are transcribed again first.
    """
    engine = get_db_engine()
    meeting_id = uuid.UUID(meeting_id_str)

    try:
        with Session(engine) as db:
            mtg = db.get(Meeting, meeting_id)
            if not mtg:
                LOGGER.error("Meeting %s not found for re-diarization.", meeting_id_str)
                return

            chunks = meeting_audio_chunks(db, meeting_id)
            if not chunks:
                LOGGER.error(
                    "Meeting %s has no audio on disk; cannot re-diarize.", meeting_id_str
                )
                mtg.processing_stage = None
                mtg.done = True
                db.add(mtg)
                db.commit()
                return

            if retranscribe:
                missing = [c for c in chunks if not c.segments_json]
                if missing:
                    LOGGER.info(
                        "♻️  Meeting %s: rebuilding timings for %d chunk(s).",
                        meeting_id_str, len(missing),
                    )
                    mtg.processing_stage = "transcribing"
                    db.add(mtg)
                    db.commit()

                    for chunk in missing:
                        try:
                            result = transcribe_webm_chunk_in_worker(chunk.path)
                        except Exception as exc:
                            LOGGER.warning(
                                "Chunk %d could not be re-transcribed: %s",
                                chunk.chunk_index, exc,
                            )
                            continue
                        if not result.segments:
                            continue
                        chunk.segments_json = json.dumps(result.segments)
                        # Store the matching text too, so words and timings can
                        # never come from different transcription runs.
                        if result.text:
                            chunk.text = result.text
                        db.add(chunk)
                    db.commit()

            LOGGER.info("♻️  Meeting %s: re-running diarization and summary.", meeting_id_str)
            mtg.done = False
            mtg.summary_task_queued = False
            finalize_meeting_processing(db, mtg)
            LOGGER.info("✅ Meeting %s re-diarized.", meeting_id_str)

    except Exception:
        LOGGER.exception("Re-diarization failed for %s.", meeting_id_str)
        # Never leave the meeting stuck un-done, or the UI polls forever.
        try:
            with Session(engine) as db:
                mtg = db.get(Meeting, meeting_id)
                if mtg and not mtg.done:
                    mtg.processing_stage = None
                    mtg.done = True
                    db.add(mtg)
                    db.commit()
        except Exception:
            LOGGER.exception("Could not restore state for %s.", meeting_id_str)


def backup_database() -> None:
    """Nightly backup of the SQLite database with 30-file retention."""
    db_path = settings.db_path
    backup_dir = db_path.parent / "backups"
    retention_count = 30

    backup_dir.mkdir(exist_ok=True)

    if not db_path.exists():
        LOGGER.error("Database file not found at %s. Skipping backup.", db_path)
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

        LOGGER.info("Backup successful: %s", backup_filename)

        all_backups = sorted(
            [f for f in backup_dir.iterdir() if f.is_file() and f.name.startswith("backup_")],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        if len(all_backups) > retention_count:
            for f in all_backups[retention_count:]:
                f.unlink()
                LOGGER.info("Deleted old backup: %s", f.name)

        LOGGER.info("Backup and retention policy complete.")
    except Exception as e:
        LOGGER.error("Database backup failed: %s", e, exc_info=True)


def cleanup_stuck_meetings() -> None:
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
                "Janitor: Found %d inactive, un-finalized meetings. Finalizing them.",
                len(inactive_meetings),
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

        LOGGER.info("Janitor: Found %d potentially stuck finalized meetings.", len(stuck_meetings))

        for mtg in stuck_meetings:
            unprocessed_chunks = db.exec(
                select(MeetingChunk).where(
                    MeetingChunk.meeting_id == mtg.id, MeetingChunk.text.is_(None)
                )
            ).all()

            if not unprocessed_chunks:
                LOGGER.info(
                    "Janitor: Meeting %s has no unprocessed chunks but isn't done. Re-triggering finalization.",
                    mtg.id,
                )
                finalize_meeting_processing(db, mtg)
                continue

            LOGGER.warning("Meeting %s is stuck. Re-queueing %d chunk(s).", mtg.id, len(unprocessed_chunks))
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
                        "Janitor: Chunk path %s does not exist. Cannot re-queue.", chunk.path
                    )


def process_transcription_and_summary(
    meeting_id_str: str, chunk_index: int, chunk_path_str: str
) -> None:
    engine = get_db_engine()
    meeting_id_uuid = uuid.UUID(meeting_id_str)

    for attempt in range(3):
        try:
            transcription = transcribe_webm_chunk_in_worker(chunk_path_str)
            with Session(engine) as db:
                mc = db.exec(
                    select(MeetingChunk).where(
                        MeetingChunk.meeting_id == meeting_id_uuid,
                        MeetingChunk.chunk_index == chunk_index,
                    )
                ).first()
                if not mc:
                    LOGGER.error(
                        "MeetingChunk not found for meeting %s, chunk %d.",
                        meeting_id_str, chunk_index,
                    )
                    return
                mc.text = transcription.text
                mc.segments_json = (
                    json.dumps(transcription.segments) if transcription.segments else None
                )
                db.add(mc)
                db.commit()

                mtg = db.get(Meeting, meeting_id_uuid)
                if not mtg:
                    LOGGER.error(
                        "Meeting %s: object not found after transcribing chunk.", meeting_id_str
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
                "Error processing task for %s, chunk %d (attempt %d): %s",
                meeting_id_str, chunk_index, attempt + 1, exc,
                exc_info=True,
            )
            if attempt < 2:
                time.sleep(60)


def generate_summary_only(meeting_id_str: str) -> None:
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
                "Error regenerating summary for %s (attempt %d): %s",
                meeting_id_str, attempt + 1, exc,
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
        response = _anthropic_client.messages.create(
            model=settings.summary_model,
            max_tokens=8096,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": f"""Translate the following text into {target_language}.
Maintain original formatting (like markdown headers and lists).
{context_prompt}
Only return the translated text.

<text_to_translate>
{text}
</text_to_translate>"""}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        LOGGER.error("Text translation failed: %s", e, exc_info=True)
        return f"Error: Translation to {target_language} failed."


def translate_meeting_markdown(meeting_id_str: str, target_language: str) -> None:
    """Translates the full summary_markdown of a meeting to a new language."""
    engine = get_db_engine()
    meeting_id = uuid.UUID(meeting_id_str)

    for attempt in range(3):
        try:
            LOGGER.info("Starting markdown translation for meeting %s to %s", meeting_id, target_language)
            with Session(engine) as db:
                meeting = db.get(Meeting, meeting_id)
                if not meeting:
                    LOGGER.error("Meeting %s not found for translation.", meeting_id)
                    return

                if not meeting.summary_markdown:
                    LOGGER.warning("No summary markdown to translate for meeting %s.", meeting_id)
                    meeting.done = True
                    db.add(meeting)
                    db.commit()
                    return

                translated = translate_text(meeting.summary_markdown, target_language, meeting.context)
                meeting.summary_markdown = translated
                meeting.done = True
                db.add(meeting)
                db.commit()
                LOGGER.info("✅ Markdown translation complete for meeting %s", meeting_id)
            return
        except Exception as exc:
            LOGGER.error(
                "Markdown translation failed for %s (attempt %d): %s",
                meeting_id_str, attempt + 1, exc,
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
