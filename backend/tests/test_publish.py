"""
The publish/share flow, exercised against the real app on a throwaway DB.

Two things are being proved, both of which were broken:

  1. A recipient who saves a shared meeting under a *new* id can share it on.
     Under the original's id they could not: the owner check compares their
     token against the hash minted by whoever shared it first, and returned
     403 "This meeting belongs to another browser."

  2. Re-publishing replaces the content, so editing a meeting you have shared
     updates what the link shows. It used to write only the expiry and the
     title, leaving the link on the version it was shared at.
"""
import os
import sys
import tempfile
import uuid

TMP = tempfile.mkdtemp(prefix="meetscribe-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{TMP}/test.db"
os.environ["DATA_DIR"] = TMP
os.environ["AUDIO_DIR"] = f"{TMP}/audio"
os.environ["ANTHROPIC_API_KEY"] = "test-not-used"
os.environ["MODELS_DIR"] = f"{TMP}/models"

sys.path.insert(0, os.path.abspath("."))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)

results = []


def check(name, fn):
    try:
        fn()
        results.append(f"PASS  {name}")
    except AssertionError as e:
        results.append(f"FAIL  {name}: {e}")
    except Exception as e:  # noqa: BLE001
        results.append(f"FAIL  {name}: {type(e).__name__}: {e}")


def payload(**over):
    body = {
        "owner_token": "alice-token",
        "expires_in_seconds": 3600,
        "title": "Recording 10.9.2026, 14:59:33",
        "started_at": "2026-09-10T12:59:33",
        "transcript": "Speaker 1: the original transcript.",
        "summary_markdown": "## Overview\n\nThe original summary.",
        "context": None,
        "summary_length": "narrative",
        "summary_language_mode": "auto",
        "summary_custom_language": None,
        "timezone": "Europe/Berlin",
        "duration_seconds": 2520,
        "word_count": 6,
        "speaker_count": 1,
    }
    body.update(over)
    return body


ALICE = uuid.uuid4()
BOB_COPY = uuid.uuid4()


def alice_publishes():
    r = client.post(f"/api/meetings/{ALICE}/publish", json=payload(), headers={"X-Owner-Token": "alice-token"})
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    assert r.json()["published"] is True


check("Alice can share her local meeting", alice_publishes)


def anyone_can_read():
    r = client.get(f"/api/meetings/{ALICE}")
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    assert "the original transcript" in r.json()["transcript_text"]


check("anyone with the link can read it", anyone_can_read)


def bob_cannot_take_over_the_id():
    """The old bug, kept as a test: the id belongs to whoever shared it."""
    r = client.post(
        f"/api/meetings/{ALICE}/publish",
        json=payload(owner_token="bob-token", title="Bob's edit"),
        headers={"X-Owner-Token": "bob-token"},
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
    # And Alice's content is untouched by the attempt.
    body = client.get(f"/api/meetings/{ALICE}").json()
    assert body["title"].startswith("Recording "), f"title was overwritten: {body['title']}"


check("a recipient cannot share under the original's id (403)", bob_cannot_take_over_the_id)


def bob_shares_his_own_copy():
    """What `saveSharedCopy` now does: same text, new id, his token."""
    r = client.post(
        f"/api/meetings/{BOB_COPY}/publish",
        json=payload(
            owner_token="bob-token",
            title="Bob's own copy",
            transcript="Speaker 1: the original transcript.",
            expires_in_seconds=None,
        ),
        headers={"X-Owner-Token": "bob-token"},
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    assert r.json()["expires_at"] is None, "no expiry was asked for"
    body = client.get(f"/api/meetings/{BOB_COPY}").json()
    assert body["title"] == "Bob's own copy"


check("a saved copy under a new id can be shared on", bob_shares_his_own_copy)


def the_two_are_independent():
    alice = client.get(f"/api/meetings/{ALICE}").json()
    bob = client.get(f"/api/meetings/{BOB_COPY}").json()
    assert alice["id"] != bob["id"]
    assert alice["title"] != bob["title"], "editing one changed the other"


check("the two meetings are separate and do not sync", the_two_are_independent)


def alices_edit_reaches_the_link():
    """The second fix: a re-publish refreshes the content."""
    r = client.post(
        f"/api/meetings/{ALICE}/publish",
        json=payload(
            title="Goldbeck Pilot: Unit Mix and Revit Export",
            transcript="Speaker 1: the corrected transcript.",
            summary_markdown="## Overview\n\nThe corrected summary.",
            expires_in_seconds=3600,
        ),
        headers={"X-Owner-Token": "alice-token"},
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    body = client.get(f"/api/meetings/{ALICE}").json()
    assert body["title"] == "Goldbeck Pilot: Unit Mix and Revit Export", f"title stale: {body['title']}"
    assert "corrected transcript" in body["transcript_text"], f"transcript stale: {body['transcript_text']}"
    assert "corrected summary" in body["summary_markdown"], f"summary stale: {body['summary_markdown']}"


check("an owner's edit updates what the link shows", alices_edit_reaches_the_link)


def bobs_copy_is_untouched_by_alices_edit():
    body = client.get(f"/api/meetings/{BOB_COPY}").json()
    assert "the original transcript" in body["transcript_text"], "Alice's edit leaked into Bob's copy"
    assert body["title"] == "Bob's own copy"


check("...and does not reach a copy somebody already saved", bobs_copy_is_untouched_by_alices_edit)


def a_stranger_still_cannot_edit():
    r = client.post(
        f"/api/meetings/{ALICE}/publish",
        json=payload(owner_token="eve-token", transcript="Speaker 1: vandalism."),
        headers={"X-Owner-Token": "eve-token"},
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code}"
    body = client.get(f"/api/meetings/{ALICE}").json()
    assert "vandalism" not in body["transcript_text"]


check("content refresh is owner-only", a_stranger_still_cannot_edit)


def sync_reports_duration():
    r = client.post("/api/meetings/sync", json={"ids": [str(ALICE)]})
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    rows = r.json()
    assert len(rows) == 1, rows
    assert rows[0]["duration_seconds"] == 2520, f"duration missing from sync: {rows[0]}"


check("the history sync now carries the meeting's length", sync_reports_duration)


def unshare_then_share_again():
    r = client.delete(f"/api/meetings/{ALICE}/publish", headers={"X-Owner-Token": "alice-token"})
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    gone = client.get(f"/api/meetings/{ALICE}")
    assert gone.status_code == 410, f"expected 410 after unsharing, got {gone.status_code}"
    again = client.post(
        f"/api/meetings/{ALICE}/publish",
        json=payload(title="Back again"),
        headers={"X-Owner-Token": "alice-token"},
    )
    assert again.status_code == 200, f"{again.status_code} {again.text}"
    assert client.get(f"/api/meetings/{ALICE}").json()["title"] == "Back again"


check("stop sharing, then share again", unshare_then_share_again)

print("\n".join(results))
sys.exit(1 if any(r.startswith("FAIL") for r in results) else 0)
