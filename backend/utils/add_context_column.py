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

from migration_helper import ensure_database_exists
from sqlalchemy import text

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("migration")


def run_migration():
    db_path, engine = ensure_database_exists()

    with engine.connect() as connection:
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
