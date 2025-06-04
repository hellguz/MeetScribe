"""
FastAPI backend for MeetScribe MVP.
Handles meeting creation, chunk uploads, transcription and summarisation.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
from typing import List

import av
import openai
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlmodel import Session, SQLModel, create_engine

from .config import settings
from .models import Meeting, MeetingCreate, MeetingRead

# ────────────────────────────── setup ─────────────────────────────────────────
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

from faster_whisper import WhisperModel  # noqa: E402

LOGGER.info("🔊 Loading Whisper model (%s)...", settings.whisper_model_size)
_whisper = WhisperModel(
    settings.whisper_model_size,
    device="cpu",
    compute_type="int8",
)
LOGGER.info("✅ Whisper model loaded.")

# ─────────────────────────── helpers ─────────────────────────────────────────
def transcribe_webm_chunk(chunk_path: Path, first_chunk_path: Path = None) -> str:
    """
    Transcribe a WebM chunk. For non-first chunks, we need to prepend the first chunk's header.
    """
    try:
        if first_chunk_path and chunk_path != first_chunk_path:
            # For subsequent chunks, create a temporary file with proper headers
            temp_path = chunk_path.parent / f"temp_{chunk_path.name}"
            
            # Read first chunk header (first 1KB usually contains headers)
            with first_chunk_path.open("rb") as first_file:
                header_data = first_file.read(1024)
            
            # Combine header with current chunk data
            with temp_path.open("wb") as temp_file:
                temp_file.write(header_data)
                with chunk_path.open("rb") as chunk_file:
                    temp_file.write(chunk_file.read())
            
            # Transcribe the temporary file
            segments, _ = _whisper.transcribe(str(temp_path), beam_size=5)
            result = " ".join(s.text for s in segments)
            
            # Clean up
            temp_path.unlink(missing_ok=True)
            return result
        else:
            # First chunk or standalone - transcribe directly
            segments, _ = _whisper.transcribe(str(chunk_path), beam_size=5)
            return " ".join(s.text for s in segments)
    except Exception as e:
        LOGGER.warning(f"Failed to transcribe chunk {chunk_path.name}: {e}")
        return ""


def summarise(text: str) -> str:
    if not text or len(text.strip()) < 10:
        return "Recording too short to generate meaningful summary."
    
    rsp = openai.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.3,
        messages=[
            {"role": "system", "content": "You summarise meetings into markdown. Provide a concise but comprehensive summary."},
            {"role": "user", "content": f"Summarise this meeting transcript:\n{text}"},
        ],
    )
    return rsp.choices[0].message.content.strip()


# ─────────────────── FastAPI application ─────────────────────────────────────
app = FastAPI(title="MeetScribe MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)


@app.post("/api/meetings", response_model=MeetingRead, status_code=201)
def create_meeting(body: MeetingCreate):
    with Session(engine) as db:
        mtg = Meeting(**body.dict())
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
    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
        if not mtg:
            raise HTTPException(404, "meeting not found")

        # Save chunk with proper naming
        mtg_dir = AUDIO_DIR / str(meeting_id)
        mtg_dir.mkdir(parents=True, exist_ok=True)
        chunk_path = mtg_dir / f"chunk_{chunk_index:03d}.webm"
        
        with chunk_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        size_kb = chunk_path.stat().st_size / 1024
        LOGGER.info("⬆️  chunk %d for %s (%.1f kB) final=%s", chunk_index, meeting_id, size_kb, is_final)

        # Skip tiny chunks (likely empty or corrupted)
        if size_kb < 1:
            LOGGER.warning("⚠️  chunk %d too small – skipped", chunk_index)
            chunk_path.unlink(missing_ok=True)
            if is_final and mtg.transcript_text:
                # Generate summary even if final chunk is empty
                if not mtg.summary_markdown:
                    mtg.summary_markdown = summarise(mtg.transcript_text)
                    mtg.done = True
                    LOGGER.info("✅  meeting %s completed with summary", meeting_id)
            
            db.add(mtg)
            db.commit()
            return {"ok": True, "skipped": True, "done": mtg.done}

        # **REAL-TIME TRANSCRIPTION**: Process each chunk immediately
        try:
            # Find the first chunk for header reference
            first_chunk_path = mtg_dir / "chunk_000.webm"
            if not first_chunk_path.exists():
                first_chunk_path = chunk_path  # This is the first chunk
            
            # Transcribe this chunk
            LOGGER.info("🎤  Transcribing chunk %d in real-time...", chunk_index)
            chunk_text = transcribe_webm_chunk(chunk_path, first_chunk_path)
            
            if chunk_text.strip():
                LOGGER.info("📝  chunk %d transcribed → %d chars: %s", 
                           chunk_index, len(chunk_text), chunk_text[:100] + ("…" if len(chunk_text) > 100 else ""))
                
                # Append to running transcript
                if mtg.transcript_text:
                    mtg.transcript_text += " " + chunk_text.strip()
                else:
                    mtg.transcript_text = chunk_text.strip()
            else:
                LOGGER.warning("⚠️  chunk %d produced no transcription", chunk_index)
                
        except Exception as e:
            LOGGER.error("❌  Failed to transcribe chunk %d: %s", chunk_index, str(e))
            # Continue anyway - don't fail the whole process

        mtg.received_chunks += 1

        # Generate summary if this is the final chunk and we have transcript
        if is_final and mtg.transcript_text and not mtg.summary_markdown:
            try:
                LOGGER.info("📋  Generating final summary...")
                mtg.summary_markdown = summarise(mtg.transcript_text)
                mtg.done = True
                LOGGER.info("✅  meeting %s completed with %d chunks", meeting_id, mtg.received_chunks)
            except Exception as e:
                LOGGER.error("❌  Failed to generate summary: %s", str(e))

        db.add(mtg)
        db.commit()
        db.refresh(mtg)
        
        return {
            "ok": True, 
            "received_chunks": mtg.received_chunks,
            "done": mtg.done,
            "has_transcript": bool(mtg.transcript_text and mtg.transcript_text.strip()),
            "latest_chunk_text": chunk_text if 'chunk_text' in locals() else None
        }


@app.get("/api/meetings/{mid}", response_model=MeetingRead)
def get_meeting(mid: uuid.UUID):
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(404)
        return mtg


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}
