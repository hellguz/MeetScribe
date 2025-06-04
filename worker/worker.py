import os
import uuid
import tempfile
from pathlib import Path

import openai
from faster_whisper import WhisperModel
from redis import Redis
from rq import Worker, Queue, Connection
from sqlmodel import Session, select

from app.config import settings
from app.db import engine
from app.models.meeting import Meeting
from app.models.chunk import Chunk
from app.services import s3

openai.api_key = os.getenv("OPENAI_API_KEY", "dummy")

model_size = "tiny"
whisper = WhisperModel(model_size, device="cpu", compute_type="int8")


def transcribe(path: Path) -> str:
    segments, _ = whisper.transcribe(str(path), beam_size=5)
    return " ".join(s.text for s in segments)


def summarise(text: str) -> str:
    rsp = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You summarise meetings."},
            {"role": "user", "content": f"Summarise:\n{text}"},
        ],
        temperature=0.3,
    )
    return rsp.choices[0].message.content.strip()


def process_chunk(meeting_id: str, chunk_id: str, key: str):
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(s3.stream(key).read())
        tmp_path = Path(tmp.name)

    text = transcribe(tmp_path)
    tmp_path.unlink(missing_ok=True)

    with Session(engine) as db:
        mtg = db.get(Meeting, uuid.UUID(meeting_id))
        mtg.transcript_text = (mtg.transcript_text or "") + " " + text
        db.add(mtg)
        db.commit()

        # naive completion check
        if (
            mtg.expected_chunks
            and len(db.exec(select(Chunk).where(Chunk.meeting_id == mtg.id)).all())
            >= mtg.expected_chunks
        ):
            mtg.summary_markdown = summarise(mtg.transcript_text)
            mtg.done = True
            db.add(mtg)
            db.commit()


if __name__ == "__main__":
    with Connection(Redis.from_url(os.getenv("REDIS_URL", settings.redis_url))):
        Worker([Queue("transcribe")]).work()
