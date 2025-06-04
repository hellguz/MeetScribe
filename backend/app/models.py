import uuid
import datetime as dt
from typing import Optional

from sqlmodel import SQLModel, Field

# ──────────────────────────────────────────────────────────────────────────────
# Data-models
# ──────────────────────────────────────────────────────────────────────────────


class Meeting(SQLModel, table=True):
    """
    Main DB table for a recorded meeting.

    • `id`               – primary-key UUID
    • `title`            – meeting title
    • `started_at`       – UTC timestamp, defaults to now
    • `expected_chunks`  – total chunks we expect (can be NULL if unknown)
    • `received_chunks`  – number of chunks we have stored so far
    • `transcript_text`  – raw concatenated transcript
    • `summary_markdown` – GPT summary (markdown)
    • `done`             – True once summary_markdown is filled
    """
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    title: str
    started_at: dt.datetime = Field(default_factory=dt.datetime.utcnow)
    expected_chunks: int | None = None
    received_chunks: int = 0
    transcript_text: Optional[str] = None
    summary_markdown: Optional[str] = None
    done: bool = False


class MeetingCreate(SQLModel):
    """
    Payload for creating a meeting from the frontend.
    """
    title: str
    expected_chunks: int | None = None


class MeetingRead(SQLModel):
    """
    What we send back to the frontend.
    """
    id: uuid.UUID
    title: str
    started_at: dt.datetime
    summary_markdown: Optional[str]
    transcript_text: Optional[str]   # <— added so the frontend can display it
    done: bool
