"""
utils/add_feedback_status_column.py
────────────────────────────────────────────────────────
Adds the `status` column to the `feedback` table.
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
        
        # Check if the feedback table exists
        if 'feedback' not in inspector.get_table_names():
            log.info("Feedback table does not exist. No migration needed.")
            return
            
        with connection.begin():  # Start a transaction
            try:
                result = connection.execute(text("PRAGMA table_info(feedback);"))
                columns = [row[1] for row in result]

                if "status" not in columns:
                    log.info("Adding `status` column to `feedback` table...")
                    connection.execute(
                        text("ALTER TABLE feedback ADD COLUMN status TEXT DEFAULT 'new' NOT NULL;")
                    )
                else:
                    log.info("`status` column already exists.")

                log.info("Migration successful.")
            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)


if __name__ == "__main__":
    run_migration()
