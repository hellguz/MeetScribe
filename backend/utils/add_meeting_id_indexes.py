"""
utils/add_meeting_id_indexes.py
────────────────────────────────────────────────────────
Indexes the `meeting_id` foreign keys.

Without these, every per-meeting query is a full table scan. `meetingchunk`
had no index at all, and loading one meeting runs several such queries (live
transcript assembly, transcribed-chunk count, audio availability), so opening
a meeting got slower as the table grew — 23k chunk rows scanned repeatedly.

Idempotent: CREATE INDEX IF NOT EXISTS.
"""

import logging
import sys
from pathlib import Path

# --- Locate backend package ---
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from migration_helper import ensure_database_exists
from sqlalchemy import text

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("migration")

INDEXES = [
    ("ix_meetingchunk_meeting_id", "meetingchunk", "meeting_id"),
    ("ix_feedback_meeting_id", "feedback", "meeting_id"),
    ("ix_meetingsection_meeting_id", "meetingsection", "meeting_id"),
]


def run_migration():
    db_path, engine = ensure_database_exists()

    with engine.connect() as connection:
        with connection.begin():
            try:
                for index_name, table, column in INDEXES:
                    exists = connection.execute(
                        text(
                            "SELECT name FROM sqlite_master "
                            "WHERE type='table' AND name=:table"
                        ),
                        {"table": table},
                    ).first()
                    if not exists:
                        log.info("Table `%s` does not exist yet; skipping.", table)
                        continue

                    columns = [
                        row[1]
                        for row in connection.execute(text(f"PRAGMA table_info({table});"))
                    ]
                    if column not in columns:
                        log.info("`%s.%s` does not exist; skipping.", table, column)
                        continue

                    log.info("Ensuring index %s on %s(%s)…", index_name, table, column)
                    connection.execute(
                        text(
                            f"CREATE INDEX IF NOT EXISTS {index_name} "
                            f"ON {table} ({column});"
                        )
                    )

                log.info("Migration successful.")
            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)


if __name__ == "__main__":
    run_migration()
