"""
utils/add_meeting_metadata_columns.py
────────────────────────────────────────────────────────
Adds the `word_count`, `duration_seconds`, and `user_agent`
columns to the `meeting` table without deleting any data.
"""
import logging
import sys
from pathlib import Path

# --- Locate backend package ---
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from app.config import settings
from sqlalchemy import create_engine, text

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("migration")

def run_migration():
    db_path = Path(settings.db_path).resolve()
    if not db_path.exists():
        log.error("Database file not found.")
        sys.exit(1)

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")

    with engine.connect() as connection:
        with connection.begin(): # Start a transaction
            try:
                result = connection.execute(text("PRAGMA table_info(meeting);"))
                columns = [row[1] for row in result]
                
                if "word_count" not in columns:
                    log.info("Adding `word_count` column to `meeting` table...")
                    connection.execute(text("ALTER TABLE meeting ADD COLUMN word_count INTEGER;"))
                else:
                    log.info("`word_count` column already exists.")

                if "duration_seconds" not in columns:
                    log.info("Adding `duration_seconds` column to `meeting` table...")
                    connection.execute(text("ALTER TABLE meeting ADD COLUMN duration_seconds INTEGER;"))
                else:
                    log.info("`duration_seconds` column already exists.")
                    
                if "user_agent" not in columns:
                    log.info("Adding `user_agent` column to `meeting` table...")
                    connection.execute(text("ALTER TABLE meeting ADD COLUMN user_agent TEXT;"))
                else:
                    log.info("`user_agent` column already exists.")

                log.info("Migration successful.")
            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)


if __name__ == "__main__":
    run_migration()
