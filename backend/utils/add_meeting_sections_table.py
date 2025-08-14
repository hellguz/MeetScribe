"""
utils/add_meeting_sections_table.py
────────────────────────────────────────────────────────
Creates the `meeting_sections` table to store custom section
configurations for each meeting. This allows users to add,
remove, reorder, and customize sections within summaries.
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


def run_migration():
    db_path = Path(settings.db_path).resolve()
    if not db_path.exists():
        log.error("Database file not found.")
        sys.exit(1)

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")

    with engine.connect() as connection:
        inspector = inspect(engine)
        
        # Check if the meeting_sections table already exists
        if 'meeting_sections' in inspector.get_table_names():
            log.info("meeting_sections table already exists. No migration needed.")
            return
            
        with connection.begin():  # Start a transaction
            try:
                log.info("Creating `meeting_sections` table...")
                connection.execute(text("""
                    CREATE TABLE meeting_sections (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        meeting_id TEXT NOT NULL,
                        section_type VARCHAR(50) NOT NULL,  -- 'default' for AI-generated, 'custom' for user-added
                        section_key VARCHAR(100) NOT NULL,  -- 'summary', 'timeline', 'feedback', etc.
                        title VARCHAR(255) NOT NULL,
                        content TEXT,  -- Markdown content, NULL for user-added sections pending generation
                        position INTEGER NOT NULL DEFAULT 0,  -- Order position
                        is_enabled BOOLEAN NOT NULL DEFAULT 1,  -- Can be hidden/shown
                        template_type VARCHAR(50),  -- 'timeline', 'metrics', 'feedback', 'bullet_points', 'custom'
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (meeting_id) REFERENCES meeting(id) ON DELETE CASCADE
                    )
                """))
                
                # Create index for faster queries
                connection.execute(text("""
                    CREATE INDEX idx_meeting_sections_meeting_id ON meeting_sections(meeting_id)
                """))
                
                connection.execute(text("""
                    CREATE INDEX idx_meeting_sections_position ON meeting_sections(meeting_id, position)
                """))
                
                log.info("Migration successful.")
            except Exception as e:
                log.error("An error occurred during migration: %s", e, exc_info=True)
                raise


if __name__ == "__main__":
    run_migration()