# 🎙️ MeetScribe

**Your AI-powered assistant for perfect meeting notes. Record, transcribe, and get smart summaries in multiple languages.**

Ever been in back-to-back meetings, frantically trying to type notes while also paying attention? MeetScribe is a simple web app designed to solve that problem. Just hit record, focus on the conversation, and let the AI handle the note-taking. When your meeting is done, you'll have a clean, formatted summary and a full transcript ready to go. This is a pet project by Egor Gavrilov, built to be simple, effective, and easily self-hostable.

-----

## ✨ Key Features

  * **📝 Automated Meeting Summaries:** Get neatly formatted summaries tailored to your needs. Choose from various lengths, from a quarter-page brief to a comprehensive two-page document.
  * **🌐 Multi-Lingual Summaries:** Generate summaries in over 25 languages, including English, Spanish, Japanese, and more. The system can auto-detect the transcript language or you can specify a target language.
  * **🤖 Powerful & Flexible AI Core:**
      * **Local or Cloud Transcription:** Uses the high-quality `whisper-large-v3` model for speech-to-text. You can configure it to run on your own hardware for maximum privacy or use a faster cloud API (Groq) for transcription.
      * **Intelligent Summarization:** Leverages `gpt-5-mini` for intelligent, context-aware summaries with a sophisticated prompting strategy that ensures high-quality, structured output.
  * **📊 Comprehensive Admin Dashboard:** A new dashboard page gives a full overview of platform usage, device statistics, user feedback trends, and interesting facts like the "busiest hour" and "most active day".
  * **🎤 Live Transcription:** See the text appear in near real-time as you speak, so you know it's working.
  * **🔒 Private & Self-Hostable:** Your recordings and transcripts are processed on your own server, not a third-party service. Run it on your own machine or cloud server with a single Docker command.
  * **⚡ Offline-Ready History:** Your past meeting summaries are cached in your browser, so you can access them instantly without hitting the server again.

## 🛠️ How It Works

MeetScribe is a modern web application with a decoupled frontend and backend. The entire process is a coordinated dance between the user's browser, a web server, a background worker, and a central database that acts as the single source of truth.

### System Architecture

```
          ┌───────────────────────────────────┐
          │         Browser (React)           │
          └─────────────────┬─────────────────┘
(Polls) │                   │ 1. Start Meeting & Upload Chunks
┌───────┘                   │
│ 7. Get Status/            │
│    Final Summary          v
│ <────────────────────── ┌───────────────────────────────────┐
│                         │        FastAPI Web Server         │
│                         │  - Manages DB state (SQLite)      │
│                         │  - Dispatches tasks to Redis      │
│                         └─────────────────┬─────────────────┘
│                                           │ 2. Dispatch Task
│                                           v
│                         ┌───────────────────────────────────┐
│                         │         Redis (Task Queue)        │
│                         └─────────────────┬─────────────────┘
│                                           │ 3. Worker Dequeues Task
│                                           v
│                         ┌───────────────────────────────────┐
│                         │           Celery Worker           │ ────────┐
│                         │  - 4. Transcribe audio chunks     │         │
│                         │  - 5. Call OpenAI for summary     │         │ 6. Finalize
│                         │  - 6. Update meeting in SQLite    │         │
│                         └─────────────────┬─────────────────┘         │
│                                           │                           │
│                                           │ Reads & Writes State      │
└───────────────────────────────────────────┼───────────────────────────┘
                                            │
                                            v
                           ┌───────────────────────────────────┐
                           │         SQLite Database           │
                           │      (Single Source of Truth)     │
                           └───────────────────────────────────┘
```

### Application Lifecycle

1.  **Recording & Uploading:**

      * When you hit "Start Recording," the **React** frontend makes a `POST` request to the **FastAPI** backend to create a new meeting entry in the **SQLite** database.
      * The browser captures audio and slices it into small WebM chunks. Each chunk is sent to the backend, which saves it and dispatches a transcription task to a **Redis** message queue. This ensures the API call returns instantly.

