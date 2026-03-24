# Design: Remove Redis & Celery — Simplify Infrastructure

**Date:** 2026-03-24
**Status:** Approved

## Goal

Collapse the backend from three running processes (Redis + FastAPI + Celery Worker) to a single FastAPI process. All existing functionality is preserved. The database schema is unchanged.

## Motivation

- Fewer services to start locally and in Docker
- Remove two heavy infrastructure dependencies (Redis, Celery)
- Easier onboarding and local development
- Same feature set and concurrent capacity

---

## Architecture

### Before

```
Redis (broker/backend)
FastAPI (API, dispatches tasks via .delay())
Celery Worker + Beat (transcription, summarization, translation, periodic tasks)
Frontend (nginx)
```

### After

```
FastAPI (API + background tasks via ThreadPoolExecutor + APScheduler)
Frontend (nginx)
```

Inside the single FastAPI process:

- **`ThreadPoolExecutor`** (default 4 threads, configurable via `WORKER_THREADS` env var): handles CPU-bound background work — transcription, summarization, translation. Tasks are submitted with `executor.submit()` instead of `.delay()`.
- **`APScheduler`** (background thread scheduler): runs two periodic jobs:
  - `cleanup_stuck_meetings` — every 15 minutes
  - `backup_database` — nightly at midnight
- **Startup hook**: `cleanup_stuck_meetings()` is called once immediately on server start (same behaviour as the current `@worker_ready` Celery signal).
- **Shutdown hook**: FastAPI `lifespan` context stops APScheduler and waits for the executor to drain cleanly.

---

## Files Changed

### `backend/app/worker.py` → `backend/app/tasks.py`

All pure-logic functions are unchanged:
- `transcribe_webm_chunk_in_worker`
- `summarise_transcript_in_worker`
- `finalize_meeting_processing`
- `parse_markdown_into_sections`
- `generate_title_for_meeting`
- `detect_language_local`
- `generate_section_content_for_type`
- `rebuild_full_transcript`
- `cleanup_stuck_meetings`
- `backup_database`

What changes:
- Remove all `celery`, `@celery_app.task`, `@worker_ready.connect` imports and decorators
- `process_transcription_and_summary`, `generate_summary_only`, `translate_meeting_sections` become plain Python functions with internal retry loops (3 attempts, 60s sleep between)
- `cleanup_stuck_meetings` and `backup_database` become plain functions (called by APScheduler)
- `get_db_engine()` singleton is retained (threads each open their own `Session`)

Retry pattern (replaces Celery's `max_retries` / `default_retry_delay`):
```python
for attempt in range(3):
    try:
        ...do work...
        break
    except Exception as exc:
        if attempt == 2:
            LOGGER.error("Failed after 3 attempts: %s", exc, exc_info=True)
        else:
            time.sleep(60)
```

### `backend/app/main.py`

- Import `tasks` instead of `worker`
- Create module-level `ThreadPoolExecutor` and `APScheduler`
- Add `lifespan` context manager:
  - On startup: start scheduler, submit initial `cleanup_stuck_meetings` to executor
  - On shutdown: shutdown scheduler, shutdown executor (wait=True)
- Replace every `.delay(...)` call with `executor.submit(...)`
- Remove Celery imports

### `backend/app/config.py`

- Remove `celery_broker_url` and `celery_result_backend`
- Add `worker_threads: int = 4`

### `backend/requirements.txt`

- Remove: `celery==5.4.0`, `redis==5.0.7`
- Add: `apscheduler~=3.10`

### `docker-compose.yml`

- Remove `redis` service
- Remove `celeryworker` service
- Remove `redis-data` volume
- Remove `depends_on: redis` from `backend`

---

## Data Flow

### Chunk upload (unchanged from client perspective)

1. Frontend POSTs chunk → API saves file to disk, updates DB, returns `{"ok": true}` immediately
2. API submits `process_transcription_and_summary(meeting_id, chunk_index, chunk_path)` to executor
3. Thread transcribes audio, updates `MeetingChunk.text` in DB, checks completion, calls `finalize_meeting_processing` if all chunks done
4. Frontend polls `GET /api/meetings/{id}` to track progress (unchanged)

### Concurrency

- SQLite handles concurrent writes via connection-level locking — same as before (each Celery worker task opened its own session; each thread does the same)
- Whisper model singleton is read-only during inference — thread-safe
- 2–10 concurrent users: each gets a thread from the pool; if pool is exhausted, tasks queue internally in the executor

---

## What Is NOT Changed

- Database schema (all models, migrations, utilities unchanged)
- All API endpoints and their behaviour
- All AI logic (prompts, summarization, title generation, translation)
- Frontend (zero changes)
- Audio file storage layout
- Backup logic and retention policy

---

## Dependencies Summary

| Package | Before | After |
|---|---|---|
| `celery` | 5.4.0 | removed |
| `redis` | 5.0.7 | removed |
| `apscheduler` | — | ~3.10 (added) |

Net: -2 heavy deps, +1 lightweight dep.
