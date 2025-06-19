#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

# Run database migrations. These scripts are idempotent and safe to run on every start.
echo "Running database migrations..."
python /app/utils/add_meeting_metadata_columns.py
python /app/utils/add_suggestion_column.py
python /app/utils/add_summary_length_column.py
echo "Database migrations complete."

# Execute the command passed to this script (e.g., uvicorn for the backend, or celery for the worker)
exec "$@"