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

_whisper = WhisperModel(
    settings.whisper_model_size,
    device="cpu",
    compute_type="int8",
)

# ─────────────────────────── helpers ─────────────────────────────────────────
def transcribe(path: Path) -> str:
    segments, _ = _whisper.transcribe(str(path), beam_size=5)
    return " ".join(s.text for s in segments)


def summarise(text: str) -> str:
    rsp = openai.chat.completions.create(
        model="gpt-4.1-mini-2025-04-14",
        temperature=0.3,
        messages=[
            {"role": "system", "content": "You summarise meetings into markdown."},
            {"role": "user", "content": f"Summarise:\n{text}"},
        ],
    )
    return rsp.choices[0].message.content.strip()


# ─────────────────── FastAPI application ─────────────────────────────────────
app = FastAPI(title="MeetScribe MVP")


@app.post("/api/meetings", response_model=MeetingRead, status_code=201)
def create_meeting(body: MeetingCreate):
    with Session(engine) as db:
        mtg = Meeting(**body.dict())
        db.add(mtg)
        db.commit()
        db.refresh(mtg)
        LOGGER.info("🆕  meeting %s created (expected_chunks=%s)", mtg.id, mtg.expected_chunks)
        return mtg


@app.post("/api/chunks")
async def upload_chunk(
    meeting_id: uuid.UUID = Form(...),
    chunk_id: str = Form(...),
    file: UploadFile = File(...),
):
    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
        if not mtg:
            raise HTTPException(404, "meeting not found")

        if mtg.done:
            LOGGER.info("⏩  meeting %s already done – chunk %s ignored", meeting_id, chunk_id)
            return {"ok": True, "ignored": True}

        # save file
        mtg_dir = AUDIO_DIR / str(meeting_id)
        mtg_dir.mkdir(parents=True, exist_ok=True)
        chunk_path = mtg_dir / f"{chunk_id}.webm"
        with chunk_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        size_kb = chunk_path.stat().st_size / 1024
        LOGGER.info("⬆️  chunk %s for %s (%.1f kB)", chunk_id, meeting_id, size_kb)

        if size_kb < 4:
            LOGGER.warning("⚠️  chunk %s too small – skipped", chunk_id)
            return {"ok": True, "skipped": True}

        try:
            text = transcribe(chunk_path)
        except av.error.InvalidDataError:
            LOGGER.exception("⚠️  chunk %s could not be decoded – skipped", chunk_id)
            return {"ok": True, "skipped": True}

        LOGGER.info("📝  transcribed %.1f kB → %d chars", size_kb, len(text))
        LOGGER.info("   %s", text[:120] + ("…" if len(text) > 120 else ""))
        mtg.transcript_text = (mtg.transcript_text or "") + " " + text
        mtg.received_chunks += 1

        if (
            mtg.summary_markdown is None
            and (mtg.expected_chunks is None or mtg.received_chunks >= mtg.expected_chunks)
        ):
            mtg.summary_markdown = summarise(mtg.transcript_text)
            mtg.done = True
            LOGGER.info("✅  meeting %s summarised", meeting_id)

        db.add(mtg)
        db.commit()
        return {"ok": True}


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
