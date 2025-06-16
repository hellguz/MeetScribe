from __future__ import annotations

import logging
import shutil
import uuid
import datetime as dt
from collections import Counter, defaultdict
from pathlib import Path

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
    MeetingMeta,
    MeetingSyncRequest,
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

    process_transcription_and_summary.delay(
        meeting_id_str=str(meeting_id),
        chunk_index=chunk_index,
        chunk_path_str=str(chunk_path.resolve()),
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
            and (now - mtg.last_activity).total_seconds() > INACTIVITY_TIMEOUT_SECONDS
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
        ):
            generate_summary_only.delay(str(mid))
            mtg.summary_task_queued = True
            db.add(mtg)
            db.commit()
        live_tx = _build_live_transcript(db, mid)
        data = mtg.model_dump()
        data["transcript_text"] = mtg.transcript_text if mtg.done else live_tx
        data["transcribed_chunks"] = transcribed_count
        return MeetingStatus(**data)


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


@app.post("/api/meetings/{mid}/regenerate", status_code=200)
def regenerate_meeting_summary(mid: uuid.UUID):
    """
    Resets a meeting's summary state, which will cause the frontend's
    polling to trigger a regeneration task.
    """
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")

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

        for f_type in body.feedback_types:
            if not f_type:
                continue
            feedback_entry = Feedback(meeting_id=body.meeting_id, feedback_type=f_type)
            db.add(feedback_entry)

        if body.suggestion_text and body.suggestion_text.strip():
            suggestion_entry = Feedback(
                meeting_id=body.meeting_id,
                feedback_type="feature_suggestion",
                suggestion_text=body.suggestion_text.strip(),
            )
            db.add(suggestion_entry)

        db.commit()
        return {"ok": True, "message": "Feedback received"}


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
        meetings_by_day = db.exec(
            select(func.date(Meeting.started_at), func.count(Meeting.id))
            .group_by(func.date(Meeting.started_at))
            .order_by(func.date(Meeting.started_at))
            .limit(90)
        ).all()

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
                    "type": feedback.feedback_type,
                    "suggestion": feedback.suggestion_text,
                    "created_at": feedback.created_at,
                }
            )

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
        "meetings_with_feedback": list(meetings_with_feedback.values()),
        "usage_timeline": [
            {"date": str(date), "count": count} for date, count in meetings_by_day
        ],
    }


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}