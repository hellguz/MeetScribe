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

from .config import settings
from .models import (
    Meeting,
    MeetingChunk,
    MeetingCreate,
    MeetingStatus,
    MeetingTitleUpdate,
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

# How long (in seconds) without a new real chunk before we auto-finalize:
INACTIVITY_TIMEOUT_SECONDS = 120  # 2 minutes


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
    for i in range(max_chunk_count):  # Iterate from 0 to N-1
        chunk = chunks_map.get(i)
        if chunk and chunk.text is not None:
            # Append actual text, including empty strings ""
            display_texts.append(chunk.text)
        else:
            # Chunk doesn't exist, or text is None (pending, or will be set by worker if failed)
            display_texts.append("[...]")

    return " ".join(display_texts).strip()


@app.post("/api/meetings", response_model=MeetingStatus, status_code=201)
def create_meeting(body: MeetingCreate):
    """
    Create a new meeting. At creation, `received_chunks=0`, `expected_chunks=None`,
    `final_received=False`, `last_activity = now`.
    """
    with Session(engine) as db:
        mtg = Meeting(**body.model_dump())
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


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}