2.  **Transcription & Live Preview:**

      * A **Celery** worker, running in a separate container, picks up the transcription task from Redis.
      * The worker processes the audio chunk with either a local `faster-whisper` model or a cloud-based API (Groq) to generate text.
      * The resulting text is written back to the **SQLite** database.
      * Meanwhile, the React frontend polls an endpoint every few seconds. The server assembles the transcribed chunks into a "live" transcript for you to see.

3.  **Finalization & Summarization:**

      * When you click "Stop & Summarize," the final audio chunk is uploaded.
      * After the Celery worker transcribes this last chunk, it sees that the meeting is complete. It assembles the full transcript from all chunks in SQLite.
      * The worker detects the language of the transcript. Based on your selection (Auto, English, or Custom), it sends the complete text to the **OpenAI API** (`gpt-5-mini`) with a detailed prompt asking for a structured summary in the target language and desired length.
      * The final summary, a dynamically generated title, and the full transcript are saved to the `Meeting` record in SQLite, and the `done` flag is set. The next time the frontend polls, it receives the completed summary and navigates you to the results page.

## 🚀 Quick Start (Docker)

The easiest way to get MeetScribe running is with Docker.

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/hellguz/meetscribe.git
    cd meetscribe
    ```

2.  **Configure your environment:**
    Copy the sample environment file and add your OpenAI API key. You may also add a Groq API key if you wish to use cloud transcription.

    ```bash
    cp .env.sample .env
    ```

    Now, open the `.env` file and paste your `OPENAI_API_KEY`.

3.  **Build and run the containers:**
    This command will build the images and start all the services (frontend, backend, worker, database migrator, and redis).

    ```bash
    docker compose up --build
    ```

4.  **You're ready\!**

      * Open the frontend in your browser: **`http://localhost:4132`**
      * View the backend API docs (Swagger UI): **`http://localhost:4131/docs`**
      * View the new stats dashboard: **`http://localhost:4132/dashboard`**

## ⚙️ Configuration

MeetScribe is configured using environment variables in the `.env` file.

| Variable | Description | Default (`.env.sample`) |
| :--- | :--- | :--- |
| **`OPENAI_API_KEY`** | **Required.** Your API key from OpenAI for generating summaries. | `sk-...` |
| `GROQ_API_KEY` | **Optional.** Your API key from Groq for faster, cloud-based transcription. | `gsk_...` |
| `RECOGNITION_IN_CLOUD` | Set to `true` to use Groq for transcription, `false` to use the local Whisper model. | `false` |
| `WHISPER_MODEL_SIZE` | The local Whisper model to use. `large-v3` is recommended for accuracy. Options: `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`. | `large-v3` |
| **`SECRET_KEY`** | **Required.** A random string for signing session data. **Change this.** | `replace_this...` |
| `VITE_API_BASE_URL` | The public URL of your backend API. For local Docker, this is handled automatically. For production, set this to your API's domain (e.g., `https://api.yourdomain.com`). | (blank) |
| `FRONTEND_ORIGIN` | The URL of the frontend, needed for backend CORS. For local Docker, this is `http://localhost:4132`. | `http://localhost:4132` |
| `CELERY_BROKER_URL` | The connection URL for the Redis message broker. | `redis://redis:6379/0` |

## 🗺️ Roadmap

This is a living project. Here are some features being considered for the future:

  * \[ ] Speaker diarization (identifying who said what).
  * \[ ] OAuth / multi-user accounts.
  * \[ ] Export to Google Docs, Notion, or a Markdown file.
  * \[ ] Deeper analytics on the dashboard.
  * \[ ] Real-time translation capabilities.
  * \[ ] A mobile-friendly PWA (Progressive Web App).

## 🙌 Contributing

Contributions are welcome\!

1.  Fork the repository & create a new feature branch.
2.  Follow the [Local Development](https://www.google.com/search?q=%23-local-development-without-docker) guide to set up your environment.
3.  Make your changes.
4.  Open a pull request with a clear description of your changes.

## 📜 License

This project is licensed under the MIT License. Copyright © 2025 Egor Gavrilov.
