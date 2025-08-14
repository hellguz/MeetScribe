"""
utils/migration_helper.py
────────────────────────────────────────────────────────
Helper functions for database migrations.
"""

import logging
import sys
from pathlib import Path

# --- Locate backend package ---
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from app.config import settings
from sqlalchemy import create_engine

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("migration_helper")


def ensure_database_exists():
    """
    Ensures the database file exists. If not, creates it and initializes basic tables.
    Returns the path to the database and a SQLAlchemy engine.
    """
    db_path = Path(settings.db_path).resolve()
    
    # Ensure data directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    created_new_db = False
    if not db_path.exists():
        log.info("Database file does not exist. Creating it...")
        try:
            # Create empty database file
            db_path.touch()
            created_new_db = True
            log.info(f"Created database file at {db_path}")
        except Exception as e:
            log.error(f"Failed to create database file: {e}")
            sys.exit(1)
    
    # Create engine
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    
    # If we created a new database, initialize it with SQLModel tables
    if created_new_db:
        try:
            # Import all models to ensure they're registered with SQLModel
            from app.models import Meeting, MeetingChunk, Feedback, MeetingSection
            from sqlmodel import SQLModel
            
            log.info("Initializing database tables with SQLModel...")
            SQLModel.metadata.create_all(engine)
            log.info("Database tables created successfully.")
        except Exception as e:
            log.error(f"Failed to initialize database tables: {e}")
            # Don't exit here - let the migration continue
    
    return db_path, engine