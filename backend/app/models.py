import datetime as dt
import uuid
from typing import List, Optional

from sqlmodel import Field, SQLModel


# ──────────────────────────────────────────────────────────────────────────────
# Data-models
# ──────────────────────────────────────────────────────────────────────────────
class Meeting(SQLModel, table=True):
    """
    Main DB table for a recorded meeting.
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
    # --- NEW COLUMNS ---
    word_count: int | None = None
    duration_seconds: int | None = None
    user_agent: str | None = None
    summary_length: str = Field(default="auto")  # auto, short, medium, long, or a word count as a string


class MeetingChunk(SQLModel, table=True):
    """
    Stores metadata & transcription text for every uploaded chunk.
    """

    id: int | None = Field(default=None, primary_key=True)
    meeting_id: uuid.UUID = Field(foreign_key="meeting.id")
    chunk_index: int
    path: str
    text: Optional[str] = None


class Feedback(SQLModel, table=True):
    """
    Stores user feedback on summaries. Uniqueness for standard feedback types
    is enforced in the application layer, not by the database, to allow
    multiple 'feature_suggestion' entries for the same meeting.
    """
    id: int | None = Field(default=None, primary_key=True)
    meeting_id: uuid.UUID = Field(foreign_key="meeting.id")
    feedback_type: str
    suggestion_text: Optional[str] = None
    created_at: dt.datetime = Field(default_factory=dt.datetime.utcnow)
    status: str = Field(default="new") # 'new', 'done', etc.


class MeetingCreate(SQLModel):
    """
    Payload for creating a meeting from the frontend.
    """

    title: str
    expected_chunks: int | None = None
    summary_length: str | None = None


class FeedbackCreate(SQLModel):
    """
    Payload for submitting feedback. Can be a type or a suggestion.
    """
    meeting_id: uuid.UUID
    feedback_type: str
    suggestion_text: Optional[str] = None


class FeedbackDelete(SQLModel):
    """
    Payload for deleting a feedback item.
    """
    meeting_id: uuid.UUID
    feedback_type: str


class FeedbackStatusUpdate(SQLModel):
    """
    Payload for updating the status of a feedback item.
    """
    status: str


class MeetingStatus(SQLModel):
    """
    What we send back to the frontend for status polling:
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
    summary_length: str
    feedback: list[str] = [] # List of submitted feedback types


class MeetingTitleUpdate(SQLModel):
    """
    Payload for updating a meeting's title.
    """

    title: str


class MeetingMeta(SQLModel):
    """
    Slimmed-down meeting model for history lists.
    """

    id: uuid.UUID
    title: str
    started_at: dt.datetime
    status: str  # "pending" | "complete"


class MeetingSyncRequest(SQLModel):
    """
    Payload for the sync endpoint, containing the list of
    meeting IDs the client is aware of.
    """
    ids: list[uuid.UUID]


class RegeneratePayload(SQLModel):
    """
    Payload for the regenerate endpoint, allowing a new
    summary length to be specified.
    """

    summary_length: str | None = None


class MeetingConfigUpdate(SQLModel):
    """
    Payload for updating a meeting's configuration, like summary length.
    """

    summary_length: str
