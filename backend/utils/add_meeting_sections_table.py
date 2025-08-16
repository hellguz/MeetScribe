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
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if table already exists
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='meetingsection'
        """)
        
        if cursor.fetchone():
            logger.info("meetingsection table already exists. Skipping migration.")
            return
        
        logger.info("meetingsection table does not exist. It will be created by SQLModel.metadata.create_all().")
        logger.info("This migration ensures the database exists for SQLModel initialization.")
        
    except sqlite3.Error as e:
        logger.error(f"Error during migration: {e}")
        raise
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    run_migration()