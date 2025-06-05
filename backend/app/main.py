# backend/app/main.py

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
import datetime as dt

import openai
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, SQLModel, create_engine, select, func

from redis import Redis
from rq import Queue

from .config import settings
from .migrations import migrate
from .models import Meeting, MeetingChunk, MeetingCreate, MeetingStatus

# ─────────────────────────────────────────────────────────────────────────────
# RQ setup: connect to Redis and create a queue named "transcription"
redis_conn = Redis.from_url(settings.redis_url)  # see config.py’s new field
queue = Queue("transcription", connection=redis_conn)

LOGGER = logging.getLogger("meetscribe")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

openai.api_key = settings.openai_api_key

engine = create_engine(f"sqlite:///{settings.db_path}", echo=False)
SQLModel.metadata.create_all(engine)
migrate(engine)

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

# How long (in seconds) without a new real chunk before we auto-finalize:
INACTIVITY_TIMEOUT_SECONDS = 120  # 2 minutes


@app.post("/api/meetings", response_model=MeetingStatus, status_code=201)
def create_meeting(body: MeetingCreate):
    """
    Create a new meeting. At creation, `received_chunks=0`, `expected_chunks=None`,
    `final_received=False`, `last_activity = now`. Return `transcribed_chunks=0`.
    """
    with Session(engine) as db:
        mtg = Meeting(**body.model_dump())
        db.add(mtg)
        db.commit()
        db.refresh(mtg)

        return MeetingStatus(
            **mtg.model_dump(),
            transcribed_chunks=0
        )


@app.post("/api/chunks")
async def upload_chunk(
    meeting_id: uuid.UUID = Form(...),
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
    is_final: bool = Form(False),
):
    """
    Upload a chunk.  The 1 s “header” chunk has chunk_index=0:
      • We always save it (so Whisper can get a valid WebM header), but do NOT count it among received_chunks.
      • For any chunk_index > 0 and size ≥ 0.1 KB, we treat as a “real” chunk:
          – increment received_chunks
          – update last_activity = now
      • If is_final=True arrives on a real chunk, set final_received=True and expected_chunks=received_chunks.
    """

    # 1) Save the chunk to disk immediately (so we can give Whisper a valid WebM file)
    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
        if not mtg:
            raise HTTPException(404, "Meeting not found")

        mtg_dir = AUDIO_DIR / str(meeting_id)
        mtg_dir.mkdir(parents=True, exist_ok=True)

        chunk_path = mtg_dir / f"chunk_{chunk_index:03d}.webm"
        with chunk_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        # Measure size in KB
        size_kb = chunk_path.stat().st_size / 1024
        LOGGER.info(
            "⬆️  chunk %d for %s (%.1f KB) final=%s. Enqueueing for transcription.",
            chunk_index,
            meeting_id,
            size_kb,
            is_final,
        )

        # 2) If it’s a “real” chunk (index>0 and ≥0.1 KB), update meeting counters:
        if chunk_index > 0 and size_kb >= 0.1:
            mtg.received_chunks += 1
            mtg.last_activity = dt.datetime.utcnow()
            if is_final and not mtg.final_received:
                mtg.final_received = True
                if mtg.expected_chunks is None:
                    mtg.expected_chunks = mtg.received_chunks
            db.add(mtg)
            db.commit()
            db.refresh(mtg)

        else:
            # If this is chunk_index=0 (header) or “tiny” <0.1 KB, we skip counters:
            if chunk_index > 0 and is_final and mtg.expected_chunks is None:
                mtg.final_received = True
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

    # 3) Enqueue the RQ job (fire-and-forget)
    queue.enqueue(
        "app.worker.process_transcription_and_summary",
        str(meeting_id),
        chunk_index,
        str(chunk_path.resolve()),
    )

    # 4) Return status immediately
    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
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
    Retrieve meeting status. Also compute how many non-header chunks have text.
    If more than INACTIVITY_TIMEOUT_SECONDS have passed since last_activity,
    and final_received is still False, automatically mark final and set expected_chunks.
    """
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")

        now = dt.datetime.utcnow()
        # If no final_received yet and expected_chunks is still None,
        # and last_activity is more than timeout ago, auto-finalize:
        if (
            not mtg.final_received
            and mtg.expected_chunks is None
            and (now - mtg.last_activity).total_seconds() > INACTIVITY_TIMEOUT_SECONDS
        ):
            LOGGER.info(f"🕒 Inactivity timeout for meeting {mid}: auto-finalize.")
            mtg.final_received = True
            mtg.expected_chunks = mtg.received_chunks
            db.add(mtg)
            db.commit()
            db.refresh(mtg)

        # Count how many non-header chunks have transcription
        transcribed_count = db.scalar(
            select(func.count(MeetingChunk.id)).where(
                MeetingChunk.meeting_id == mid,
                MeetingChunk.text.is_not(None),
                MeetingChunk.chunk_index != 0,
            )
        ) or 0

        return MeetingStatus(
            **mtg.model_dump(),
            transcribed_chunks=transcribed_count,
        )


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}
