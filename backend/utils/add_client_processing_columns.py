"""
utils/add_client_processing_columns.py
────────────────────────────────────────────────────────
Adds the columns the on-device (browser) processing mode needs:

  meeting.client_processing — transcription + diarization happen in the
                              browser; the server only stores audio and
                              summarizes the transcript it is handed
  meeting.client_stats      — JSON with the timings the browser measured
                              (model download, transcription speed, …)
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
    ("meeting", "client_processing", "BOOLEAN DEFAULT 0"),
    ("meeting", "client_stats", "TEXT"),
]


def run_migration():
    db_path, engine = ensure_database_exists()

    with engine.connect() as connection:
        with connection.begin():
            try:
                for table, column, coltype in COLUMNS:
                    result = connection.execute(text(f"PRAGMA table_info({table});"))
                    existing = [row[1] for row in result]
                    if not existing:
                        log.info("Table `%s` does not exist yet; skipping.", table)
                        continue
                    if column in existing:
                        log.info("`%s.%s` already exists.", table, column)
                        continue
                    log.info("Adding `%s` column to `%s` table...", column, table)
                    connection.execute(
                        text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype};")
                    )

                log.info("Migration successful.")
            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)


if __name__ == "__main__":
    run_migration()
