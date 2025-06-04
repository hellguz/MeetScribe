import uuid
import datetime as dt
from typing import Optional

from sqlmodel import SQLModel, Field


class Meeting(SQLModel, table=True):
    """
    DB table + ORM model.

    NOTE:
    • `started_at` is *NOT NULL* in the SQLite schema, so we must always supply
      a value.  We use `default_factory=dt.datetime.utcnow` to populate it
      automatically on INSERT.
    """
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    title: str

    # <- this default_factory fixes the IntegrityError
    started_at: dt.datetime = Field(default_factory=dt.datetime.utcnow)

    expected_chunks: int | None = None
    received_chunks: int = 0

    transcript_text: Optional[str] = None
    summary_markdown: Optional[str] = None
    done: bool = False


class MeetingCreate(SQLModel):
    title: str
    expected_chunks: int | None = None


class MeetingRead(SQLModel):
    id: uuid.UUID
    title: str
    started_at: dt.datetime
    summary_markdown: Optional[str]
    done: bool
