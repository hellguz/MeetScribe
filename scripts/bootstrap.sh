#!/usr/bin/env bash
set -euo pipefail

[ -f .env ] || { echo "Copy .env.example → .env first"; exit 1; }

echo "Downloading whisper-tiny model…"
mkdir -p models
if [ ! -f models/ggml-whisper-tiny.en.bin ]; then
  curl -L -o models/ggml-whisper-tiny.en.bin \
       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin
fi

docker compose build
docker compose up -d
echo "🚀  Stack is up"


