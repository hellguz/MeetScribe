"""
FastAPI backend for MeetScribe MVP.
Handles meeting creation, chunk uploads, transcription and summarisation.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
from typing import List
import datetime as dt  # Added for date/time in summaries

import av
import openai
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import JSONResponse
from sqlmodel import Session, SQLModel, create_engine

from .config import settings
from .models import Meeting, MeetingCreate, MeetingRead

# ────────────────────────────── setup ─────────────────────────────────────────

LOGGER = logging.getLogger("meetscribe")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

openai.api_key = settings.openai_api_key

engine = create_engine(f"sqlite:///{settings.db_path}", echo=False)
SQLModel.metadata.create_all(engine)

AUDIO_DIR = Path("data/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

from faster_whisper import WhisperModel  # noqa: E402

LOGGER.info("🔊 Loading Whisper model (%s)...", settings.whisper_model_size)
_whisper = WhisperModel(
    settings.whisper_model_size,
    device="cpu",
    compute_type="int8",
)
LOGGER.info("✅ Whisper model loaded.")

# ─────────────────────────── helpers ─────────────────────────────────────────
def transcribe_webm_chunk(chunk_path: Path, first_chunk_path: Path | None = None) -> str:
    """
    Transcribe a WebM chunk. For non-first chunks, prepend the first chunk's header.
    """
    try:
        if first_chunk_path and chunk_path != first_chunk_path:
            # Create a temporary file containing the header + this chunk's data
            temp_path = chunk_path.parent / f"temp_{chunk_path.name}"

            with first_chunk_path.open("rb") as first_file:
                header_data = first_file.read(1024)

            with temp_path.open("wb") as temp_file:
                temp_file.write(header_data)
                with chunk_path.open("rb") as chunk_file:
                    temp_file.write(chunk_file.read())

            segments, _ = _whisper.transcribe(str(temp_path), beam_size=5)
            result = " ".join(s.text for s in segments)
            temp_path.unlink(missing_ok=True)
            return result
        else:
            segments, _ = _whisper.transcribe(str(chunk_path), beam_size=5)
            return " ".join(s.text for s in segments)
    except Exception as e:
        LOGGER.warning(f"Failed to transcribe chunk {chunk_path.name}: {e}")
        return ""


def summarise(text: str, started_at: dt.datetime) -> str:
    """
    Summarise the full transcript into a Markdown document using one of the
    predefined templates. Key rules:

    • Pick the template that best fits the meeting (or craft a similar one).
    • Detect the predominant language and write the summary—including headings—in
      that language.
    • Insert the actual current date & time into the summary.
    • Delete any section/field whose content is empty (even if the template
      didn't mark it “(if available)”).
    • Unless the first “Type” line adds real value, omit it entirely.
    • Output only the completed Markdown—no additional commentary.
    """
    if not text or len(text.strip()) < 10:
        return "Recording too short to generate meaningful summary."

    date_str = started_at.strftime("%Y-%m-%d")
    time_range = f"{started_at.strftime('%H:%M')} - {dt.datetime.utcnow().strftime('%H:%M')}"

    # The raw templates (exactly as specified by the user)
    TEMPLATES = """
1. General Meeting Summary Template
# Meeting Summary

**Type:** [General Meeting / Consultation / Project Meeting / Project Presentation]

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Location:** [Physical/Virtual Location, if available]

## Participants (if available)
- [Name 1, if available]
- [Name 2, if available]

## Agenda/Objectives (if available)
- [Objective 1, if available]
- [Objective 2, if available]

## Key Discussion Points
- [Topic 1]
  - [Summary/Details]
- [Topic 2]
  - [Summary/Details]

## Decisions Made (if available)
- [Decision 1, if available]
- [Decision 2, if available]

## Action Items (if available)
| Task         | Owner   | Deadline   |
|--------------|---------|------------|
| [Task 1, if available]     | [Person, if available]| [Date, if available]     |
| [Task 2, if available]     | [Person, if available]| [Date, if available]     |

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]

## Additional Notes
[Any other relevant information or context]

2. Consultation Session Template
# Consultation Session Summary

**Type:** Consultation

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Client:** [Client Name, if available]

