"""
Very small, SQLite-only migration helper.

It’s intentionally minimal: just enough to tack on new columns when the
codebase evolves, without bringing in Alembic.
"""

from sqlalchemy import inspect, text


def migrate(engine) -> None:
    """
    Run one-off SQL fixes so the DB matches today’s models.

    Currently:
    • add `final_received` BOOLEAN to `meeting` if it’s missing.
    """
    with engine.begin() as conn:
        inspector = inspect(conn)

        # ── meeting.final_received ──────────────────────────────────────────
        if "meeting" in inspector.get_table_names():
            cols = {c["name"] for c in inspector.get_columns("meeting")}
            if "final_received" not in cols:
                conn.execute(
                    text("ALTER TABLE meeting "
                         "ADD COLUMN final_received BOOLEAN NOT NULL DEFAULT 0")
                )
