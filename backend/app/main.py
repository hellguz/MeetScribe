from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
import datetime as dt
from collections import Counter

import openai
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, SQLModel, create_engine, select, func

from .config import settings
from .models import (
    Meeting,
    MeetingChunk,
    MeetingCreate,
    MeetingStatus,
    MeetingTitleUpdate,
    Feedback,
    FeedbackCreate,
)
from .worker import process_transcription_and_summary, generate_summary_only

LOGGER = logging.getLogger("meetscribe")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

openai.api_key = settings.openai_api_key

engine = create_engine(f"sqlite:///{settings.db_path}", echo=False)
SQLModel.metadata.create_all(engine)

AUDIO_DIR = Path("data/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="MeetScribe MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INACTIVITY_TIMEOUT_SECONDS = 120


def _build_live_transcript(db: Session, meeting_id: uuid.UUID) -> str:
    """
    Assembles a live transcript based on expected or received chunks,
    using "[...]" as a placeholder for pending or failed chunks.
    """
    mtg = db.get(Meeting, meeting_id)
    if not mtg:
        return ""

    # Determine the number of chunks to display
    max_chunk_count = mtg.received_chunks
    if mtg.final_received and mtg.expected_chunks is not None:
        max_chunk_count = mtg.expected_chunks

    # Fetch all MeetingChunk objects for the meeting
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
    """
    Create a new meeting. Now captures User-Agent.
    """
    with Session(engine) as db:
        user_agent = request.headers.get("user-agent")
        mtg = Meeting(**body.model_dump(), user_agent=user_agent)
        db.add(mtg)
        db.commit()
        db.refresh(mtg)
        return MeetingStatus(**mtg.model_dump(), transcribed_chunks=0)


@app.post("/api/chunks")
async def upload_chunk(
    meeting_id: uuid.UUID = Form(...),
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
    is_final: bool = Form(False),
):
    """
    Upload a chunk.
      • Each chunk is saved and queued for transcription.
      • We increment received_chunks and update last_activity for any chunk with content.
      • Tiny chunks (<0.1 KB) are treated as signaling (e.g., final empty chunk) and are not transcribed.
      • If is_final=True, we set final_received=True and expected_chunks=received_chunks.
    """
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
            db.refresh(mtg)
            return {
                "ok": True,
                "skipped": True,
                "received_chunks": mtg.received_chunks,
                "done": mtg.done,
                "expected_chunks": mtg.expected_chunks,
            }

        # (size ≥ 0.1 KB) → real chunk
        mc = db.exec(
            select(MeetingChunk).where(
                MeetingChunk.meeting_id == meeting_id,
                MeetingChunk.chunk_index == chunk_index,
            )
        ).first()
        if not mc:
            mc = MeetingChunk(
                meeting_id=meeting_id,
                chunk_index=chunk_index,
                path=str(chunk_path),
                text=None,
            )
        else:
            mc.path = str(chunk_path)
            mc.text = None
        db.add(mc)

        # Increment and update activity for this chunk.
        mtg.received_chunks += 1
        mtg.last_activity = dt.datetime.utcnow()

        # If a new, real chunk arrives for a meeting that was already
        # summarized, we must reset its state to allow for re-summarization.
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
        db.refresh(mtg)

    # Dispatch Celery task for transcription
    process_transcription_and_summary.delay(
        meeting_id_str=str(meeting_id),
        chunk_index=chunk_index,
        chunk_path_str=str(chunk_path.resolve()),
    )

    return {
        "ok": True,
        "skipped": False,
        "received_chunks": mtg.received_chunks,
        "done": mtg.done,
        "expected_chunks": mtg.expected_chunks,
    }


@app.get("/api/meetings/{mid}", response_model=MeetingStatus)
def get_meeting(mid: uuid.UUID):
    """
    Retrieve meeting status and (lazily) trigger a summary regeneration
    *only if the user asks for this meeting and the summary is missing*.
    """
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")

        # ---------------- inactivity timeout (unchanged) -------------
        now = dt.datetime.utcnow()
        if (
            not mtg.final_received
            and mtg.expected_chunks is None
            and (now - mtg.last_activity).total_seconds() > INACTIVITY_TIMEOUT_SECONDS
        ):
            mtg.final_received = True
            mtg.expected_chunks = mtg.received_chunks
            db.add(mtg)
            db.commit()
            db.refresh(mtg)

        # ---------------- count processed chunks ---------------------
        transcribed_count = (
            db.scalar(
                select(func.count(MeetingChunk.id)).where(
                    MeetingChunk.meeting_id == mid,
                    MeetingChunk.text.is_not(None),
                )
            )
            or 0
        )

        # ---------------- LAZY summary trigger -----------------------
        if (
            not mtg.done
            and not mtg.summary_task_queued
            and mtg.summary_markdown in (None, "")
            and mtg.final_received
            and mtg.expected_chunks
            and transcribed_count >= mtg.expected_chunks
        ):
            LOGGER.info("Queueing summary-only task for meeting %s", mid)
            generate_summary_only.delay(str(mid))
            mtg.summary_task_queued = True
            db.add(mtg)
            db.commit()
        # ---------------- build live transcript (unchanged) ----------
        live_tx = _build_live_transcript(db, mid)
        data = mtg.model_dump()
        data["transcript_text"] = mtg.transcript_text if mtg.done else live_tx
        data["transcribed_chunks"] = transcribed_count
        return MeetingStatus(**data)


@app.put("/api/meetings/{mid}/title", response_model=Meeting)
async def update_meeting_title(mid: uuid.UUID, payload: MeetingTitleUpdate):
    """
    Update the title of a meeting.
    """
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")

        mtg.title = payload.title
        db.add(mtg)
        db.commit()
        db.refresh(mtg)
        return mtg


@app.post("/api/feedback", status_code=201)
def create_feedback(body: FeedbackCreate):
    with Session(engine) as db:
        meeting = db.get(Meeting, body.meeting_id)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        feedback = Feedback.model_validate(body)
        db.add(feedback)
        db.commit()
        return {"ok": True, "message": "Feedback received"}


@app.get("/api/dashboard/stats")
def get_dashboard_stats():
    """
    Heavily upgraded endpoint for rich dashboard statistics.
    """
    with Session(engine) as db:
        today = dt.date.today()
        start_of_today = dt.datetime.combine(today, dt.time.min)

        # --- Total Stats ---
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

        # --- Today's Stats ---
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

        # --- Device/User Agent Stats ---
        user_agent_results = db.exec(
            select(Meeting.user_agent).where(Meeting.user_agent.is_not(None))
        ).all()
        # Basic parsing for major browsers/OS
        device_counts = Counter()
        for ua in user_agent_results:
            ua_lower = ua.lower()
            if "windows" in ua_lower:
                device_counts["Windows"] += 1
            elif "macintosh" in ua_lower:
                device_counts["Mac"] += 1
            elif "linux" in ua_lower:
                device_counts["Linux"] += 1
            elif "iphone" in ua_lower:
                device_counts["iPhone"] += 1
            elif "android" in ua_lower:
                device_counts["Android"] += 1
            else:
                device_counts["Other"] += 1

        # --- Feedback Stats (same as before) ---
        feedback_counts_query = db.exec(
            select(Feedback.feedback_type, func.count(Feedback.id)).group_by(
                Feedback.feedback_type
            )
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
                "suggestion": f.suggestion_text,
                "submitted_at": f.created_at,
                "meeting_id": f.meeting_id,
                "meeting_title": title,
            }
            for f, title in suggestions_query
        ]

        # --- Timeline data ---
        meetings_by_day = db.exec(
            select(func.date(Meeting.started_at), func.count(Meeting.id))
            .group_by(func.date(Meeting.started_at))
            .order_by(func.date(Meeting.started_at))
            .limit(90)  # Last 90 days
        ).all()

    return {
        "all_time": {
            "total_summaries": total_summaries,
            "total_words": total_words,
            "total_hours": round(total_duration_sec / 3600, 1),
        },
        "today": {
            "total_summaries": summaries_today,
            "total_words": words_today,
            "total_hours": round(duration_today_sec / 3600, 1),
        },
        "device_distribution": dict(device_counts),
        "feedback_counts": feedback_counts,
        "feature_suggestions": feature_suggestions,
        "usage_timeline": [
            {"date": str(date), "count": count} for date, count in meetings_by_day
        ],
    }


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}
