# <./backend\app\config.py>
from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BASE_DIR.parent / ".env"), extra="ignore")

    secret_key: str
    anthropic_api_key: str
    groq_api_key: str

    recognition_in_cloud: bool

    whisper_model_size: str = "tiny"

    frontend_origin: str

    db_path: Path = BASE_DIR / "data" / "db.sqlite3"

    worker_threads: int = 4

    # Model used for summarization and title generation
    summary_model: str = "claude-sonnet-4-6"

    # Seconds of inactivity before a recording is auto-finalized
    inactivity_timeout_seconds: int = 120


@lru_cache
def get_settings() -> "Settings":
    return Settings()

settings = get_settings()
