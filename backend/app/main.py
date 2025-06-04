from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, ingest, meetings, billing
from app.db import init_db

app = FastAPI(title="MeetScribe API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(meetings.router, prefix="/api")
app.include_router(billing.router, prefix="/api")

@app.on_event("startup")
def startup() -> None:
    init_db()

@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}


