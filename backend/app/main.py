# <./backend\app\main.py>
# backend/app/main.py
# ─────────────────────────────────────────────────────────────────────────────
"""
FastAPI backend for MeetScribe MVP.

 • Chunk uploads trigger Celery tasks for transcription.
 • Automatic SQLite migrations (see migrations.py).
 • Summary generation is handled by Celery task when all chunks are transcribed.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path

import openai
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, SQLModel, create_engine, select # Removed: func
# Removed: from starlette.concurrency import run_in_threadpool, as it's replaced by Celery

from .config import settings
from .migrations import migrate
from .models import Meeting, MeetingChunk, MeetingCreate, MeetingRead
# from .templates import TEMPLATES # Templates moved to worker or shared location if needed by worker
from .worker import process_transcription_and_summary # Import Celery task

# ────────────────────────────── setup ─────────────────────────────────────────

LOGGER = logging.getLogger("meetscribe")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

openai.api_key = settings.openai_api_key

engine = create_engine(f"sqlite:///{settings.db_path}", echo=False)
SQLModel.metadata.create_all(engine)   # create new tables if needed
migrate(engine)                        # add missing columns (e.g. final_received)

AUDIO_DIR = Path("data/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Whisper model is no longer loaded here; it's loaded in the Celery worker.
# LOGGER.info("🔊 Loading Whisper model (%s)…", settings.whisper_model_size)
# _whisper = WhisperModel(settings.whisper_model_size, device="cpu", compute_type="int8")
# LOGGER.info("✅ Whisper model loaded.")


# ─────────────────────────── helpers ─────────────────────────────────────────
# transcribe_webm_chunk, summarise, and _rebuild_transcript are now primarily handled by the Celery worker.
# If any part of these helpers is needed by main.py directly, they should be refactored or imported.
# For this change, they are effectively moved to worker.py or a shared utility.

# ─────────────────── FastAPI application ─────────────────────────────────────

app = FastAPI(title="MeetScribe MVP")

# ─── CORS: explicitly allow our frontend origin ──────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://meetscribe.i-am-hellguz.uk",
        "http://localhost:5173",
        settings.FRONTEND_ORIGIN # Add from .env for flexibility
    ] if hasattr(settings, 'FRONTEND_ORIGIN') and settings.FRONTEND_ORIGIN else [
        "https://meetscribe.i-am-hellguz.uk",
        "http://localhost:5173" # Fallback if FRONTEND_ORIGIN not in .env
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/meetings", response_model=MeetingRead, status_code=201)
def create_meeting(body: MeetingCreate):
    with Session(engine) as db:
        mtg = Meeting(**body.model_dump()) # Use model_dump for Pydantic v2+
        db.add(mtg)
        db.commit()
        db.refresh(mtg)
        LOGGER.info("🆕  meeting %s created", mtg.id)
        return mtg


@app.post("/api/chunks")
async def upload_chunk(
    meeting_id: uuid.UUID = Form(...),
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
    is_final: bool = Form(False),
):
    chunk_path: Path | None = None # Define chunk_path to ensure it's available for Celery task
    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
        if not mtg:
            raise HTTPException(404, "meeting not found")

        # Save chunk file
        mtg_dir = AUDIO_DIR / str(meeting_id)
        mtg_dir.mkdir(parents=True, exist_ok=True)
        chunk_path = mtg_dir / f"chunk_{chunk_index:03d}.webm"

        with chunk_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        size_kb = chunk_path.stat().st_size / 1024
        LOGGER.info(
            "⬆️  chunk %d for %s (%.1f kB) final=%s. Queuing for transcription.",
            chunk_index,
            meeting_id,
            size_kb,
            is_final,
        )

        # Ignore tiny chunks (e.g. the “empty” final)
        if size_kb < 0.1: # Adjusted threshold for truly empty files
            LOGGER.warning("⚠️  tiny chunk %d skipped", chunk_index)
            if is_final:
                mtg.final_received = True
                if mtg.expected_chunks is None: # If final is tiny, set expected_chunks
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

        # Create or update MeetingChunk row (text is None for now)
        mc = db.exec(
            select(MeetingChunk).where(
                MeetingChunk.meeting_id == meeting_id,
                MeetingChunk.chunk_index == chunk_index,
            )
        ).first()
        if not mc:
            mc = MeetingChunk(
                meeting_id=meeting_id, chunk_index=chunk_index, path=str(chunk_path), text=None
            )
        else:
            mc.path = str(chunk_path) # Update path if re-uploading
            mc.text = None # Reset text if re-uploading
        db.add(mc)

        # Update received_chunks
        mtg.received_chunks += 1
        if is_final:
            mtg.final_received = True
            if mtg.expected_chunks is None:
                mtg.expected_chunks = mtg.received_chunks

        db.add(mtg)
        db.commit()
        db.refresh(mtg) # Refresh to get latest state for response

    # Dispatch Celery task for transcription and potential summarization
    # Pass paths as strings, and IDs as strings if they are UUIDs, for Celery serialization
    if chunk_path:
        process_transcription_and_summary.delay(
            meeting_id_str=str(meeting_id),
            chunk_index=chunk_index,
            chunk_path_str=str(chunk_path.resolve()) # Ensure absolute path
        )
    else: # Should not happen if size_kb is not tiny
        LOGGER.error(f"Chunk path not set for meeting {meeting_id}, chunk {chunk_index}. Task not sent.")
        # Potentially raise error or handle gracefully

    return {
        "ok": True,
        "skipped": False,
        "received_chunks": mtg.received_chunks,
        "done": mtg.done, # This will be False initially, updated by worker
        "expected_chunks": mtg.expected_chunks,
        # latest_chunk_text is no longer available immediately
    }


@app.get("/api/meetings/{mid}", response_model=MeetingRead)
def get_meeting(mid: uuid.UUID):
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404, "Meeting not found")
        return mtg


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}