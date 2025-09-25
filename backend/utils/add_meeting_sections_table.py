#!/usr/bin/env python3
"""
Database migration to add meeting_sections table for customizable summary sections.
This migration creates the table structure needed for the section feature.
"""

import sqlite3
import logging
import sys
from pathlib import Path

# --- Locate backend package ---
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from migration_helper import ensure_database_exists

# Setup logging
logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger("migration")

def run_migration():
    """Add meeting_sections table if it doesn't exist."""
    db_path, engine = ensure_database_exists()

    try:
        # Import models to ensure they're registered with SQLModel
        from app.models import Meeting, MeetingChunk, Feedback, MeetingSection
        from sqlmodel import SQLModel

        # Create all tables using SQLModel
        logger.info("Creating all database tables using SQLModel.metadata.create_all()...")
        SQLModel.metadata.create_all(engine)
        logger.info("Database tables created successfully.")

    except Exception as e:
        logger.error(f"Error during migration: {e}")
        raise

if __name__ == "__main__":
    run_migration()