"""
Migration: Rebuild summary_markdown from sections for all meetings.

This is needed because users may have edited section content directly,
and those edits live in the meetingsection table, not in summary_markdown.

Run this before deploying the sections removal to ensure no data is lost.
"""
import sqlite3
from pathlib import Path


def main():
    db_path = Path(__file__).parent.parent / "data" / "db.sqlite3"
    if not db_path.exists():
        print(f"Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT DISTINCT meeting_id FROM meetingsection")
    meeting_ids = [row["meeting_id"] for row in cur.fetchall()]

    print(f"Found {len(meeting_ids)} meetings with sections to migrate")

    updated = 0
    for meeting_id in meeting_ids:
        cur.execute(
            """
            SELECT title, content FROM meetingsection
            WHERE meeting_id = ?
            ORDER BY position ASC
            """,
            (meeting_id,),
        )
        sections = cur.fetchall()

        if not sections:
            continue

        parts = []
        for section in sections:
            title = section["title"] or ""
            content = (section["content"] or "").strip()
            parts.append(f"### {title}\n\n{content}")

        rebuilt_markdown = "\n\n---\n\n".join(parts)

        cur.execute(
            "UPDATE meeting SET summary_markdown = ? WHERE id = ?",
            (rebuilt_markdown, meeting_id),
        )
        updated += 1

    conn.commit()
    conn.close()
    print(f"Migration complete: updated {updated} meetings")


if __name__ == "__main__":
    main()
