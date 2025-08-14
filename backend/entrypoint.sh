#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

# Create data directory if it doesn't exist
mkdir -p /app/data

# Create the database file if it doesn't exist
touch /app/data/db.sqlite3

# Run all database migrations. These scripts are idempotent and safe to run
# on every application start, for both the web server and the worker.
echo "Running database migrations..."
python /app/utils/remove_feedback_uniqueness.py
python /app/utils/add_meeting_metadata_columns.py
python /app/utils/add_suggestion_column.py
python /app/utils/add_summary_length_column.py
python /app/utils/add_feedback_status_column.py
python /app/utils/add_summary_language_columns.py
python /app/utils/add_context_column.py
python /app/utils/add_timezone_column.py
echo "Database migrations complete."

# Execute the command passed to this script (e.g., uvicorn for the backend,
# or celery for the worker).
exec "$@"