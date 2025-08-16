#!/usr/bin/env python3
"""
Migration script to add enhanced context columns to meetingsection table.
"""

import logging
import sqlite3
import sys
from pathlib import Path

# Add the backend directory to the Python path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.config import settings

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("add_enhanced_section_columns")


def add_enhanced_section_columns():
    """Add the new columns to the meetingsection table."""
    db_path = Path(settings.db_path).resolve()
    
    if not db_path.exists():
        log.error(f"Database file not found at {db_path}")
        return False
    
    log.info(f"Connecting to database at: {db_path}")
    
    try:
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
            
            # Check if columns already exist
            cursor.execute("PRAGMA table_info(meetingsection)")
            columns = [row[1] for row in cursor.fetchall()]
            
            new_columns = [
                ('start_timestamp', 'INTEGER'),
                ('end_timestamp', 'INTEGER'), 
                ('speakers', 'TEXT'),
                ('extra_data', 'TEXT')
            ]
            
            for col_name, col_type in new_columns:
                if col_name not in columns:
                    log.info(f"Adding column `{col_name}` to meetingsection table...")
                    cursor.execute(f"ALTER TABLE meetingsection ADD COLUMN {col_name} {col_type}")
                    log.info(f"Column `{col_name}` added successfully.")
                else:
                    log.info(f"Column `{col_name}` already exists.")
            
            conn.commit()
            log.info("Enhanced section columns migration completed successfully.")
            return True
            
    except Exception as e:
        log.error(f"Migration failed: {e}")
        return False


if __name__ == "__main__":
    success = add_enhanced_section_columns()
    sys.exit(0 if success else 1)