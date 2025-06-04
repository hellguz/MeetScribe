import uuid
import datetime as dt
from sqlmodel import SQLModel, Field

class Chunk(SQLModel, table=True):
    id: str = Field(primary_key=True)
    meeting_id: uuid.UUID = Field(foreign_key="meeting.id")
    checksum: str
    size: int
    received_at: dt.datetime = Field(default_factory=dt.datetime.utcnow)


