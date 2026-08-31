"""
utils/add_diarization_columns.py
────────────────────────────────────────────────────────
Adds the columns speaker diarization needs:

  meeting.processing_stage   — which post-meeting stage is running
  meeting.speaker_count      — distinct speakers found
  meetingchunk.segments_json — whisper segment timings for the chunk
  meetingchunk.audio_seconds — true decoded chunk length
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
    ("meeting", "processing_stage", "TEXT"),
    ("meeting", "speaker_count", "INTEGER"),
    ("meetingchunk", "segments_json", "TEXT"),
    ("meetingchunk", "audio_seconds", "REAL"),
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
