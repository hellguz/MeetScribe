from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlmodel import Session, select

from app.config import settings
from app.models.user import User, UserCreate
from app.db import engine

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/token")
ALGORITHM = "HS256"

def get_db():
    with Session(engine) as session:
        yield session

def verify_pw(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def hash_pw(pw: str) -> str:
    return pwd_context.hash(pw)

def create_token(data: dict, minutes: int) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(minutes=minutes)
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)

def auth_user(db: Session, email: str, pw: str) -> User | None:
    user = db.exec(select(User).where(User.email == email)).first()
    if user and verify_pw(pw, user.hashed_password):
        return user
    return None

@router.post("/signup", status_code=201)
def signup(body: UserCreate, db: Session = Depends(get_db)):
    user = User(email=body.email, hashed_password=hash_pw(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"msg": "created"}

@router.post("/token")
def token(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_db)):
    user = auth_user(db, form.username, form.password)
    if not user:
        raise HTTPException(status_code=401, detail="bad creds")
    return {
        "access_token": create_token({"sub": str(user.id)}, settings.access_token_expire_minutes),
        "token_type": "bearer",
    }

def current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        uid = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="bad token")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=401, detail="user gone")
    return user


