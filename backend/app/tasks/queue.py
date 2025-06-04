import uuid
from redis import Redis
from rq import Queue
from app.config import settings

queue = Queue("transcribe", connection=Redis.from_url(settings.redis_url))

def enqueue_transcription(meeting_id: uuid.UUID, chunk_id: str, key: str):
    queue.enqueue(
        "worker.worker.process_chunk",
        meeting_id=str(meeting_id),
        chunk_id=chunk_id,
        key=key,
    )


