import uuid
import datetime as dt
from typing import Optional
from sqlmodel import SQLModel, Field

class MeetingBase(SQLModel):
    title: str
    started_at: dt.datetime = Field(default_factory=dt.datetime.utcnow)

class Meeting(MeetingBase, table=True):
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(foreign_key="user.id")
    summary_markdown: Optional[str] = None
    transcript_text: Optional[str] = None
    done: bool = False
    expected_chunks: int | None = None

class MeetingCreate(MeetingBase):
    expected_chunks: int | None = None

class MeetingRead(MeetingBase):
    id: uuid.UUID
    summary_markdown: Optional[str]
    done: bool


