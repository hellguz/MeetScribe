FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Copy and install Python dependencies for the worker
COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend application code so that "app" module is available
COPY backend/app /app/app

# Copy the worker entrypoint
COPY worker/worker.py /app/worker.py

# Set number of threads for faster-whisper (optional)
ENV OMP_NUM_THREADS=4

# Ensure the working directory is on PYTHONPATH
ENV PYTHONPATH=/app

# Run the RQ worker
CMD ["python", "worker.py"]