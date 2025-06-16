"""
utils/add_suggestion_column.py
────────────────────────────────────────────────────────
Adds the `suggestion_text` column to the `feedback` table
in the production database without deleting any data.

This is a one-time migration script to update the schema
for an existing database.

Usage
─────
# From the project root directory:
docker compose exec backend python /app/utils/add_suggestion_column.py
"""
import logging
import sys
from pathlib import Path

# --- Locate backend package ---
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from app.config import settings  # type: ignore
from sqlalchemy import create_engine, text

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("migration")

def run_migration():
    """Connects to the DB and adds the new column if it doesn't exist."""
    db_path = Path(settings.db_path).resolve()
    log.info("Connecting to database at: %s", db_path)
    
    if not db_path.exists():
        log.error("Database file not found. Cannot run migration.")
        sys.exit(1)

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")

    with engine.connect() as connection:
        try:
            # 1. Check if the column already exists
            result = connection.execute(text("PRAGMA table_info(feedback);"))
            columns = [row[1] for row in result]
            
            if "suggestion_text" in columns:
                log.info("Column `suggestion_text` already exists in `feedback` table. No action needed.")
                return

            # 2. If it doesn't exist, add it
            log.info("Column `suggestion_text` not found. Adding it to the `feedback` table...")
            connection.execute(text("ALTER TABLE feedback ADD COLUMN suggestion_text TEXT;"))
            # The commit is implicit with `engine.connect()`'s transaction handling
            log.info("Successfully added `suggestion_text` column.")

        except Exception as e:
            log.error("An error occurred during migration: %s", e, exc_info=True)
            # If an error occurs, the transaction is automatically rolled back.

if __name__ == "__main__":
    run_migration()