# 🎙️ MeetScribe

**Your AI-powered assistant for perfect meeting notes. Record, transcribe, and get smart summaries in multiple languages.**

Ever been in back-to-back meetings, frantically trying to type notes while also paying attention? MeetScribe is a simple web app designed to solve that problem. Just hit record, focus on the conversation, and let the AI handle the note-taking. When your meeting is done, you'll have a clean, formatted summary and a full transcript ready to go. This is a pet project by Egor Gavrilov, built to be simple, effective, and easily self-hostable.

-----

## ✨ Key Features

  * **📝 Automated Meeting Summaries:** Get neatly formatted summaries tailored to your needs. Choose from various lengths — from a punchy **Essence** (key decisions only) to a comprehensive two-page document.
  * **🌐 Multi-Lingual Summaries:** Generate summaries in over 25 languages, including English, Spanish, Japanese, and more. The system can auto-detect the transcript language or you can specify a target language.
  * **🤖 Powerful & Flexible AI Core:**
      * **Local or Cloud Transcription:** Uses the high-quality `whisper-large-v3` model for speech-to-text. You can configure it to run on your own hardware for maximum privacy or use a faster cloud API (Groq) for transcription.
      * **Intelligent Summarization:** Leverages Claude (Anthropic) for intelligent, context-aware summaries with a sophisticated prompting strategy that ensures high-quality, structured output.
  * **📊 Comprehensive Admin Dashboard:** A dashboard page gives a full overview of platform usage, device statistics, user feedback trends, and interesting facts like the "busiest hour" and "most active day".
  * **🎤 Live Transcription:** See the text appear in near real-time as you speak, so you know it's working.
  * **🔒 Private & Self-Hostable:** Your recordings and transcripts are processed on your own server, not a third-party service. Run it on your own machine or cloud server.
  * **⚡ Offline-Ready History:** Your past meeting summaries are cached in your browser, so you can access them instantly without hitting the server again.

## 🛠️ How It Works

MeetScribe is a modern web application with a decoupled frontend and backend. The entire process is coordinated between the user's browser, a web server, background threads, and a SQLite database.

### System Architecture

```
          ┌───────────────────────────────────┐
          │         Browser (React)           │
          └─────────────────┬─────────────────┘
(Polls) │                   │ 1. Start Meeting & Upload Chunks
┌───────┘                   │
│ 5. Get Status/            │
│    Final Summary          v
│ <────────────────────── ┌───────────────────────────────────┐
│                         │        FastAPI Web Server         │
│                         │  - Manages DB state (SQLite)      │
│                         │  - Submits tasks to thread pool   │
│                         │  - Runs scheduled jobs (APSched)  │
│                         └─────────────────┬─────────────────┘
│                                           │ 2. executor.submit()
│                                           v
│                         ┌───────────────────────────────────┐
│                         │      ThreadPoolExecutor           │
│                         │  - 3. Transcribe audio chunks     │
│                         │  - 4. Call Anthropic for summary  │
│                         │  - 4. Update meeting in SQLite    │
│                         └───────────────────────────────────┘
│                                           │
│                                           │ Reads & Writes State
└───────────────────────────────────────────┼───────────────────
                                            v
                           ┌───────────────────────────────────┐
                           │         SQLite Database           │
                           │      (Single Source of Truth)     │
                           └───────────────────────────────────┘
```

### Application Lifecycle

1.  **Recording & Uploading:**

      * When you hit "Start Recording," the **React** frontend creates a new meeting entry in the **SQLite** database via the **FastAPI** backend.
      * The browser captures audio and slices it into small WebM chunks. Each chunk is sent to the backend, which saves it to disk and submits a transcription job to an internal **thread pool**. The API call returns instantly.

2.  **Transcription & Live Preview:**

      * A background thread picks up the transcription job.
      * The thread processes the audio chunk with either a local `faster-whisper` model or a cloud-based API (Groq) to generate text.
      * The resulting text is written back to the **SQLite** database.
      * Meanwhile, the React frontend polls an endpoint every few seconds. The server assembles the transcribed chunks into a "live" transcript for you to see.

