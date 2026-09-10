"""
utils/add_publish_columns.py
────────────────────────────────────────────────────────
Adds what sharing a browser-held meeting needs:

  meeting.origin      'recorded' (created here) or 'published' (a copy of a
                      meeting that lives in someone's browser)
  meeting.expires_at  when the shared copy is deleted; NULL means it stays
  meeting.owner_hash  sha256 of the token the creating browser holds

…and the `meetingtombstone` table, which is what stops a meeting that has been
made private from looking like a typo. Deleting used to remove the row
outright, leaving anyone holding the link with a bare 404; the tombstone keeps
the identity — id, title, when, and why — so they can be told what happened.

`owner_hash` is NULL for every existing meeting, and the ownership check treats
NULL as "open". Meetings made before this keep behaving exactly as they did;
only new ones are protected.
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

COLUMNS = [
    ("meeting", "origin", "VARCHAR DEFAULT 'recorded'"),
    ("meeting", "expires_at", "DATETIME"),
    ("meeting", "owner_hash", "VARCHAR"),
]

TOMBSTONE = """
CREATE TABLE IF NOT EXISTS meetingtombstone (
    id VARCHAR NOT NULL PRIMARY KEY,
    title VARCHAR NOT NULL,
    started_at DATETIME NOT NULL,
    removed_at DATETIME NOT NULL,
    reason VARCHAR NOT NULL DEFAULT 'deleted'
)
"""


def run_migration():
    db_path, engine = ensure_database_exists()

    with engine.connect() as connection:
        with connection.begin():
            try:
                existing = {
                    row[1]
                    for row in connection.execute(text("PRAGMA table_info(meeting)")).fetchall()
                }
                for table, column, coltype in COLUMNS:
                    if column in existing:
                        log.info("Column '%s.%s' already present; skipping.", table, column)
                        continue
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}"))
                    log.info("Added '%s.%s'.", table, column)

                connection.execute(text(TOMBSTONE))
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_meeting_expires_at "
                        "ON meeting (expires_at)"
                    )
                )
                log.info("Tombstone table and expiry index ready in %s.", db_path)
            except Exception:
                log.exception("Could not add the publishing columns.")
                return False
    return True


if __name__ == "__main__":
    sys.exit(0 if run_migration() else 1)
