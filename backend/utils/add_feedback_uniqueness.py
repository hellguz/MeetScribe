"""
utils/add_feedback_uniqueness.py
────────────────────────────────────────────────────────
Adds a unique constraint to the `feedback` table on the
combination of `meeting_id` and `feedback_type`.
This prevents duplicate feedback types for the same meeting.
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
        with connection.begin():  # Start a transaction
            try:
                # 1. Delete duplicate entries, keeping only the first one submitted.
                log.info("Cleaning up potential duplicate feedback entries...")
                delete_duplicates_sql = """
                DELETE FROM feedback
                WHERE id NOT IN (
                    SELECT MIN(id)
                    FROM feedback
                    GROUP BY meeting_id, feedback_type
                );
                """
                delete_result = connection.execute(text(delete_duplicates_sql))
                if delete_result.rowcount > 0:
                    log.info(f"Removed {delete_result.rowcount} duplicate feedback rows.")
                else:
                    log.info("No duplicate feedback rows found to remove.")

                # 2. Create the unique index using `IF NOT EXISTS` to prevent race conditions.
                index_name = "ix_feedback_meeting_id_feedback_type"
                log.info(f"Attempting to create unique index '{index_name}'...")
                connection.execute(
                    text(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON feedback (meeting_id, feedback_type);")
                )
                log.info("Migration successful: Unique index is present.")

            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)
                # The transaction will be rolled back automatically on error.
                raise e # Re-raise the exception to make the startup command fail if migration fails.


if __name__ == "__main__":
    run_migration()