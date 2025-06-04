# MeetScribe

Self-hosted microphone recorder → transcript → summary.

## Quick start (dev)

    # 1. create env file
    cp .env.example .env
    # 2. build containers, download Whisper model and start stack
    ./scripts/bootstrap.sh

Then open http://localhost.  Stop the stack with:

    docker compose down


