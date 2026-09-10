"""
utils/drop_local_summary_table.py
────────────────────────────────────────────────────────
Drops `localsummaryrun`.

The table existed to answer one question — is a browser-sized model good
enough to write a meeting summary? — by storing every on-device run next to
the Claude one, with the user's verdict between them. The answer came back
yes, and Local mode now writes the on-device summary onto the meeting itself
rather than beside it, so there is no second version to compare against and
nothing left to record.

Deployments that ran the experiment still carry the table and its rows. The
rows are dropped with it: they were an eval set for a decision that has been
made.
"""

import logging
import sys
from pathlib import Path

# --- Locate backend package ---
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from migration_helper import ensure_database_exists
from sqlalchemy import text

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("migration")

TABLE = "localsummaryrun"


def run_migration():
    db_path, engine = ensure_database_exists()

    with engine.connect() as connection:
        with connection.begin():
            try:
                exists = connection.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
                    {"t": TABLE},
                ).fetchone()
                if not exists:
                    log.info("Table '%s' is not present; nothing to drop.", TABLE)
                    return True

                count = connection.execute(text(f"SELECT COUNT(*) FROM {TABLE}")).scalar() or 0
                connection.execute(text(f"DROP TABLE {TABLE}"))
                log.info("Dropped '%s' (%d row(s)) from %s.", TABLE, count, db_path)
            except Exception:
                log.exception("Could not drop '%s'.", TABLE)
                return False
    return True


if __name__ == "__main__":
    sys.exit(0 if run_migration() else 1)
