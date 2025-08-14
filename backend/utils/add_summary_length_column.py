"""
utils/add_summary_length_column.py
────────────────────────────────────────────────────────
Adds the `summary_length` column to the `meeting` table
without deleting any data.
"""

import logging
import sys
from pathlib import Path

# --- Locate backend package ---
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from app.config import settings
from sqlalchemy import create_engine, text, inspect

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("migration")


def run_migration():
    db_path = Path(settings.db_path).resolve()
    if not db_path.exists():
        log.error("Database file not found.")
        sys.exit(1)

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")

    with engine.connect() as connection:
        inspector = inspect(engine)
        
        # Check if the meeting table exists
        if 'meeting' not in inspector.get_table_names():
            log.info("Meeting table does not exist. No migration needed.")
            return
            
        with connection.begin():  # Start a transaction
            try:
                result = connection.execute(text("PRAGMA table_info(meeting);"))
                columns = [row[1] for row in result]

                if "summary_length" not in columns:
                    log.info("Adding `summary_length` column to `meeting` table...")
                    connection.execute(
                        text(
                            "ALTER TABLE meeting ADD COLUMN summary_length TEXT DEFAULT 'medium';"
                        )
                    )
                else:
                    log.info("`summary_length` column already exists.")

                log.info("Migration successful.")
            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)


if __name__ == "__main__":
    run_migration()
