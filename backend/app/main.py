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
from .models import Meeting, MeetingChunk, MeetingCreate, MeetingStatus
from .worker import process_transcription_and_summary  # Import Celery task

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

    # Determine the range of chunks to display
    # Chunk 0 is always ignored for live transcript purposes.
    max_display_index = mtg.received_chunks
    if mtg.final_received and mtg.expected_chunks is not None:
        max_display_index = mtg.expected_chunks

    # Fetch all relevant MeetingChunk objects for the meeting
    all_meeting_chunks = db.exec(
        select(MeetingChunk)
        .where(MeetingChunk.meeting_id == meeting_id)
        .where(MeetingChunk.chunk_index > 0) # Ignore header chunk
        .order_by(MeetingChunk.chunk_index)
    ).all()

    chunks_map = {chunk.chunk_index: chunk for chunk in all_meeting_chunks}

    display_texts = []
    for i in range(1, max_display_index + 1):
        chunk = chunks_map.get(i)
        if chunk and chunk.text is not None:
            # Append actual text, including empty strings ""
            # Empty strings will be handled by join, effectively disappearing if surrounded by spaces.
            display_texts.append(chunk.text)
        else:
            # Chunk doesn't exist, or text is None (pending, or will be set by worker if failed)
            display_texts.append("[...]")

    return " ".join(display_texts).strip()


@app.post("/api/meetings", response_model=MeetingStatus, status_code=201)
def create_meeting(body: MeetingCreate):
    """
    Create a new meeting. At creation, `received_chunks=0`, `expected_chunks=None`,
    `final_received=False`, `last_activity = now`.  Return `transcribed_chunks=0`.
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
            if chunk_index > 0 and is_final:
                mtg.final_received = True
                if mtg.expected_chunks is None:
                    mtg.expected_chunks = mtg.received_chunks
            # We do not update last_activity or received_chunks for header or tiny chunks.
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

        # Only increment and update activity for non-header (chunk_index>0)
        if chunk_index > 0:
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

        if chunk_index > 0 and is_final:
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
    Retrieve meeting status.
    - The live transcript is built from a contiguous sequence of chunks to ensure correct order.
    - If inactive for too long, the meeting is automatically marked as 'final'.
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
            LOGGER.info(f"🕒 Inactivity timeout for meeting {mid}: marking final_received & expected_chunks.")
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

        # Build the live transcript from a contiguous block of processed chunks.
        live_transcript = _build_live_transcript(db, mid)

        response_data = mtg.model_dump()
        # If the meeting is fully done, use the final stored transcript.
        # Otherwise, use the live, contiguous one.
        response_data["transcript_text"] = mtg.transcript_text if mtg.done else live_transcript
        response_data["transcribed_chunks"] = transcribed_count

        return MeetingStatus(**response_data)


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}