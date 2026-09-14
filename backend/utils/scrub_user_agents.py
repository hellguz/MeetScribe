"""
utils/scrub_user_agents.py
────────────────────────────────────────────────────────
Replaces every stored User-Agent string with its OS family.

The dashboard only ever counted devices by family, yet the column kept the
whole string — browser build, OS version, device model — for every meeting.
New rows are reduced on the way in (see `_os_family` in app/main.py); this
brings the existing ones down to the same level. Idempotent.
"""

import logging
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from app.config import settings
from sqlalchemy import create_engine, text

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("migration")

FAMILIES = {"iPhone", "Android", "Windows", "Mac", "Linux", "Other"}


def os_family(user_agent: str) -> str:
    ua = user_agent.lower()
    if "iphone" in ua or "ipad" in ua:
        return "iPhone"
    if "android" in ua:
        return "Android"
    if "windows" in ua:
        return "Windows"
    if "macintosh" in ua or ua == "mac":
        return "Mac"
    if "linux" in ua:
        return "Linux"
    return "Other"


def run_migration():
    db_path = Path(settings.db_path).resolve()
    if not db_path.exists():
        log.error("Database file not found.")
        sys.exit(1)

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    with engine.connect() as connection:
        with connection.begin():
            rows = connection.execute(
                text("SELECT id, user_agent FROM meeting WHERE user_agent IS NOT NULL")
            ).all()
            changed = 0
            for mid, ua in rows:
                if ua in FAMILIES:
                    continue
                connection.execute(
                    text("UPDATE meeting SET user_agent = :fam WHERE id = :id"),
                    {"fam": os_family(ua), "id": mid},
                )
                changed += 1
            log.info("User agents reduced to OS family: %d row(s) changed.", changed)


if __name__ == "__main__":
    run_migration()
