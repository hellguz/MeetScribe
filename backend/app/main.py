# backend/app/main.py
"""
FastAPI backend for MeetScribe MVP.

 • Synchronous transcription of each chunk so front-end gets live text immediately.
 • Automatic SQLite migrations (see migrations.py).
 • When the final chunk arrives (and all are transcribed), summary is generated inline.
"""

from __future__ import annotations

import datetime as dt
import logging
import shutil
import uuid
from pathlib import Path

import openai
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, SQLModel, create_engine, select

from .config import settings
from .migrations import migrate
from .models import Meeting, MeetingChunk, MeetingCreate, MeetingRead
from .templates import TEMPLATES

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

from faster_whisper import WhisperModel  # noqa: E402

LOGGER.info("🔊 Loading Whisper model (%s)…", settings.whisper_model_size)
_whisper = WhisperModel(settings.whisper_model_size, device="cpu", compute_type="int8")
LOGGER.info("✅ Whisper model loaded.")


# ─────────────────────────── helpers ─────────────────────────────────────────

def transcribe_webm_chunk(chunk_path: Path) -> str:
    """
    Transcribe a WebM chunk. If not the first chunk, prepend the first chunk
    so Whisper sees a valid WebM file. Returns concatenated text.
    """
    try:
        first_chunk_path = chunk_path.parent / "chunk_000.webm"
        if first_chunk_path.exists() and chunk_path.name != first_chunk_path.name:
            temp_path = chunk_path.parent / f"temp_{chunk_path.name}"
            with first_chunk_path.open("rb") as f1, temp_path.open("wb") as out:
                out.write(f1.read())
                with chunk_path.open("rb") as f2:
                    out.write(f2.read())
            segments, _ = _whisper.transcribe(str(temp_path), beam_size=5)
            temp_path.unlink(missing_ok=True)
        else:
            segments, _ = _whisper.transcribe(str(chunk_path), beam_size=5)

        return " ".join(s.text for s in segments)
    except Exception as e:
        LOGGER.warning("Failed to transcribe %s: %s", chunk_path.name, e)
        return ""


def summarise(text: str, started_at: dt.datetime) -> str:
    """
    Summarise the full transcript into a Markdown document using GPT-4o-mini.
    """
    if not text or len(text.strip()) < 10:
        return "Recording too short to generate meaningful summary."

    date_str = started_at.strftime("%Y-%m-%d")
    time_range = f"{started_at.strftime('%H:%M')} - {dt.datetime.utcnow().strftime('%H:%M')}"

    system_prompt = f"""
You are a meeting-summary generator.

RULES
• Choose (or adapt) one template 1-6.
• Translate headings to the meeting’s dominant language.
• Replace [YYYY-MM-DD] → {date_str}; [HH:MM - HH:MM] → {time_range}.
• Drop empty sections, remove all placeholders/brackets, return ONLY Markdown.

TEMPLATES
{TEMPLATES}
"""
    rsp = openai.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.3,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Full transcript:\n{text}"},
        ],
    )
    return rsp.choices[0].message.content.strip()


def _rebuild_transcript(db: Session, meeting_id: uuid.UUID) -> str:
    """
    Concatenate all already-transcribed MeetingChunk.text in order.
    """
    parts = (
        db.exec(
            select(MeetingChunk)
            .where(
                MeetingChunk.meeting_id == meeting_id,
                MeetingChunk.text.is_not(None),
            )
            .order_by(MeetingChunk.chunk_index)
        )
        .all()
    )
    return " ".join(p.text for p in parts if p.text)


# ─────────────────── FastAPI application ─────────────────────────────────────

app = FastAPI(title="MeetScribe MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

        # Save chunk file
        mtg_dir = AUDIO_DIR / str(meeting_id)
        mtg_dir.mkdir(parents=True, exist_ok=True)
        chunk_path = mtg_dir / f"chunk_{chunk_index:03d}.webm"

        with chunk_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        size_kb = chunk_path.stat().st_size / 1024
        LOGGER.info(
            "⬆️  chunk %d for %s (%.1f kB) final=%s",
            chunk_index,
            meeting_id,
            size_kb,
            is_final,
        )

        # Ignore tiny chunks (e.g. the “empty” final)
        if size_kb < 1:
            LOGGER.warning("⚠️  tiny chunk %d skipped", chunk_index)
            if is_final:
                mtg.final_received = True
            db.add(mtg)
            db.commit()
            return {
                "ok": True,
                "skipped": True,
                "received_chunks": mtg.received_chunks,
                "done": mtg.done,
                "latest_chunk_text": None,
            }

        # Transcribe synchronously
        chunk_text = transcribe_webm_chunk(chunk_path)

        # Create or update MeetingChunk row
        mc = db.exec(
            select(MeetingChunk).where(
                MeetingChunk.meeting_id == meeting_id,
                MeetingChunk.chunk_index == chunk_index,
            )
        ).first()
        if not mc:
            mc = MeetingChunk(
                meeting_id=meeting_id, chunk_index=chunk_index, path=str(chunk_path), text=chunk_text
            )
        else:
            mc.path = str(chunk_path)
            mc.text = chunk_text
        db.add(mc)

        # Update received_chunks
        mtg.received_chunks += 1
        if is_final:
            mtg.final_received = True
            if mtg.expected_chunks is None:
                mtg.expected_chunks = mtg.received_chunks

        # Rebuild full transcript so far
        mtg.transcript_text = _rebuild_transcript(db, meeting_id)

        # If final & no pending chunks, generate summary now
        pending = db.exec(
            select(MeetingChunk).where(
                MeetingChunk.meeting_id == meeting_id, MeetingChunk.text.is_(None)
            )
        ).first()
        if mtg.final_received and not pending and not mtg.done:
            LOGGER.info("📋  All chunks done for %s – generating summary…", meeting_id)
            try:
                mtg.summary_markdown = summarise(mtg.transcript_text, mtg.started_at)
                mtg.done = True
                LOGGER.info("✅  Meeting %s summarised.", meeting_id)
            except Exception as e:
                LOGGER.error("❌  Summary generation failed: %s", e)

        db.add(mtg)
        db.commit()
        db.refresh(mtg)

        return {
            "ok": True,
            "received_chunks": mtg.received_chunks,
            "done": mtg.done,
            "latest_chunk_text": chunk_text or None,
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