## Attendees (if available)
- [Consultant Name, if available]
- [Client Name/Representative, if available]
- [Other Participants, if available]

## Topics Discussed
- [Topic 1]
  - [Summary]
- [Topic 2]
  - [Summary]

## Recommendations (if available)
- [Recommendation 1, if available]
- [Recommendation 2, if available]

## Follow-Up Actions (if available)
- [Action 1, if available]
- [Action 2, if available]

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]

3. Project Meeting Template
# Project Meeting Summary

**Type:** Project Meeting

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Project:** [Project Name, if available]

## Participants (if available)
- [Team Member 1, if available]
- [Team Member 2, if available]

## Agenda (if available)
- [Agenda Item 1, if available]
- [Agenda Item 2, if available]

## Progress Updates
- [Update 1]
- [Update 2]

## Issues/Risks Identified (if available)
- [Issue/Risk 1, if available]
- [Issue/Risk 2, if available]

## Decisions (if available)
- [Decision 1, if available]
- [Decision 2, if available]

## Action Items (if available)
| Task         | Owner   | Deadline   |
|--------------|---------|------------|
| [Task 1, if available]     | [Person, if available]| [Date, if available]     |
| [Task 2, if available]     | [Person, if available]| [Date, if available]     |

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]

4. Project Presentation Summary Template
# Project Presentation Summary

**Type:** Project Presentation

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Presenter:** [Presenter Name, if available]

## Attendees (if available)
- [Attendee 1, if available]
- [Attendee 2, if available]

## Presentation Topics
- [Topic 1]
  - [Key Points]
- [Topic 2]
  - [Key Points]

## Questions & Answers (if available)
- **Q:** [Question, if available]
  - **A:** [Answer, if available]
- **Q:** [Question, if available]
  - **A:** [Answer, if available]

## Feedback/Next Steps (if available)
- [Feedback 1, if available]
- [Next Step 1, if available]

5. Brainstorming Session Template
# Brainstorming Session Summary

**Type:** Brainstorming

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]

## Participants (if available)
- [Participant 1, if available]
- [Participant 2, if available]

## Goals (if available)
- [Goal 1, if available]
- [Goal 2, if available]

## Ideas Generated
- [Idea 1]
- [Idea 2]

## Top Ideas (Voted/Selected, if available)
- [Top Idea 1, if available]
- [Top Idea 2, if available]

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]

6. Retrospective/Review Meeting Template
# Retrospective Meeting Summary

**Type:** Retrospective/Review

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Project/Team:** [Name, if available]

## Participants (if available)
- [Participant 1, if available]
- [Participant 2, if available]

## What Went Well
- [Positive 1]
- [Positive 2]

## What Could Be Improved
- [Improvement 1]
- [Improvement 2]

## Action Items (if available)
- [Action 1, if available]
- [Action 2, if available]

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]
"""

    system_prompt = f"""
You are a meeting-summary generator.

RULES
• Decide which template (1–6) suits the meeting. If none is perfect, adapt one.
• Detect the dominant language of the transcript and translate ALL headings,
  labels and fixed table headers into that language. Summarise in that language.
• Substitute {date_str} for any [YYYY-MM-DD] placeholder.
• Substitute {time_range} for any [HH:MM - HH:MM] placeholder.
• Strip every section/field that ends up empty—regardless of “(if available)”.
• Omit the initial “**Type:** …” line unless it communicates meaningful info.
• Remove ALL leftover placeholders/brackets.
• Return ONLY the filled Markdown, no extra prose.

