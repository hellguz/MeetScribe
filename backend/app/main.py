from __future__ import annotations
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import json
import logging
import shutil
import uuid
import datetime as dt
import re
from collections import Counter, defaultdict
from pathlib import Path

from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine, select, func
from sqlalchemy import delete

from .config import settings
from .models import (
    Meeting,
    MeetingChunk,
    MeetingCreate,
    MeetingStatus,
    MeetingTitleUpdate,
    Feedback,
    FeedbackCreate,
    FeedbackDelete,
    MeetingMeta,
    MeetingSyncRequest,
    RegeneratePayload,
    MeetingConfigUpdate,
    FeedbackStatusUpdate,
    MeetingContextUpdate,
    MeetingTranslatePayload,
    SummaryUpdate,
    ChunkTranscriptUpdate,
    ClientFinalizePayload,
    LocalSummaryRun,
    LocalSummaryRunCreate,
    LocalSummaryVerdictUpdate,
    SummaryPromptOut,
)
from . import tasks
from . import diarization

LOGGER = logging.getLogger("meetscribe")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

# Ensure database directory exists before creating engine
db_path = Path(settings.db_path)
db_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{settings.db_path}", echo=False)
SQLModel.metadata.create_all(engine)

AUDIO_DIR = Path("data/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

_executor = ThreadPoolExecutor(max_workers=settings.worker_threads)
_scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup ---
    tasks.set_executor(_executor)

    # Pre-load Whisper model if running locally (avoids cold-start on first request)
    if not settings.recognition_in_cloud:
        LOGGER.info("Pre-loading local Whisper model...")
        _executor.submit(tasks.get_whisper_model)

    # Run cleanup once immediately on startup to recover any interrupted jobs
    LOGGER.info("Running initial cleanup on startup...")
    _executor.submit(tasks.cleanup_stuck_meetings)

    # Schedule periodic tasks
    _scheduler.add_job(tasks.cleanup_stuck_meetings, "interval", minutes=15, id="cleanup")
    _scheduler.add_job(tasks.backup_database, "cron", hour=0, minute=0, id="backup")
    _scheduler.start()
    LOGGER.info("APScheduler started.")

    yield

    # --- Shutdown ---
    LOGGER.info("Shutting down scheduler and executor...")
    _scheduler.shutdown(wait=False)
    _executor.shutdown(wait=True)
    LOGGER.info("Shutdown complete.")


app = FastAPI(title="MeetScribe MVP", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_SUMMARY_MODES = {"briefing", "essence", "narrative", "minutes"}

def is_valid_summary_length(length_str: str | None) -> bool:
    """Validates the summary_length parameter."""
    if length_str is None:
        return True
    return length_str in VALID_SUMMARY_MODES


def _build_live_transcript(db: Session, meeting_id: uuid.UUID) -> str:
    mtg = db.get(Meeting, meeting_id)
    if not mtg:
        return ""
    max_chunk_count = mtg.received_chunks
    if mtg.final_received and mtg.expected_chunks is not None:
        max_chunk_count = mtg.expected_chunks
    all_meeting_chunks = db.exec(
        select(MeetingChunk)
        .where(MeetingChunk.meeting_id == meeting_id)
        .order_by(MeetingChunk.chunk_index)
    ).all()
    chunks_map = {chunk.chunk_index: chunk for chunk in all_meeting_chunks}
    display_texts = []
    for i in range(max_chunk_count):
        chunk = chunks_map.get(i)
        if chunk and chunk.text is not None:
            display_texts.append(chunk.text)
        else:
            display_texts.append("[...]")
    return " ".join(display_texts).strip()


@app.post("/api/meetings", response_model=MeetingStatus, status_code=201)
def create_meeting(body: MeetingCreate, request: Request):
    with Session(engine) as db:
        if not is_valid_summary_length(body.summary_length):
            raise HTTPException(status_code=400, detail="Invalid summary_length value.")

        user_agent = request.headers.get("user-agent")
        mtg_data = body.model_dump()
        
        # Set defaults if not provided by client
        if body.summary_length is None:
            mtg_data["summary_length"] = "narrative"
        if body.summary_language_mode is None:
            mtg_data["summary_language_mode"] = "auto"

        mtg = Meeting(**mtg_data, user_agent=user_agent)
        db.add(mtg)
        db.commit()
        db.refresh(mtg)
        # For a new meeting, feedback is always empty
        meeting_status = MeetingStatus(**mtg.model_dump(), transcribed_chunks=0, feedback=[])
        return meeting_status


@app.post("/api/chunks")
async def upload_chunk(
    meeting_id: uuid.UUID = Form(...),
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
    is_final: bool = Form(False),
):
    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
        if not mtg:
            raise HTTPException(404, "Meeting not found")

        mtg_dir = AUDIO_DIR / str(meeting_id)
        mtg_dir.mkdir(parents=True, exist_ok=True)

        chunk_path = mtg_dir / f"chunk_{chunk_index:03d}.webm"
        with chunk_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        size_kb = chunk_path.stat().st_size / 1024
        LOGGER.info(
            "⬆️  chunk %d for %s (%.1f KB) final=%s. Queuing for transcription.",
            chunk_index,
            meeting_id,
            size_kb,
            is_final,
        )

        # If truly tiny (<0.1 KB), treat as signaling.
        if size_kb < 0.1:
            LOGGER.warning("⚠️  tiny chunk %d skipped", chunk_index)
            if is_final:
                mtg.final_received = True
                if mtg.expected_chunks is None:
                    mtg.expected_chunks = mtg.received_chunks
                db.add(mtg)
                db.commit()
            return {"ok": True, "skipped": True}

        mc = db.exec(
            select(MeetingChunk).where(
                MeetingChunk.meeting_id == meeting_id,
                MeetingChunk.chunk_index == chunk_index,
            )
        ).first()
        if not mc:
            mc = MeetingChunk(
                meeting_id=meeting_id, chunk_index=chunk_index, path=str(chunk_path)
            )
        else:
            mc.path = str(chunk_path)
            # In on-device mode the browser may post a chunk's text before
            # its audio finishes uploading; that text must survive.
            if not mtg.client_processing:
                mc.text = None
        db.add(mc)

        mtg.received_chunks += 1
        mtg.last_activity = dt.datetime.utcnow()

        if mtg.done:
            LOGGER.warning(
                f"Meeting {meeting_id} was complete but received new chunk {chunk_index}. Resetting summary."
            )
            mtg.done = False
            mtg.summary_markdown = None
            


        if is_final:
            mtg.final_received = True
            if mtg.expected_chunks is None or mtg.expected_chunks < mtg.received_chunks:
                mtg.expected_chunks = mtg.received_chunks

        db.add(mtg)
        db.commit()
        client_processing = mtg.client_processing

    # On-device meetings are transcribed in the browser; the server only
    # keeps the audio (for retention and a possible server-side re-run).
    if not client_processing:
        _executor.submit(
            tasks.process_transcription_and_summary,
            str(meeting_id),
            chunk_index,
            str(chunk_path.resolve()),
        )
    return {"ok": True, "skipped": False}


@app.post("/api/meetings/sync", response_model=list[MeetingMeta])
def sync_meetings_history(payload: MeetingSyncRequest):
    """
    Receives a list of meeting IDs from a client and returns the latest
    metadata for only those meetings, ensuring privacy.
    """
    if not payload.ids:
        return []

    with Session(engine) as db:
        meetings = db.exec(select(Meeting).where(Meeting.id.in_(payload.ids))).all()

        history = []
        for mtg in meetings:
            history.append(
                MeetingMeta(
                    id=mtg.id,
                    title=mtg.title,
                    started_at=mtg.started_at,
                    status="complete" if mtg.done else "pending",
                )
            )
        return history


@app.get("/api/meetings/{mid}", response_model=MeetingStatus)
def get_meeting(mid: uuid.UUID):
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")
        now = dt.datetime.utcnow()
        if (
            not mtg.final_received
            and mtg.expected_chunks is None
            and (now - mtg.last_activity).total_seconds() > settings.inactivity_timeout_seconds
        ):
            mtg.final_received = True
            mtg.expected_chunks = mtg.received_chunks
            db.add(mtg)
            db.commit()
            db.refresh(mtg)

        transcribed_count = (
            db.scalar(
                select(func.count(MeetingChunk.id)).where(
                    MeetingChunk.meeting_id == mid, MeetingChunk.text.is_not(None)
                )
            )
            or 0
        )
        if (
            not mtg.done
            and not mtg.summary_task_queued
            and not mtg.summary_markdown
            and mtg.final_received
            and mtg.expected_chunks
            and transcribed_count >= mtg.expected_chunks
            # On-device meetings finish through /finalize, once the browser
            # has diarized. Until then every chunk having text means nothing.
            and not (mtg.client_processing and not mtg.transcript_text)
        ):
            _executor.submit(tasks.generate_summary_only, str(mid))
            mtg.summary_task_queued = True
            db.add(mtg)
            db.commit()
            # commit() expires the instance, and model_dump() reads __dict__
            # without triggering a reload — so without this refresh the response
            # below is built from a half-empty dict and fails validation.
            db.refresh(mtg)

        data = mtg.model_dump()
        # Only assemble the live transcript while it is still needed. A finished
        # meeting used it nowhere, but paid for a scan of all its chunks on
        # every single fetch.
        data["transcript_text"] = (
            mtg.transcript_text if mtg.done else _build_live_transcript(db, mid)
        )
        data["transcribed_chunks"] = transcribed_count
        # Re-diarization needs the original audio, which older meetings may no
        # longer have. Cheap existence check only — this runs on every poll.
        data["can_rediarize"] = tasks.has_meeting_audio(db, mid)

        # Get existing feedback
        feedback_results = db.exec(
            select(Feedback.feedback_type).where(Feedback.meeting_id == mid)
        ).all()
        data["feedback"] = feedback_results

        return MeetingStatus(**data)


@app.post("/api/meetings/{mid}/upload", status_code=202)
async def upload_full_recording(mid: uuid.UUID, file: UploadFile = File(...)):
    """
    Accept a complete audio file and process it server-side.

    The browser used to decode the file, slice it into 30s pieces and re-encode
    each one through a MediaRecorder — which runs in REAL TIME, so an hour of
    audio cost an hour before anything was transcribed. Here the file is stored
    once and handed to the same batched pipeline used for reprocessing:
    transcribe in ~10 minute batches, diarize, summarize.
    """
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")

        mtg_dir = AUDIO_DIR / str(mid)
        mtg_dir.mkdir(parents=True, exist_ok=True)
        # Keep the original extension so ffmpeg can sniff the format.
        suffix = Path(file.filename or "").suffix.lower() or ".audio"
        target = mtg_dir / f"chunk_000{suffix}"
        with target.open("wb") as out:
            shutil.copyfileobj(file.file, out)

        size_mb = target.stat().st_size / 1e6
        if size_mb < 0.001:
            target.unlink(missing_ok=True)
            raise HTTPException(400, "The uploaded file is empty.")
        LOGGER.info("⬆️  Uploaded %s (%.1f MB) for meeting %s", target.name, size_mb, mid)

        # Stored as a single chunk so the existing pipeline applies unchanged.
        existing = db.exec(
            select(MeetingChunk).where(MeetingChunk.meeting_id == mid)
        ).all()
        for chunk in existing:
            db.delete(chunk)
        db.add(MeetingChunk(meeting_id=mid, chunk_index=0, path=str(target)))

        mtg.received_chunks = 1
        mtg.expected_chunks = 1
        mtg.final_received = True
        mtg.done = False
        mtg.summary_task_queued = True
        mtg.processing_stage = "transcribing"
        mtg.processing_total = 3
        mtg.last_activity = dt.datetime.utcnow()
        db.add(mtg)
        db.commit()

    _executor.submit(tasks.rediarize_meeting_in_worker, str(mid))
    return {"ok": True}


@app.post("/api/meetings/{mid}/rediarize", status_code=202)
def rediarize_meeting(mid: uuid.UUID):
    """
    Re-run transcription timings, diarization and the summary for a meeting.

    For recordings made before speaker labels existed, and after changing the
    diarization settings. Clearing `done` is what makes the UI poll and show
    progress; the worker restores it even on failure.
    """
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")

        if not tasks.meeting_audio_chunks(db, mid):
            raise HTTPException(
                409,
                "The audio for this meeting is no longer on disk, so speakers "
                "cannot be identified.",
            )

        if not mtg.done:
            # Already being processed; don't start a second pass over it.
            return {"ok": True, "already_running": True}

        mtg.done = False
        # Set so the status endpoint does not also queue a plain summary run.
        mtg.summary_task_queued = True
        # Reprocessing re-transcribes first, so three stages. Published now so
        # the first poll already knows, rather than after the worker starts.
        mtg.processing_stage = "transcribing"
        mtg.processing_total = 3
        db.add(mtg)
        db.commit()

    _executor.submit(tasks.rediarize_meeting_in_worker, str(mid))
    LOGGER.info("♻️  Queued re-diarization for meeting %s", mid)
    return {"ok": True}


@app.delete("/api/meetings/{mid}", status_code=204)
def delete_meeting(mid: uuid.UUID):
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            # If it's already gone, that's fine.
            return Response(status_code=204)

        # Delete associated chunks from filesystem
        mtg_dir = AUDIO_DIR / str(mid)
        if mtg_dir.exists() and mtg_dir.is_dir():
            shutil.rmtree(mtg_dir)
            LOGGER.info(f"Deleted audio directory for meeting {mid}")

        # Bulk delete associated chunks and feedback
        db.exec(delete(MeetingChunk).where(MeetingChunk.meeting_id == mid))
        db.exec(delete(Feedback).where(Feedback.meeting_id == mid))

        # Delete meeting itself
        db.delete(mtg)
        db.commit()
        LOGGER.info(f"Deleted meeting {mid} and all associated data.")
    return Response(status_code=204)


@app.put("/api/meetings/{mid}/title", response_model=Meeting)
async def update_meeting_title(mid: uuid.UUID, payload: MeetingTitleUpdate):
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")
        mtg.title = payload.title
        db.add(mtg)
        db.commit()
        db.refresh(mtg)
        return mtg


@app.put("/api/meetings/{mid}/context", status_code=200)
def update_meeting_context(mid: uuid.UUID, payload: MeetingContextUpdate):
    """Updates the context for an in-progress or existing meeting."""
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")

        mtg.context = payload.context
        mtg.last_activity = dt.datetime.utcnow()  # Update activity timestamp
        db.add(mtg)
        db.commit()
        LOGGER.info("Updated context for meeting %s", mid)
        return {"ok": True, "message": "Context updated"}


@app.put("/api/meetings/{mid}/config", response_model=Meeting)
def update_meeting_config(mid: uuid.UUID, payload: MeetingConfigUpdate):
    """Updates the configuration of a meeting, like its summary length."""
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")
        
        updated = False
        if payload.summary_length and is_valid_summary_length(payload.summary_length):
            mtg.summary_length = payload.summary_length
            updated = True
        
        if payload.summary_language_mode:
            mtg.summary_language_mode = payload.summary_language_mode
            mtg.summary_custom_language = payload.summary_custom_language
            updated = True

        if updated:
            db.add(mtg)
            db.commit()
            db.refresh(mtg)
            LOGGER.info("Updated config for meeting %s", mid)
        
        return mtg


@app.post("/api/meetings/{mid}/heartbeat", status_code=200)
def heartbeat_meeting(mid: uuid.UUID):
    """Refreshes last_activity for a paused meeting to prevent janitor auto-finalization."""
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")
        mtg.last_activity = dt.datetime.utcnow()
        db.add(mtg)
        db.commit()
    return {"ok": True}


@app.post("/api/meetings/{mid}/regenerate", status_code=200)
def regenerate_meeting_summary(mid: uuid.UUID, payload: RegeneratePayload):
    """
    Resets a meeting's summary state, which will cause the frontend's
    polling to trigger a regeneration task. Can optionally update the
    desired summary length at the same time.
    """
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")

        # Update summary length if provided
        if payload.summary_length and is_valid_summary_length(payload.summary_length):
            mtg.summary_length = payload.summary_length
        elif not mtg.summary_length:
            mtg.summary_length = "narrative"
        
        # Update language settings if provided
        if payload.summary_language_mode:
            mtg.summary_language_mode = payload.summary_language_mode
            mtg.summary_custom_language = payload.summary_custom_language

        # Update context if provided (allows setting to "" or null)
        if payload.context is not None:
            mtg.context = payload.context

        # Reset the meeting state to indicate a new summary is needed
        mtg.done = False
        mtg.summary_markdown = None
        mtg.summary_task_queued = False  # Set to false so the polling logic can set it to true

        db.add(mtg)
        db.commit()
        LOGGER.info("Reset summary state for meeting %s to trigger regeneration.", mid)

        return {"ok": True, "message": "Regeneration will be triggered on next poll."}


@app.post("/api/feedback", status_code=201)
def create_feedback(body: FeedbackCreate):
    with Session(engine) as db:
        meeting = db.get(Meeting, body.meeting_id)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")

        # Handle feature suggestions, which can have multiple entries
        if body.feedback_type == "feature_suggestion":
            if body.suggestion_text and body.suggestion_text.strip():
                suggestion_entry = Feedback(
                    meeting_id=body.meeting_id,
                    feedback_type="feature_suggestion",
                    suggestion_text=body.suggestion_text.strip(),
                )
                db.add(suggestion_entry)
                db.commit()
                return {"ok": True, "message": "Suggestion received"}
            else:
                # No text provided for suggestion, so do nothing.
                return Response(status_code=204)

        # Handle standard feedback types, which should be unique per meeting
        else:
            existing_feedback = db.exec(
                select(Feedback).where(
                    Feedback.meeting_id == body.meeting_id,
                    Feedback.feedback_type == body.feedback_type
                )
            ).first()

            if existing_feedback:
                LOGGER.warning("Ignoring duplicate feedback for meeting %s, type %s", body.meeting_id, body.feedback_type)
                return {"ok": True, "message": "Feedback already exists"}
            
            new_feedback = Feedback(meeting_id=body.meeting_id, feedback_type=body.feedback_type)
            db.add(new_feedback)
            db.commit()
            return {"ok": True, "message": "Feedback received"}


@app.delete("/api/feedback", status_code=200)
def delete_feedback_by_type(body: FeedbackDelete):
    with Session(engine) as db:
        feedback_to_delete = db.exec(
            select(Feedback).where(
                Feedback.meeting_id == body.meeting_id,
                Feedback.feedback_type == body.feedback_type,
            )
        ).first()

        if feedback_to_delete:
            db.delete(feedback_to_delete)
            db.commit()
            return {"ok": True, "message": "Feedback deleted"}
        else:
            # It's okay if the feedback is already gone.
            return {"ok": True, "message": "Feedback not found, nothing to delete"}


@app.delete("/api/feedback/{fid}", status_code=204)
def delete_feedback_by_id(fid: int):
    with Session(engine) as db:
        feedback_item = db.get(Feedback, fid)
        if feedback_item:
            db.delete(feedback_item)
            db.commit()
    return Response(status_code=204)


@app.put("/api/feedback/{fid}/status", response_model=Feedback)
def update_feedback_status(fid: int, payload: FeedbackStatusUpdate):
    with Session(engine) as db:
        feedback_item = db.get(Feedback, fid)
        if not feedback_item:
            raise HTTPException(status_code=404, detail="Feedback not found")
        feedback_item.status = payload.status
        db.add(feedback_item)
        db.commit()
        db.refresh(feedback_item)
        return feedback_item


@app.get("/api/dashboard/stats")
def get_dashboard_stats():
    with Session(engine) as db:
        today = dt.date.today()
        start_of_today = dt.datetime.combine(today, dt.time.min)
        total_summaries = (
            db.scalar(select(func.count(Meeting.id)).where(Meeting.done == True)) or 0
        )
        total_words = (
            db.scalar(
                select(func.sum(Meeting.word_count)).where(
                    Meeting.word_count.is_not(None)
                )
            )
            or 0
        )
        total_duration_sec = (
            db.scalar(
                select(func.sum(Meeting.duration_seconds)).where(
                    Meeting.duration_seconds.is_not(None)
                )
            )
            or 0
        )
        summaries_today = (
            db.scalar(
                select(func.count(Meeting.id)).where(
                    Meeting.done == True, Meeting.started_at >= start_of_today
                )
            )
            or 0
        )
        words_today = (
            db.scalar(
                select(func.sum(Meeting.word_count)).where(
                    Meeting.word_count.is_not(None),
                    Meeting.started_at >= start_of_today,
                )
            )
            or 0
        )
        duration_today_sec = (
            db.scalar(
                select(func.sum(Meeting.duration_seconds)).where(
                    Meeting.duration_seconds.is_not(None),
                    Meeting.started_at >= start_of_today,
                )
            )
            or 0
        )
        user_agent_results = db.exec(
            select(Meeting.user_agent).where(Meeting.user_agent.is_not(None))
        ).all()
        device_counts = Counter()
        for ua in user_agent_results:
            ua_lower = ua.lower()
            if "iphone" in ua_lower:
                device_counts["iPhone"] += 1
            elif "android" in ua_lower:
                device_counts["Android"] += 1
            elif "windows" in ua_lower:
                device_counts["Windows"] += 1
            elif "macintosh" in ua_lower:
                device_counts["Mac"] += 1
            elif "linux" in ua_lower:
                device_counts["Linux"] += 1
            else:
                device_counts["Other"] += 1

        feedback_counts_query = db.exec(
            select(Feedback.feedback_type, func.count(Feedback.id))
            .where(Feedback.feedback_type != 'feature_suggestion')
            .group_by(Feedback.feedback_type)
        ).all()
        feedback_counts = {ftype: count for ftype, count in feedback_counts_query}

        suggestions_query = db.exec(
            select(Feedback, Meeting.title)
            .join(Meeting, Feedback.meeting_id == Meeting.id)
            .where(Feedback.feedback_type == "feature_suggestion")
            .where(Feedback.suggestion_text.is_not(None))
            .order_by(Feedback.created_at.desc())
        ).all()
        feature_suggestions = [
            {
                "id": f.id,
                "suggestion": f.suggestion_text,
                "submitted_at": f.created_at,
                "meeting_id": f.meeting_id,
                "meeting_title": title,
                "status": f.status,
            }
            for f, title in suggestions_query
        ]
        all_feedback_query = db.exec(
            select(Feedback, Meeting.title, Meeting.started_at)
            .join(Meeting, Feedback.meeting_id == Meeting.id)
            .order_by(Meeting.started_at.desc(), Feedback.created_at.desc())
        ).all()

        meetings_with_feedback = defaultdict(lambda: {"feedback": []})
        for feedback, title, started_at in all_feedback_query:
            mid_str = str(feedback.meeting_id)
            if "id" not in meetings_with_feedback[mid_str]:
                meetings_with_feedback[mid_str]["id"] = mid_str
                meetings_with_feedback[mid_str]["title"] = title
                meetings_with_feedback[mid_str]["started_at"] = started_at

            meetings_with_feedback[mid_str]["feedback"].append(
                {
                    "id": feedback.id,
                    "type": feedback.feedback_type,
                    "suggestion": feedback.suggestion_text,
                    "created_at": feedback.created_at,
                    "status": feedback.status,
                }
            )
        
        meetings_by_day = db.exec(
            select(func.date(Meeting.started_at), func.count(Meeting.id))
            .group_by(func.date(Meeting.started_at))
            .order_by(func.date(Meeting.started_at))
            .limit(90)
        ).all()

        # --- New Interesting Stats ---
        avg_summary_words = db.scalar(select(func.avg(Meeting.word_count)).where(Meeting.word_count.is_not(None))) or 0
        
        time_rows = db.exec(
            select(Meeting.started_at, Meeting.timezone).where(Meeting.done == True)
        ).all()
        hour_counts: Counter = Counter()
        day_counts: Counter = Counter()
        for started_at, tz_str in time_rows:
            try:
                tz = ZoneInfo(tz_str) if tz_str else ZoneInfo("UTC")
            except ZoneInfoNotFoundError:
                tz = ZoneInfo("UTC")
            local_dt = started_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
            hour_counts[local_dt.hour] += 1
        busiest_hour = f"{max(hour_counts, key=hour_counts.get):02d}:00" if hour_counts else "N/A"

        # --- Summary Length Distribution ---
        LENGTH_LABELS = {
            "briefing":  "Briefing",
            "essence":   "Essence",
            "narrative": "Narrative",
            "minutes":   "Minutes",
            # legacy fallback
            "auto":      "Narrative",
        }
        length_rows = db.exec(
            select(Meeting.summary_length, func.count(Meeting.id))
            .where(Meeting.done == True)
            .where(Meeting.summary_length.is_not(None))
            .group_by(Meeting.summary_length)
        ).all()
        length_distribution = {
            LENGTH_LABELS.get(raw, raw): count
            for raw, count in length_rows
        }

        # --- Language Distribution ---
        lang_rows = db.exec(
            select(
                Meeting.summary_language_mode,
                Meeting.summary_custom_language,
                func.count(Meeting.id),
            )
            .where(Meeting.done == True)
            .where(Meeting.summary_language_mode.is_not(None))
            .group_by(Meeting.summary_language_mode, Meeting.summary_custom_language)
        ).all()
        language_distribution: dict[str, int] = {}
        for mode, custom_lang, count in lang_rows:
            if mode == "auto":
                label = "Auto-detect"
            elif mode == "english":
                label = "English"
            elif mode == "custom" and custom_lang:
                label = custom_lang
            else:
                label = mode
            language_distribution[label] = language_distribution.get(label, 0) + count

    return {
        "all_time": {
            "total_summaries": total_summaries,
            "total_words": total_words,
            "total_duration_seconds": total_duration_sec,
        },
        "today": {
            "total_summaries": summaries_today,
            "total_words": words_today,
            "total_duration_seconds": duration_today_sec,
        },
        "device_distribution": dict(device_counts),
        "feedback_counts": feedback_counts,
        "feature_suggestions": feature_suggestions,
        "meetings_with_feedback": list(meetings_with_feedback.values()),
        "usage_timeline": [
            {"date": str(date), "count": count} for date, count in meetings_by_day
        ],
        "interesting_facts": {
            "avg_summary_words": round(avg_summary_words),
            "busiest_hour": busiest_hour
        },
        "length_distribution": length_distribution,
        "language_distribution": language_distribution,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Experimental: summarization on the user's own device
#
# The browser can run Qwen3.5 over a transcript instead of Claude (see
# frontend/src/ondevice/summary/). Nothing here replaces the real summary:
# these endpoints hand the browser the server's own prompt so the comparison
# is fair, then store what came back plus its measurements, so the question
# "is a 4B model in a tab good enough?" is answered from data rather than
# from one impression.
# ──────────────────────────────────────────────────────────────────────────────


@app.get("/api/meetings/{mid}/summary-prompt", response_model=SummaryPromptOut)
def get_summary_prompt(mid: uuid.UUID, summary_length: str | None = None):
    """
    The exact prompt this meeting's summary was (or would be) generated from.

    Built by `tasks.build_summary_prompt`, the same function the Claude path
    uses, rather than a copy in the frontend: a local model given a
    hand-rolled prompt would be measuring the prompt, not the model.
    `summary_length` overrides the meeting's stored mode, so one transcript
    can be tried in briefing and narrative form without a regenerate.
    """
    with Session(engine) as db:
        meeting = db.get(Meeting, mid)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")

        transcript = meeting.transcript_text or _build_live_transcript(db, mid)
        if tasks.transcript_too_brief(transcript):
            raise HTTPException(status_code=409, detail=tasks.TOO_BRIEF)

        # `is_valid_summary_length(None)` is True (it guards optional payload
        # fields elsewhere), so test for a value explicitly or an absent
        # query param would override the meeting's own mode with None.
        length = summary_length if summary_length and is_valid_summary_length(summary_length) else meeting.summary_length
        prompt, target_language, mode = tasks.build_summary_prompt(
            transcript,
            length,
            meeting.summary_language_mode,
            meeting.summary_custom_language,
            meeting.context,
            meeting.started_at.strftime("%Y-%m-%d") if meeting.started_at else None,
            meeting.duration_seconds,
        )
    return SummaryPromptOut(
        prompt=prompt,
        target_language=target_language,
        summary_length=mode,
        prompt_chars=len(prompt),
    )


@app.get("/api/meetings/{mid}/local-summaries", response_model=list[LocalSummaryRun])
def list_local_summaries(mid: uuid.UUID):
    """Every on-device summary recorded for this meeting, oldest first."""
    with Session(engine) as db:
        return list(
            db.exec(
                select(LocalSummaryRun)
                .where(LocalSummaryRun.meeting_id == mid)
                .order_by(LocalSummaryRun.created_at)
            ).all()
        )


@app.post("/api/meetings/{mid}/local-summaries", response_model=LocalSummaryRun, status_code=201)
def create_local_summary(mid: uuid.UUID, body: LocalSummaryRunCreate, request: Request):
    """Store a summary the browser just generated, with its measurements."""
    with Session(engine) as db:
        if not db.get(Meeting, mid):
            raise HTTPException(status_code=404, detail="Meeting not found")

        run = LocalSummaryRun(
            meeting_id=mid,
            user_agent=request.headers.get("user-agent"),
            device_info=json.dumps(body.device_info) if body.device_info else None,
            **body.model_dump(exclude={"device_info"}),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        LOGGER.info(
            "Meeting %s: on-device summary from %s (%s/%s) — %s chars in %sms",
            mid, run.model, run.device, run.dtype, len(run.markdown), run.total_ms,
        )
        return run


@app.patch("/api/meetings/{mid}/local-summaries/{run_id}", response_model=LocalSummaryRun)
def update_local_summary_verdict(mid: uuid.UUID, run_id: int, body: LocalSummaryVerdictUpdate):
    """Record which summary the user judged better — the eval label."""
    if body.verdict is not None and body.verdict not in ("cloud", "tie", "local"):
        raise HTTPException(status_code=422, detail="verdict must be cloud, tie or local")
    with Session(engine) as db:
        run = db.get(LocalSummaryRun, run_id)
        if not run or run.meeting_id != mid:
            raise HTTPException(status_code=404, detail="Run not found")
        run.verdict = body.verdict
        run.verdict_note = body.verdict_note
        db.add(run)
        db.commit()
        db.refresh(run)
        return run


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.put("/api/meetings/{mid}/summary")
def update_summary(mid: uuid.UUID, body: SummaryUpdate):
    """Update a meeting's summary markdown directly."""
    with Session(engine) as db:
        meeting = db.get(Meeting, mid)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        meeting.summary_markdown = body.content
        db.add(meeting)
        db.commit()
    return {"ok": True}


@app.post("/api/meetings/{mid}/translate", status_code=202)
def translate_meeting(mid: uuid.UUID, payload: MeetingTranslatePayload):
    """
    Triggers a translation of the meeting summary to a new language.
    """
    target_language = payload.target_language
    language_mode = payload.language_mode

    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")

        mtg.summary_language_mode = language_mode
        mtg.summary_custom_language = (
            target_language if language_mode == "custom" else None
        )
        mtg.done = False  # Mark as processing so the frontend polls for completion
        db.add(mtg)
        db.commit()

        _executor.submit(tasks.translate_meeting_markdown, str(mid), target_language)
        LOGGER.info(f"Queued translation task for meeting {mid} to {target_language}")

    return {"ok": True, "message": "Translation task queued."}


# ──────────────────────────────────────────────────────────────────────────────
# On-device processing (experimental): the browser transcribes with Parakeet
# and diarizes with the same ONNX models the server uses. Audio and chunk
# texts are stored exactly as for a normal meeting; only summarization runs
# here. See frontend/src/ondevice/.
# ──────────────────────────────────────────────────────────────────────────────
@app.put("/api/meetings/{mid}/chunks/{chunk_index}/transcript", status_code=200)
def update_chunk_transcript(mid: uuid.UUID, chunk_index: int, payload: ChunkTranscriptUpdate):
    """Store the text (and word timings) the browser produced for one chunk."""
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")
        if not mtg.client_processing:
            raise HTTPException(409, "Meeting is not in on-device mode")

        mc = db.exec(
            select(MeetingChunk).where(
                MeetingChunk.meeting_id == mid, MeetingChunk.chunk_index == chunk_index
            )
        ).first()
        if not mc:
            # Text can arrive before the audio upload; the path is filled in
            # by /api/chunks when it lands.
            mc = MeetingChunk(meeting_id=mid, chunk_index=chunk_index, path="")
        mc.text = payload.text.strip()
        mc.segments_json = (
            json.dumps([s.model_dump() for s in payload.segments]) if payload.segments else None
        )
        mc.audio_seconds = payload.audio_seconds
        mtg.last_activity = dt.datetime.utcnow()
        db.add(mc)
        db.add(mtg)
        db.commit()
    return {"ok": True}


@app.post("/api/meetings/{mid}/finalize", status_code=202)
def finalize_client_meeting(mid: uuid.UUID, payload: ClientFinalizePayload):
    """The browser is done: take its labelled transcript and summarize it."""
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")
        if not mtg.client_processing:
            raise HTTPException(409, "Meeting is not in on-device mode")
        if mtg.done:
            return {"ok": True, "already_done": True}

        mtg.transcript_text = payload.transcript.strip()
        mtg.speaker_count = payload.speaker_count
        mtg.duration_seconds = payload.duration_seconds
        mtg.client_stats = json.dumps(payload.client_stats) if payload.client_stats else None
        mtg.diarization_attempted = payload.speaker_count is not None
        mtg.final_received = True
        if mtg.expected_chunks is None:
            mtg.expected_chunks = mtg.received_chunks
        mtg.last_activity = dt.datetime.utcnow()

        queue = not mtg.summary_task_queued
        mtg.summary_task_queued = True
        db.add(mtg)
        db.commit()

    if queue:
        _executor.submit(tasks.generate_summary_only, str(mid))
    LOGGER.info("⚡ Meeting %s: on-device transcript received (%d chars). Summarizing.", mid, len(payload.transcript))
    return {"ok": True}


@app.post("/api/meetings/{mid}/client-fallback", status_code=202)
def client_fallback(mid: uuid.UUID):
    """
    The browser gave up (model failed to load, tab ran out of memory, …).
    Hand the meeting back to the normal server pipeline: transcribe every
    chunk that has no text yet, then diarize and summarize as usual.
    """
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")
        if not mtg.client_processing:
            return {"ok": True, "requeued": 0}
        mtg.client_processing = False
        mtg.last_activity = dt.datetime.utcnow()
        db.add(mtg)
        db.commit()

        pending = db.exec(
            select(MeetingChunk.chunk_index, MeetingChunk.path)
            .where(MeetingChunk.meeting_id == mid)
            .where(MeetingChunk.text.is_(None))
            .where(MeetingChunk.path != "")
        ).all()

    for chunk_index, path in pending:
        _executor.submit(tasks.process_transcription_and_summary, str(mid), chunk_index, path)
    LOGGER.warning("⚡ Meeting %s: browser fell back to server processing (%d chunk(s) re-queued).", mid, len(pending))
    return {"ok": True, "requeued": len(pending)}


@app.get("/api/models")
def list_model_files():
    """
    What the browser needs to diarize on-device: the two ONNX models the
    server already caches (served below — GitHub releases send no CORS
    headers) and the tunables from .env, so both sides agree.
    """
    seg, emb = diarization.model_paths()
    if not seg.exists() or not emb.exists():
        raise HTTPException(
            404, "Diarization models are not downloaded on the server (utils/fetch_diarization_models.py)."
        )
    return {
        "segmentation": {"url": "/api/models/segmentation", "name": seg.name, "bytes": seg.stat().st_size},
        "embedding": {"url": "/api/models/embedding", "name": emb.name, "bytes": emb.stat().st_size},
        "config": {
            "window_shift_ratio": settings.diarization_window_shift_ratio,
            "cluster_threshold": settings.diarization_cluster_threshold,
            "min_speaker_share": settings.diarization_min_speaker_share,
            "min_duration_on": settings.diarization_min_duration_on,
            "min_duration_off": settings.diarization_min_duration_off,
        },
    }


@app.get("/api/models/{name}")
def get_model_file(name: str):
    seg, emb = diarization.model_paths()
    path = {"segmentation": seg, "embedding": emb}.get(name)
    if path is None:
        raise HTTPException(404, "Unknown model")
    if not path.exists():
        raise HTTPException(404, "Model not downloaded on the server")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=path.name,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
