import logging
from sqlalchemy import text
from sqlmodel import create_engine

# Configure logger for the migration script
logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

def add_context_column(db_path: str):
    logger.info(f"Connecting to database at: {db_path}")
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.connect() as connection:
        try:
            # Check if column exists (SQLite specific)
            result = connection.execute(text("PRAGMA table_info(meeting);"))
            columns = [row[1] for row in result]

            if 'context' not in columns:
                logger.info("Column 'context' not found in 'meeting' table. Adding it...")
                connection.execute(text("ALTER TABLE meeting ADD COLUMN context TEXT;"))
                connection.commit()
                logger.info("Column 'context' added successfully.")
            else:
                logger.info("Column 'context' already exists in 'meeting' table. No action needed.")
        except Exception as e:
            logger.error(f"Error during migration: {e}", exc_info=True)
            raise

def main():
    # This import needs to be correct based on how config is typically accessed.
    # Assuming it might be within an 'app' directory that's in PYTHONPATH when run.
    try:
        from app.config import settings
        db_path = settings.db_path
        add_context_column(db_path)
        logger.info("Migration successful.")
    except ImportError:
        logger.error("Could not import settings. Ensure PYTHONPATH is set correctly or call with DB_PATH.")
        # Fallback or direct path for testing if needed, but ideally settings should work.
        # Example: add_context_column("data/db.sqlite3")
    except Exception as e:
        logger.error(f"Migration failed: {e}", exc_info=True)

if __name__ == "__main__":
    # This script would typically be called by a migration runner or Docker entrypoint.
    # For direct execution, ensure the environment (like PYTHONPATH) is set up
    # so that `from app.config import settings` works, or pass db_path directly.
    logger.info("Running add_meeting_context_column.py migration script...")
    main()
