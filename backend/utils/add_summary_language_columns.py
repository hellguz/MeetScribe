"""
utils/add_summary_language_columns.py
────────────────────────────────────────────────────────
Adds `summary_language_mode` and `summary_custom_language`
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
        with connection.begin():
            try:
                result = connection.execute(text("PRAGMA table_info(meeting);"))
                columns = [row[1] for row in result]

                if "summary_language_mode" not in columns:
                    log.info("Adding `summary_language_mode` column to `meeting` table...")
                    connection.execute(
                        text("ALTER TABLE meeting ADD COLUMN summary_language_mode TEXT DEFAULT 'auto' NOT NULL;")
                    )
                else:
                    log.info("`summary_language_mode` column already exists.")

                if "summary_custom_language" not in columns:
                    log.info("Adding `summary_custom_language` column to `meeting` table...")
                    connection.execute(
                        text("ALTER TABLE meeting ADD COLUMN summary_custom_language TEXT;")
                    )
                else:
                    log.info("`summary_custom_language` column already exists.")

                log.info("Migration successful.")
            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)
                raise e


if __name__ == "__main__":
    run_migration()
