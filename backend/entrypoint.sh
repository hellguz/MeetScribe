#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

# Fetch local diarization models if absent. Idempotent, and non-fatal: without
# them the app simply produces transcripts without speaker labels.
python /app/utils/fetch_diarization_models.py

# Run all database migrations. These scripts are idempotent and safe to run
# on every application start, for both the web server and the worker.
python /app/utils/run_migrations.py

# Execute the command passed to this script (e.g., uvicorn for the backend,
# or celery for the worker).
exec "$@"