# <./backend\app\config.py>
from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    secret_key: str
    openai_api_key: str
    groq_api_key: str

    recognition_in_cloud: bool
    
    whisper_model_size: str = "tiny"

    frontend_origin: str

    db_path: Path = BASE_DIR / "data" / "db.sqlite3"

    # Celery / Redis
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"


@lru_cache
def get_settings() -> "Settings":
    return Settings()

settings = get_settings()