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
    summary_length: str = Field(default="auto")
    summary_language_mode: str = Field(default="auto")
    summary_custom_language: str | None = None
    context: str | None = None
    timezone: str | None = None


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


class MeetingSection(SQLModel, table=True):
    """
    Stores custom section configurations for each meeting.
    Allows users to add, remove, reorder, and customize sections within summaries.
    """
    id: int | None = Field(default=None, primary_key=True)
    meeting_id: uuid.UUID = Field(foreign_key="meeting.id")
    section_type: str  # 'default' for AI-generated, 'custom' for user-added
    section_key: str  # 'summary', 'timeline', 'feedback', etc.
    title: str
    content: Optional[str] = None  # Markdown content, NULL for sections pending generation
    position: int = 0  # Order position
    is_enabled: bool = True  # Can be hidden/shown
    template_type: Optional[str] = None  # 'timeline', 'metrics', 'feedback', 'bullet_points', 'custom'
    created_at: dt.datetime = Field(default_factory=dt.datetime.utcnow)
    updated_at: dt.datetime = Field(default_factory=dt.datetime.utcnow)


class MeetingCreate(SQLModel):
    """
    Payload for creating a meeting from the frontend.
    """

    title: str
    expected_chunks: int | None = None
    summary_length: str | None = None
    summary_language_mode: str | None = None
    summary_custom_language: str | None = None
    context: str | None = None
    timezone: str | None = None


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
    summary_language_mode: str
    summary_custom_language: str | None = None
    context: str | None = None
    timezone: str | None = None
    feedback: list[str] = [] # List of submitted feedback types


class MeetingTitleUpdate(SQLModel):
    """
    Payload for updating a meeting's title.
    """

    title: str


class MeetingContextUpdate(SQLModel):
    """Payload for updating a meeting's context."""
    context: str


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
    summary_language_mode: str | None = None
    summary_custom_language: str | None = None
    context: str | None = None


class MeetingConfigUpdate(SQLModel):
    """
    Payload for updating a meeting's configuration, like summary length.
    """
    summary_length: Optional[str] = None
    summary_language_mode: Optional[str] = None
    summary_custom_language: Optional[str] = None


class MeetingSectionCreate(SQLModel):
    """
    Payload for creating a new custom section.
    """
    section_key: str
    title: str
    template_type: str  # 'timeline', 'metrics', 'feedback', 'bullet_points', 'custom'
    position: int


class MeetingSectionUpdate(SQLModel):
    """
    Payload for updating a section's content or title.
    """
    title: Optional[str] = None
    content: Optional[str] = None
    is_enabled: Optional[bool] = None


class MeetingSectionReorder(SQLModel):
    """
    Payload for reordering sections.
    """
    section_ids: list[int]  # Ordered list of section IDs


class MeetingSectionResponse(SQLModel):
    """
    Response model for section data.
    """
    id: int
    meeting_id: uuid.UUID
    section_type: str
    section_key: str
    title: str
    content: Optional[str] = None
    position: int
    is_enabled: bool
    template_type: Optional[str] = None
    created_at: dt.datetime
    updated_at: dt.datetime



