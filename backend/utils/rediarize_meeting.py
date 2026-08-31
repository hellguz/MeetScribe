"""
utils/rediarize_meeting.py
────────────────────────────────────────────────────────
Command-line counterpart to the "re-run with speaker labels" button, for
backfilling meetings in bulk.

Both call the same worker (`tasks.rediarize_meeting_in_worker`), so the result
is identical to a freshly recorded meeting.

Two prerequisites, checked per meeting:

  * the chunk audio must still be on disk (it is deleted only when the meeting
    is deleted, but older meetings may predate retention)
  * each chunk needs Whisper segment timings. Meetings from before that column
    existed have none, so their audio is transcribed again first — that costs
    API calls when RECOGNITION_IN_CLOUD is true.

Usage (from the backend/ directory):

    python utils/rediarize_meeting.py --list
    python utils/rediarize_meeting.py <id-or-prefix> [...]
    python utils/rediarize_meeting.py --all-with-audio
"""

import argparse
import logging
import sys
import uuid
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from sqlmodel import Session, create_engine, select

from app.config import settings
from app.models import Meeting
from app import tasks

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("rediarize")


def make_engine():
    return create_engine(f"sqlite:///{settings.db_path}", echo=False)


def describe(db: Session, mtg: Meeting) -> str:
    chunks = tasks.meeting_audio_chunks(db, mtg.id)
    with_timings = sum(1 for c in chunks if c.segments_json)
    return (
        f"{str(mtg.id)[:8]}  audio={len(chunks):3d}  timings={with_timings:3d}  "
        f"speakers={mtg.speaker_count!s:>4}  {(mtg.title or '')[:44]}"
    )


def candidates(db: Session) -> list[Meeting]:
    meetings = db.exec(select(Meeting).order_by(Meeting.started_at.desc())).all()
    return [m for m in meetings if tasks.meeting_audio_chunks(db, m.id)]


def resolve(db: Session, token: str) -> Meeting | None:
    wanted = token.replace("-", "").lower()
    for mtg in db.exec(select(Meeting)).all():
        if str(mtg.id).replace("-", "").lower().startswith(wanted):
            return mtg
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Re-run diarization and summary for existing meetings."
    )
    parser.add_argument("ids", nargs="*", help="meeting ids or unique prefixes")
    parser.add_argument("--list", action="store_true", help="show what can be re-diarized")
    parser.add_argument(
        "--all-with-audio", action="store_true", help="every meeting whose audio survives"
    )
    parser.add_argument(
        "--no-retranscribe",
        action="store_true",
        help="skip rebuilding missing timings (meetings without them are then skipped)",
    )
    args = parser.parse_args()

    engine = make_engine()

    with Session(engine) as db:
        if args.list:
            rows = candidates(db)
            total = len(db.exec(select(Meeting)).all())
            print(f"{len(rows)} of {total} meetings still have audio and can be re-diarized:\n")
            for mtg in rows:
                print("  " + describe(db, mtg))
            if not rows:
                print("  (none)")
            return 0

        targets: list[uuid.UUID] = []
        for token in args.ids:
            mtg = resolve(db, token)
            if not mtg:
                log.error("No meeting matching %r", token)
                return 1
            targets.append(mtg.id)

        if args.all_with_audio:
            targets += [m.id for m in candidates(db) if m.id not in targets]

        if not targets:
            parser.print_help()
            return 1

        for mid in targets:
            mtg = db.get(Meeting, mid)
            log.info("=== %s", describe(db, mtg))

    # Outside the session: the worker opens its own.
    for mid in targets:
        tasks.rediarize_meeting_in_worker(str(mid), retranscribe=not args.no_retranscribe)
        with Session(engine) as db:
            mtg = db.get(Meeting, mid)
            log.info(
                "  -> speakers=%s duration=%ss words=%s",
                mtg.speaker_count, mtg.duration_seconds, mtg.word_count,
            )

    log.info("Finished %d meeting(s).", len(targets))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
