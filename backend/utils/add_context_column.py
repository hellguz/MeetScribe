"""
utils/add_context_column.py
────────────────────────────────────────────────────────
Adds the `context` column to the `meeting` table.
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

                if "context" not in columns:
                    log.info("Adding `context` column to `meeting` table...")
                    connection.execute(
                        text("ALTER TABLE meeting ADD COLUMN context TEXT;")
                    )
                else:
                    log.info("`context` column already exists.")

                log.info("Migration successful.")
            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)


if __name__ == "__main__":
    run_migration()


