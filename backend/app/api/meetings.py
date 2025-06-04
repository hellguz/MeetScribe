import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.auth import current_user
from app.db import engine
from app.models.meeting import Meeting, MeetingCreate, MeetingRead

router = APIRouter()

def get_db():
    with Session(engine) as s:
        yield s

@router.post("/meetings", response_model=MeetingRead, status_code=201)
def create(
    body: MeetingCreate,
    db: Session = Depends(get_db),
    user = Depends(lambda: None),        # ← auth optional
):
    owner_id = user.id if user else uuid.uuid4()
    m = Meeting(**body.dict(), owner_id=owner_id)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m

@router.get("/meetings", response_model=List[MeetingRead])
def mine(db: Session = Depends(get_db), user = Depends(current_user)):
    return db.exec(select(Meeting).where(Meeting.owner_id == user.id)).all()

@router.get("/meetings/{mid}", response_model=MeetingRead)
def one(mid: uuid.UUID, db: Session = Depends(get_db), user = Depends(current_user)):
    m = db.get(Meeting, mid)
    if not m or m.owner_id != user.id:
        raise HTTPException(404)
    return m


