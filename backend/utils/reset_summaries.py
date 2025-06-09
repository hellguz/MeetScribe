"""
utils/reset_summaries.py
────────────────────────────────────────────────────────
Clear `summary_markdown` and `done` for every Meeting row
so the next frontend request will trigger regeneration.

Usage
─────
# in project root directory:
docker compose exec backend python /app/utils/reset_summaries.py

"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# ─── locate backend package no matter where script is run ───────────
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from app.config import settings  # type: ignore
from app.models import Meeting  # type: ignore
from sqlmodel import Session, create_engine, select



# ─── CLI parsing ────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Reset all stored summaries.")
parser.add_argument(
    "--dry",
    action="store_true",
    help="Print meetings that would be cleared without writing to the DB.",
)
parser.add_argument("--debug", action="store_true", help="Enable DEBUG-level logging")
args = parser.parse_args()

logging.basicConfig(
    level=logging.DEBUG if args.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("reset_summaries")

# ─── main logic ─────────────────────────────────────────────────────
from pathlib import Path

# ─── Resolve DB path & create engine ─────────────────────────────────
db_path = Path(settings.db_path).expanduser()
if not db_path.is_absolute():
    db_path = (ROOT_DIR / db_path).resolve()

print(f"\n[reset] Using database file: {db_path}")           # <── NEW
if not db_path.exists():
    sys.exit(f"[reset] ERROR: file does not exist → {db_path}")

# use forward slashes for SQLite URL on Windows
db_url = f"sqlite:///{db_path.as_posix()}"
print(f"[reset] SQLAlchemy URL : {db_url}")                   # <── NEW

engine = create_engine(db_url, echo=False)


log.debug("DB engine created with path: %s", settings.db_path)

with Session(engine) as db:
    meetings = db.exec(select(Meeting)).all()
    log.info("Fetched %d meetings", len(meetings))

    for m in meetings:
        log.debug(
            "Resetting Meeting %s – done=%s, summary len=%s",
            m.id,
            m.done,
            len(m.summary_markdown or ""),
        )
        m.done = False
        m.summary_markdown = None
        m.final_received = True
        m.summary_task_queued = False 
        if not args.dry:
            db.add(m)

    if args.dry:
        log.info("Dry-run complete. No changes committed.")
    else:
        db.commit()
        log.info("Committed changes. %d meetings reset.", len(meetings))

print(f"Reset {len(meetings)} meetings – next access will trigger re-summary.")