3.  **Finalization & Summarization:**

      * When you click "Stop & Summarize," the final audio chunk is uploaded.
      * After the background thread transcribes the last chunk, it assembles the full transcript from all chunks in SQLite.
      * The thread detects the language of the transcript. Based on your selection (Auto, English, or Custom), it sends the complete text to the **Anthropic API** (Claude) with a detailed prompt asking for a structured summary in the target language and desired length.
      * The final summary, a dynamically generated title, and the full transcript are saved to the `Meeting` record in SQLite, and the `done` flag is set. The next time the frontend polls, it receives the completed summary and navigates you to the results page.

## 🚀 Quick Start

### Local Development (no Docker)

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/hellguz/meetscribe.git
    cd meetscribe
    ```

2.  **Configure your environment:**

    ```bash
    cp .env.sample .env
    ```

    Open `.env` and fill in your `ANTHROPIC_API_KEY` (and optionally `GROQ_API_KEY`).

3.  **Install dependencies:**

    ```bash
    # Python
    pip install -r backend/requirements.txt

    # Node (frontend)
    cd frontend && npm install && cd ..
    ```

4.  **Run everything:**

    ```bash
    npm run dev
    ```

    This starts the backend on `:8000` and the frontend on `:5173` simultaneously.

      * Frontend: **`http://localhost:5173`**
      * Backend API docs: **`http://localhost:8000/docs`**

### Docker

1.  **Clone and configure:**

    ```bash
    git clone https://github.com/hellguz/meetscribe.git
    cd meetscribe
    cp .env.sample .env
    # Edit .env and add your ANTHROPIC_API_KEY
    ```

2.  **Build and run:**

    ```bash
    docker compose up --build
    ```

      * Frontend: **`http://localhost:4132`**
      * Backend API docs: **`http://localhost:4131/docs`**

## ⚙️ Configuration

All configuration lives in a single `.env` file in the project root.

| Variable | Description | Default |
| :--- | :--- | :--- |
| **`ANTHROPIC_API_KEY`** | **Required.** Your Anthropic API key for generating summaries (Claude). | — |
| `GROQ_API_KEY` | Your Groq API key for faster cloud-based transcription. | — |
| `RECOGNITION_IN_CLOUD` | `true` = use Groq for transcription, `false` = use local Whisper. | `false` |
| `WHISPER_MODEL_SIZE` | Local Whisper model size. Options: `tiny`, `base`, `small`, `medium`, `large-v3`. | `medium` |
| **`SECRET_KEY`** | **Required.** A random string for signing session data. Change this. | — |
| `VITE_API_BASE_URL` | Public URL of the backend API. Leave blank for local Docker (handled by nginx proxy). | (blank) |
| `FRONTEND_ORIGIN` | Frontend URL for backend CORS. | `http://localhost:4132` |
| `WORKER_THREADS` | Number of background threads for transcription/summarization. | `4` |
| `OPENBLAS_NUM_THREADS` | CPU threads for Whisper's underlying math libraries. | `6` |

## 🗺️ Roadmap

This is a living project. Here are some features being considered for the future:

  * \[ ] Speaker diarization (identifying who said what).
  * \[ ] OAuth / multi-user accounts.
  * \[ ] Export to Google Docs, Notion, or a Markdown file.
  * \[ ] Deeper analytics on the dashboard.
  * \[ ] Real-time translation capabilities.
  * \[ ] A mobile-friendly PWA (Progressive Web App).

## 🙌 Contributing

Contributions are welcome!

1.  Fork the repository & create a new feature branch.
2.  Follow the [Local Development](#-quick-start) guide to set up your environment.
3.  Make your changes.
4.  Open a pull request with a clear description of your changes.

## 📜 License

This project is licensed under the MIT License. Copyright © 2025 Egor Gavrilov.
