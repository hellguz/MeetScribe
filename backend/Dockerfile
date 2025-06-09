# backend/Dockerfile  ───────────────────────────────────────────────
FROM python:3.12-slim

# --- system dependencies ----------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# --- Python env -------------------------------------------------------------
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- project code -----------------------------------------------------------
COPY . /app

# ensure /app/data is a *directory* so host bind-mount works
RUN mkdir -p /app/data && rm -f /app/data/db.sqlite3

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
