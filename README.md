# 🎙️ MeetScribe

**Your AI-powered assistant for perfect meeting notes. Record, transcribe, and get smart summaries in seconds.**

Ever been in back-to-back meetings, frantically trying to type notes while also paying attention? MeetScribe is a simple web app designed to solve that problem. Just hit record, focus on the conversation, and let the AI handle the note-taking. When your meeting is done, you'll have a clean, formatted summary and a full transcript ready to go.

This is a pet project by [Egor Gavrilov](https://github.com/your-github-username), built to be simple, effective, and easily self-hostable.

---

## ✨ Key Features

*   **📝 Automatic Meeting Minutes:** Get neatly formatted summaries tailored to your meeting type. Choose from templates like Brainstorming, Project Updates, Consultations, and more.
*   **🤖 Powerful AI Core:** Uses the high-quality [Whisper](https://openai.com/research/whisper) model for accurate speech-to-text and `GPT-4o-mini` for intelligent, context-aware summaries.
*   **🌐 Works in Your Browser:** No installation is needed for users. Just open the web page and start recording.
*   **🎤 Live Transcription:** See the text appear in near real-time as you speak, so you know it's working.
*   **🔒 Private & Self-Hostable:** Your recordings and transcripts are processed on your own server, not a third-party service. Run it on your own machine or cloud server with a single Docker command.
*   **⚡ Offline-Ready History:** Your past meeting summaries are cached in your browser, so you can access them instantly without hitting the server again.

## 🛠️ How It Works (The Tech Stuff)

MeetScribe is a modern web application with a decoupled frontend and backend. The magic happens through a sequence of synchronous and asynchronous operations, ensuring the app stays responsive while handling heavy processing. Here’s a look under the hood:

```
                 ┌───────────────────────────────────┐
                 │          Browser (React)          │
                 └───────────────────────────────────┘
                                  │
          1. Creates Meeting & Uploads Audio Chunks (via POST)
                                  │
                                  ▼
                 ┌───────────────────────────────────┐
                 │         FastAPI Web Server        │
                 │   - Saves audio file to disk      │
                 │   - Creates/updates DB record     │
                 └─────────────────┬─────────────────┘
                                   │
                2. Dispatches task to background worker
                                   │
                                   ▼
                 ┌───────────────────────────────────┐
                 │        Redis (Message Queue)      │
                 └─────────────────┬─────────────────┘
                                   │
                        3. Worker dequeues task
                                   │
                                   ▼
                 ┌───────────────────────────────────┐
                 │           Celery Worker           │
                 │ ─► 4a. Transcribe w/ Whisper      │
                 │ ─► 4b. Update SQLite DB w/ text   │
                 │ ─► 4c. If final: Summarize w/ GPT │
                 │ ─► 4d. Update SQLite DB w/ summary│
                 └───────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │ Meanwhile... The Browser polls the FastAPI server, which reads   │
  │ directly from the SQLite DB to provide live transcript updates   │
  │ and, eventually, the final summary.                              │
  └──────────────────────────────────────────────────────────────────┘
```

*   **Frontend:** A lightweight Single-Page Application (SPA) built with **React** and **Vite**. It uses the `MediaRecorder` API to capture audio, which it sends to the backend in 20-second chunks.
*   **Backend:** A fast REST API built with **FastAPI** (Python). Its main job is to handle file uploads, manage meeting state in the database, and dispatch tasks to the background worker. It does **not** perform the heavy lifting itself.
*   **Async Processing:** Heavy tasks like transcription and summarization are handled in the background by **Celery** workers, using **Redis** as a message broker. This keeps the API responsive.
*   **Central State:** The **SQLite Database** acts as the single source of truth. Both the FastAPI server (for status checks) and the Celery worker (for updates) read from and write to it.
*   **AI Models:** The Celery worker uses `faster-whisper` for local transcription and then calls the **OpenAI API** (`gpt-4o-mini`) for summarization once the full transcript is ready.
*   **Deployment:** The entire stack is containerized with **Docker** and orchestrated with **Docker Compose**, making setup a breeze.

## 🚀 Quick Start (Docker)

The easiest way to get MeetScribe running is with Docker.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-github-username/meetscribe.git
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
| `WHISPER_MODEL_SIZE` | The Whisper model to use. Options: `tiny`, `base`, `small`, `medium`, `large`. Larger models are more accurate but require more resources. | `medium`                     |
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