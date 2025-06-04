# MeetScribe <!-- omit in toc -->

AI-powered meeting recorder & summariser
*Record, transcribe and keep neatly-formatted minutes in seconds – even when you’re offline.*

---

* [Live demo](#-live-demo)
* [Key features](#key-features)
* [System architecture](#system-architecture)
* [Quick-start (🚀 Docker)](#quick-start--docker)
* [Local development](#local-development)
* [Environment variables](#environment-variables)
* [API cheatsheet](#api-cheatsheet)
* [Roadmap](#roadmap)
* [Contributing](#contributing)
* [License](#license)

---

## 🎥 Live demo

Coming soon – keep an eye on the repo’s releases page.

## Key features

|                                  |                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **One-click recorder**           | Records microphone audio in the browser, slicing it into 20 s chunks for fast, real-time transcription.                                                            |
| **Whisper + GPT-4o**             | Uses the *base* Whisper model for speech-to-text and GPT-4o-mini for language-aware, template-driven minute taking.                                                |
| **Automatic language detection** | All headings and labels are translated into the language that dominates the meeting.                                                                               |
| **Smart templates**              | Six built-in meeting templates (general, consultation, project, presentation, brainstorming, retrospective) – unused or empty sections are stripped automatically. |
| **Offline history & cache**      | Summaries, transcripts and meeting metadata are saved to `localStorage` for up to **5 years** – pages load instantly on return visits.                             |
| **FastAPI backend**              | Simple REST API, SQLite storage, chunked uploads, on-the-fly summarisation once recording ends.                                                                    |
| **React + Vite frontend**        | Lightweight SPA with a clean, mobile-friendly UI.                                                                                                                  |
| **Zero config deploy**           | One-command Docker Compose stack (`frontend + backend`).                                                                                                           |

## System architecture

```
browser ──► React / Vite (Recorder) ───► FastAPI ─► Whisper(base) ┐
 |  ▲                                             │               │
 |  └─ localStorage cache ◄──── Summary page ◄────┘   GPT-4o-mini │
 └──────────────◄────── websockets / fetch ───────────────────────┘
```

*Audio is streamed in chunks (20 s) to the backend.
Once the final chunk arrives, the backend generates a single Markdown summary, stores it, and returns it to the client. The client caches it locally so re-loads never hit the server.*

## Quick-start (🚀 Docker)

```bash
git clone https://github.com/your-org/meetscribe.git
cd meetscribe
cp .env.example .env               # add your OpenAI key
docker compose up --build
# → frontend : http://localhost:4132
# → backend  : http://localhost:4131/docs  (OpenAPI UI)
```

## Local development

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend (in another terminal)
cd frontend
pnpm i      # or npm / yarn
pnpm dev    # Vite dev server on :5173
```

## Environment variables

| Variable             | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| `OPENAI_API_KEY`     | **Required** – your OpenAI key for GPT-4o and Whisper.                        |
| `WHISPER_MODEL_SIZE` | Set to `base` (default), `small`, etc. Larger = better accuracy, slower load. |
| `VITE_API_BASE_URL`  | Frontend → Backend URL. Defaults to `/api` in dev, set to full URL in prod.   |
| `SECRET_KEY`         | Any random string; used for FastAPI session cookies.                          |

See `.env.example` for the full list.

## API cheatsheet

| Endpoint             | Method             | Purpose                                               |
| -------------------- | ------------------ | ----------------------------------------------------- |
| `/api/meetings`      | `POST`             | Create a new meeting record.                          |
| `/api/chunks`        | `POST (multipart)` | Upload one ⓘ chunk. Final chunk gets `is_final=true`. |
| `/api/meetings/{id}` | `GET`              | Fetch meeting (summary, transcript, status).          |
| `/healthz`           | `GET`              | Simple health check.                                  |

## Roadmap

* [ ] Speaker diarisation
* [ ] OAuth / multi-user accounts
* [ ] Multi-language meetings (per-speaker language switching)
* [ ] Export to Google Docs / Notion / Markdown file
* [ ] Mobile PWA install banner

## Contributing

1. Fork the repo & create a feature branch.
2. Run `pnpm lint && pnpm test` before pushing.
3. Open a pull request – please follow the Conventional Commits style.

## License

MIT © 2025 Egor Gavrilov
