"""
utils/remove_feedback_uniqueness.py
────────────────────────────────────────────────────────
Removes the unique constraint on the `feedback` table for
(meeting_id, feedback_type) to allow multiple feature
suggestions per meeting.

This script performs a safe, data-preserving migration:
1. Renames the old 'feedback' table.
2. Creates a new 'feedback' table with the correct schema.
3. Copies all data from the old table to the new one.
4. Drops the old table.
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

INDEX_NAME = "ix_feedback_meeting_id_feedback_type"

def run_migration():
    db_path = Path(settings.db_path).resolve()
    if not db_path.exists():
        log.error("Database file not found. Skipping migration.")
        sys.exit(0) # Exit cleanly if no DB exists

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")

    with engine.connect() as connection:
        inspector = inspect(engine)
        
        # Check if the feedback table exists
        if 'feedback' not in inspector.get_table_names():
            log.info("Feedback table does not exist. No migration needed.")
            return
            
        indexes = inspector.get_indexes('feedback')
        
        # Check if the specific unique index exists
        if not any(idx['name'] == INDEX_NAME for idx in indexes):
            log.info(f"Unique index '{INDEX_NAME}' not found. No migration needed.")
            return

        log.info(f"Found unique index '{INDEX_NAME}'. Starting data-preserving migration to remove it.")
        
        with connection.begin():  # Start a transaction
            try:
                # 1. Rename the old table
                connection.execute(text("ALTER TABLE feedback RENAME TO feedback_old;"))
                log.info("Renamed 'feedback' to 'feedback_old'.")

                # 2. Create the new table using the new schema from the model
                from app.models import Feedback
                Feedback.metadata.create_all(connection, tables=[Feedback.__table__])
                log.info("Created new 'feedback' table with corrected schema.")

                # 3. Copy the data from the old table to the new one
                copy_sql = """
                INSERT INTO feedback (id, meeting_id, feedback_type, suggestion_text, created_at, status)
                SELECT id, meeting_id, feedback_type, suggestion_text, created_at, status
                FROM feedback_old;
                """
                connection.execute(text(copy_sql))
                log.info("Copied all data to the new 'feedback' table.")

                # 4. Drop the old table
                connection.execute(text("DROP TABLE feedback_old;"))
                log.info("Dropped the old 'feedback_old' table.")

                log.info("Migration successful: The unique constraint has been removed.")

            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)
                log.error("Migration failed. The transaction will be rolled back.")
                raise e

if __name__ == "__main__":
    run_migration()