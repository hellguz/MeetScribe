import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlmodel import Session

from app.api.auth import current_user
from app.db import engine
from app.models.meeting import Meeting
from app.models.chunk import Chunk
from app.services import hashing, s3
from app.tasks.queue import enqueue_transcription

router = APIRouter()

def get_db():
    with Session(engine) as s:
        yield s

@router.post("/chunks")
async def chunk(
    meeting_id: uuid.UUID,
    chunk_id: str,
    file: Annotated[UploadFile, File(...)],
    bg: BackgroundTasks,
    user = Depends(current_user),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if not meeting or meeting.owner_id != user.id:
        raise HTTPException(404)

    blob = await file.read()
    key = f"{meeting_id}/{chunk_id}.webm"
    s3.put_object(key, blob)

    db.add(
        Chunk(
            id=chunk_id,
            meeting_id=meeting_id,
            checksum=hashing.sha256_digest(blob),
            size=len(blob),
        )
    )
    db.commit()

    bg.add_task(enqueue_transcription, meeting_id, chunk_id, key)
    return {"status": "queued"}


