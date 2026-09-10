# Tests

No runner and no framework: each file is a script that prints `PASS`/`FAIL`
per case and exits non-zero if any failed. Run one from the `backend`
directory, where `app` is importable:

```
cd backend && python tests/test_publish.py
```

Each script points `DATABASE_URL` and `DATA_DIR` at a fresh temporary
directory before importing the app, so running one never touches real data.

- `test_publish.py` — the share/save-a-copy flow, and the two bugs behind it:
  a recipient could not share a meeting on, and an owner's edits never reached
  the link they had already handed out.
