# backend/Dockerfile  ───────────────────────────────────────────────
# Keep PYTHON_VERSION in sync with /.python-version, which local dev reads.
# `pnpm dev` cross-checks the two and fails loudly if they drift apart.
ARG PYTHON_VERSION=3.12
FROM python:${PYTHON_VERSION}-slim

# --- system dependencies ----------------------------------------------------
# Install dos2unix to fix line endings in scripts, which is a common issue
# when developing on Windows and deploying to Linux containers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg dos2unix \
    && rm -rf /var/lib/apt/lists/*

# --- entrypoint script ---
# Copy the entrypoint to the root directory to avoid being overwritten by the
# hot-reload volume mount, which targets /app.
COPY entrypoint.sh /entrypoint.sh
# Convert from DOS/Windows line endings (CRLF) to Unix (LF) and make executable.
RUN dos2unix /entrypoint.sh \
    && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# --- Python env -------------------------------------------------------------
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- project code -----------------------------------------------------------
# This copies the application code into the /app directory. The volume mount
# in docker-compose.yml will overlay the local code for development.
COPY . /app

# ensure /app/data is a *directory* so host bind-mount works
RUN mkdir -p /app/data && rm -f /app/data/db.sqlite3

ENV PYTHONUNBUFFERED=1

# Default command to run, which will be passed to the entrypoint.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]