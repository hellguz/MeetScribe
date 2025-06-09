# 🎙️ MeetScribe

**Your AI-powered assistant for perfect meeting notes. Record, transcribe, and get smart summaries in seconds.**

Ever been in back-to-back meetings, frantically trying to type notes while also paying attention? MeetScribe is a simple web app designed to solve that problem. Just hit record, focus on the conversation, and let the AI handle the note-taking. When your meeting is done, you'll have a clean, formatted summary and a full transcript ready to go.

This is a pet project by [Egor Gavrilov](https://github.com/hellguz), built to be simple, effective, and easily self-hostable.

---

## ✨ Key Features

*   **📝 Automatic Meeting Minutes:** Get neatly formatted summaries tailored to your meeting type. Choose from templates like Brainstorming, Project Updates, Consultations, and more.
*   **🤖 Powerful AI Core:** Uses the high-quality [Whisper](https://openai.com/research/whisper) model (`large-v3`) for accurate speech-to-text and `gpt-4.1-mini` for intelligent, context-aware summaries.
*   **🌐 Works in Your Browser:** No installation is needed for users. Just open the web page and start recording.
*   **🎤 Live Transcription:** See the text appear in near real-time as you speak, so you know it's working.
*   **🔒 Private & Self-Hostable:** Your recordings and transcripts are processed on your own server, not a third-party service. Run it on your own machine or cloud server with a single Docker command.
*   **⚡ Offline-Ready History:** Your past meeting summaries are cached in your browser, so you can access them instantly without hitting the server again.

## 🛠️ How It Works (The Tech Stuff)

MeetScribe is a modern web application with a decoupled frontend and backend. The magic happens through a sequence of synchronous and asynchronous operations, ensuring the app stays responsive while handling heavy processing.

The entire process is a coordinated dance between the user's browser, a web server, a background worker, and a central database that acts as the single source of truth.

```
          ┌───────────────────────────────────┐
          │         Browser (React)           │
          └─────────────────┬─────────────────┘
  (Polls) │ ▲               │ 1. Start Meeting (POST /meetings)
 ┌────────┘ │               │ 2. Upload Audio Chunks (POST /chunks)
 │ 5. Get Status/           │
 │    Live Transcript       │
 │    (GET /meetings/{id})  │
 │ ◀────────┘               │
 │                          ▼
 │        ┌───────────────────────────────────┐
 │        │        FastAPI Web Server         │
 │        │  - Manages DB state (SQLite)      │
 │        │  - Saves audio to Filesystem      │
 │        └─────────────────┬─────────────────┘
 │                          │ 3. Dispatch Transcription Task
 │                          │
 │                          ▼
 │        ┌───────────────────────────────────┐
 │        │         Redis (Task Queue)        │
 │        └─────────────────┬─────────────────┘
 │                          │ 4. Worker Dequeues Task
 │                          │
 │                          ▼
 │        ┌───────────────────────────────────┐ ◀────────────┐
 │        │           Celery Worker           │              │
 │        │  - Reads audio from Filesystem    │              │
 │        │  - 6a. Transcribe w/ Whisper      │              │
 │        │  - 6b. Update chunk text in SQLite├─┐ 7. Finalize │
 │        │  - 7a. Assemble full transcript   │ │             │
 │        │  - 7b. Call OpenAI for summary    │ │             │
 │        │  - 7c. Update meeting in SQLite   │ │             │
 │        └─────────────────┬─────────────────┘ │             │
 │                          │                   │             │
 └──────────────────────────| Reads & Writes    │             │
                            │ State             │             │
                            ▼                   │             │
          ┌───────────────────────────────────┐ │             │
          │         SQLite Database           ├─┘             │
          │      (Single Source of Truth)     │               │
          └───────────────────────────────────┘ ◀─────────────┘
```

#### The Application Lifecycle

1.  **Recording & Uploading:**
    *   When you hit "Start Recording," the **React** frontend makes a `POST` request to the **FastAPI** backend to create a new meeting entry in the **SQLite** database.
    *   The browser's `MediaRecorder` API captures audio and slices it into small WebM chunks. Each chunk is sent to the backend via a `POST /api/chunks` request.
    *   The FastAPI server saves the audio chunk to the local filesystem and dispatches a transcription task to a **Redis** message queue. This ensures the API call returns instantly, keeping the app responsive.

2.  **The Live Transcription Loop:**
    *   A **Celery** worker, running in a separate container, picks up the transcription task from Redis.
    *   The worker loads the audio chunk from the filesystem and processes it with a local `faster-whisper` model to generate text.
    *   The resulting text is written back to the **SQLite** database, updating the specific `MeetingChunk` record.
    *   Meanwhile, the React frontend polls a `GET /api/meetings/{id}` endpoint every few seconds. The FastAPI server reads all the transcribed chunks from SQLite, assembles them into a "live" transcript (showing `[...]` for pending chunks), and sends it back to the browser for you to see.

3.  **Finalization & Summarization:**
    *   When you click "Stop & Summarize," the frontend uploads the final audio chunk with a special `is_final` marker.
    *   After the Celery worker transcribes this last chunk, it checks the database and sees that all expected chunks for the meeting are complete.
    *   The worker then assembles the full, clean transcript from all the chunks in SQLite.
    *   This complete text is sent to the **OpenAI API** (`gpt-4.1-mini`) with a detailed prompt, asking it to generate a structured summary based on a set of internal templates.
    *   The final summary and the full transcript are saved to the `Meeting` record in SQLite, and a `done` flag is set. The next time the frontend polls, it receives the completed summary and automatically navigates you to the results page.

This decoupled, asynchronous architecture allows MeetScribe to handle long recordings and heavy AI processing without freezing the user interface, providing a smooth and seamless experience.

## 🚀 Quick Start (Docker)

The easiest way to get MeetScribe running is with Docker.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/hellguz/meetscribe.git
    cd meetscribe
    ```

2.  **Configure your environment:**
    Copy the sample environment file and add your OpenAI API key.
    ```bash
    cp .env.sample .env
    ```
    Now, open the `.env` file and paste your `OPENAI_API_KEY`.

3.  **Build and run the containers:**
    This command will build the images and start all the services (frontend, backend, worker, and redis).
    ```bash
    docker compose up --build
    ```

4.  **You're ready!**
    *   Open the frontend in your browser: **[http://localhost:4132](http://localhost:4132)**
    *   View the backend API docs (Swagger UI): **[http://localhost:4131/docs](http://localhost:4131/docs)**

## 👨‍💻 Local Development (Without Docker)

If you prefer to run the services directly on your machine for development:

**Prerequisites:**
*   Python 3.11+
*   Node.js 18+ (with `pnpm`)
*   A running Redis server (e.g., `brew install redis` on macOS and run `redis-server`)

```bash
# 1. Start the Backend API
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.sample ../.env  # Make sure your .env is in the root directory
uvicorn app.main:app --reload --port 8000

# 2. Start the Celery Worker (in a new terminal)
cd backend
source .venv/bin/activate
celery -A app.worker.celery_app worker -l info -c 1

# 3. Start the Frontend (in a new terminal)
cd frontend
pnpm install
pnpm dev # Vite dev server starts on http://localhost:5173
```

## ⚙️ Configuration

MeetScribe is configured using environment variables in the `.env` file.

| Variable             | Description                                                                                                                              | Default (`.env.sample`)      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `OPENAI_API_KEY`     | **Required.** Your API key from OpenAI.                                                                                                  | `sk-...`                     |
| `WHISPER_MODEL_SIZE` | The Whisper model to use. Options: `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`. Larger models are more accurate but require more resources. | `large-v3`                   |
| `SECRET_KEY`         | A random string for signing session data. **Change this.**                                                                               | `replace_this...`            |
| `VITE_API_BASE_URL`  | For local Docker, leave this blank. For production, set it to your public API URL (e.g., `https://api.yourdomain.com`).                     | (blank)                      |
| `FRONTEND_ORIGIN`    | The URL of the frontend, needed for backend CORS. For local Docker, it's the exposed frontend port.                                        | `http://localhost:4132`      |
| `CELERY_BROKER_URL`  | The connection URL for the Redis message broker.                                                                                         | `redis://redis:6379/0`       |

## 🗺️ Roadmap

This is a living project. Here are some features I'm thinking about:

*   [ ] Speaker diarization (identifying who said what).
*   [ ] OAuth / multi-user accounts.
*   [ ] Export to Google Docs, Notion, or a Markdown file.
*   [ ] Real-time translation capabilities.
*   [ ] A mobile-friendly PWA (Progressive Web App).

## 🙌 Contributing

Contributions are welcome!

1.  Fork the repository & create a new feature branch.
2.  Follow the [Local Development](#-local-development-without-docker) guide to set up your environment.
3.  Make your changes.
4.  Open a pull request with a clear description of your changes.

## 📜 License

This project is licensed under the MIT License.

Copyright © 2025 [Egor Gavrilov](https://github.com/hellguz)
