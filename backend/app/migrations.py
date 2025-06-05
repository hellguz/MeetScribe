# backend/app/migrations.py

from sqlalchemy import inspect, text

def migrate(engine) -> None:
    """
    Run one-off SQL fixes so the DB matches today’s models.
    """
    with engine.begin() as conn:
        inspector = inspect(conn)

        # ── Add `final_received` BOOLEAN ─────────────────────────────────────────
        if "meeting" in inspector.get_table_names():
            cols = {c["name"] for c in inspector.get_columns("meeting")}
            if "final_received" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE meeting "
                        "ADD COLUMN final_received BOOLEAN NOT NULL DEFAULT 0"
                    )
                )

        # ── Add `last_activity` TEXT (allow NULL first) ──────────────────────────
        if "meeting" in inspector.get_table_names():
            cols = {c["name"] for c in inspector.get_columns("meeting")}
            if "last_activity" not in cols:
                # 1) Add it as nullable TEXT (no default expression)
                conn.execute(
                    text(
                        "ALTER TABLE meeting "
                        "ADD COLUMN last_activity TEXT"
                    )
                )
                # 2) Populate existing rows with current UTC timestamp
                conn.execute(
                    text(
                        "UPDATE meeting "
                        "SET last_activity = strftime('%Y-%m-%dT%H:%M:%fZ','now') "
                        "WHERE last_activity IS NULL"
                    )
                )
                # (We do not mark it NOT NULL here, because ALTER TABLE cannot change nullability easily in SQLite.
                #   SQLModel’s default_factory will provide a value for new rows, so this column will be non‐null going forward.)
