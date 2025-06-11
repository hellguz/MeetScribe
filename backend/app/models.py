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
    • `last_activity`    – UTC timestamp of last chunk upload (or created_at)
    • `expected_chunks`  – total chunks we expect (None until final marker)
    • `received_chunks`  – number of chunks we have stored so far
    • `final_received`   – True once the client or timeout set final
    • `transcript_text`  – raw concatenated transcript (assembled in order)
    • `summary_markdown` – GPT summary (markdown)
    • `done`             – True once summary_markdown is filled
    """

    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    title: str
    started_at: dt.datetime = Field(default_factory=dt.datetime.utcnow)
    last_activity: dt.datetime = Field(default_factory=dt.datetime.utcnow)
    expected_chunks: int | None = None
    received_chunks: int = 0
    final_received: bool = False
    transcript_text: Optional[str] = None
    summary_markdown: Optional[str] = None
    done: bool = False
    summary_task_queued: bool = False


class MeetingChunk(SQLModel, table=True):
    """
    Stores metadata & transcription text for every uploaded chunk.
    """

    id: int | None = Field(default=None, primary_key=True)
    meeting_id: uuid.UUID = Field(foreign_key="meeting.id")
    chunk_index: int
    path: str
    text: Optional[str] = None


class MeetingCreate(SQLModel):
    """
    Payload for creating a meeting from the frontend.
    """

    title: str
    expected_chunks: int | None = None


class MeetingStatus(SQLModel):
    """
    What we send back to the frontend for status polling:
    • All Meeting fields (except `last_activity` and `final_received`)
    • `transcribed_chunks` = how many chunks already have text
    """

    id: uuid.UUID
    title: str
    started_at: dt.datetime
    summary_markdown: Optional[str]
    transcript_text: Optional[str]
    done: bool
    received_chunks: int
    expected_chunks: Optional[int]
    transcribed_chunks: int
