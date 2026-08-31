"""
utils/run_migrations.py
────────────────────────────────────────────────────────
Runs every database migration, in order, as an idempotent batch.

This is the single source of truth for the migration list. It is used by both
the Docker entrypoint (production) and `pnpm dev` (local, no Docker), so the
two paths can never drift apart.

Each script is executed in its own interpreter — exactly as
`python utils/<name>.py` — so behaviour matches running them by hand.
"""

import subprocess
import sys
from pathlib import Path

UTILS_DIR = Path(__file__).resolve().parent

# Order matters: later migrations may assume earlier ones have run.
MIGRATIONS = [
    "remove_feedback_uniqueness.py",
    "add_meeting_metadata_columns.py",
    "add_suggestion_column.py",
    "add_summary_length_column.py",
    "add_feedback_status_column.py",
    "add_summary_language_columns.py",
    "add_context_column.py",
    "add_timezone_column.py",
    "add_meeting_sections_table.py",
    "add_enhanced_section_columns.py",
]


def main() -> int:
    # flush so this ordering survives the child processes writing directly.
    print("Running database migrations...", flush=True)
    for name in MIGRATIONS:
        script = UTILS_DIR / name
        if not script.exists():
            print(f"[ERROR] Migration not found: {script}", file=sys.stderr)
            return 1
        result = subprocess.run([sys.executable, str(script)])
        if result.returncode != 0:
            print(f"[ERROR] Migration failed: {name}", file=sys.stderr, flush=True)
            return result.returncode
    print("Database migrations complete.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