TEMPLATES
{TEMPLATES}
"""

    rsp = openai.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.3,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Here is the full transcript:\n{text}"},
        ],
    )
    return rsp.choices[0].message.content.strip()


# ─────────────────── FastAPI application ─────────────────────────────────────
app = FastAPI(title="MeetScribe MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/meetings", response_model=MeetingRead, status_code=201)
def create_meeting(body: MeetingCreate):
    with Session(engine) as db:
        mtg = Meeting(**body.dict())
        db.add(mtg)
        db.commit()
        db.refresh(mtg)
        LOGGER.info("🆕  meeting %s created", mtg.id)
        return mtg


@app.post("/api/chunks")
async def upload_chunk(
    meeting_id: uuid.UUID = Form(...),
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
    is_final: bool = Form(False),
):
    with Session(engine) as db:
        mtg = db.get(Meeting, meeting_id)
        if not mtg:
            raise HTTPException(404, "meeting not found")

        # Save chunk
        mtg_dir = AUDIO_DIR / str(meeting_id)
        mtg_dir.mkdir(parents=True, exist_ok=True)
        chunk_path = mtg_dir / f"chunk_{chunk_index:03d}.webm"

        with chunk_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        size_kb = chunk_path.stat().st_size / 1024
        LOGGER.info("⬆️  chunk %d for %s (%.1f kB) final=%s", chunk_index, meeting_id, size_kb, is_final)

        # Ignore tiny chunks
        if size_kb < 1:
            LOGGER.warning("⚠️  chunk %d too small – skipped", chunk_index)
            chunk_path.unlink(missing_ok=True)
            if not is_final:
                db.add(mtg); db.commit()
                return {"ok": True, "skipped": True, "done": mtg.done}
            LOGGER.info("🗑️  tiny final chunk ignored, continuing")

        # Real-time transcription
        try:
            first_chunk = mtg_dir / "chunk_000.webm"
            if not first_chunk.exists():
                first_chunk = chunk_path
            chunk_text = transcribe_webm_chunk(chunk_path, first_chunk)

            if chunk_text.strip():
                LOGGER.info("📝  chunk %d transcribed (%d chars)", chunk_index, len(chunk_text))
                mtg.transcript_text = (mtg.transcript_text + " " if mtg.transcript_text else "") + chunk_text.strip()
            else:
                LOGGER.warning("⚠️  chunk %d produced no text", chunk_index)
        except Exception as e:
            LOGGER.error("❌  transcription failure on chunk %d: %s", chunk_index, e)

        mtg.received_chunks += 1

        # Final summary
        if is_final and mtg.transcript_text and not mtg.summary_markdown:
            try:
                LOGGER.info("📋  Generating summary …")
                mtg.summary_markdown = summarise(mtg.transcript_text, mtg.started_at)
                mtg.done = True
                LOGGER.info("✅  meeting %s summarised", meeting_id)
            except Exception as e:
                LOGGER.error("❌  summary generation failed: %s", e)

        db.add(mtg)
        db.commit()
        db.refresh(mtg)

        return {
            "ok": True,
            "received_chunks": mtg.received_chunks,
            "done": mtg.done,
            "has_transcript": bool(mtg.transcript_text and mtg.transcript_text.strip()),
            "latest_chunk_text": chunk_text if 'chunk_text' in locals() else None,
        }


@app.get("/api/meetings/{mid}", response_model=MeetingRead)
def get_meeting(mid: uuid.UUID):
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")

        if not mtg.done and mtg.transcript_text:
            # Check for stale meeting
            # Ensure started_at is offset-aware for comparison with offset-awareutcnow()
            # The default factory dt.datetime.utcnow is naive, but SQLite might store it as UTC.
            # For robustness, assume it's naive UTC and make it offset-aware.
            started_at_aware = mtg.started_at.replace(tzinfo=dt.timezone.utc)
            now_aware = dt.datetime.now(dt.timezone.utc)

            STALE_THRESHOLD_MINUTES = 5
            elapsed_time = now_aware - started_at_aware

            if elapsed_time > dt.timedelta(minutes=STALE_THRESHOLD_MINUTES):
                LOGGER.info(
                    "Stale meeting %s (started %s ago) found. Summarizing now.",
                    mid,
                    elapsed_time,
                )
                try:
                    mtg.summary_markdown = summarise(mtg.transcript_text, mtg.started_at)
                    mtg.done = True
                    db.add(mtg)
                    db.commit()
                    db.refresh(mtg)
                    LOGGER.info("✅ Meeting %s summarized and marked as done.", mid)
                except Exception as e:
                    LOGGER.error(
                        "❌ Failed to summarize stale meeting %s: %s", mid, e
                    )
                    # Optionally, re-raise or handle more gracefully if needed
                    # For now, we'll just log and return the meeting as is
        return mtg


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}
