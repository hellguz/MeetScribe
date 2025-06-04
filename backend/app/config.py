from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    secret_key: str
    openai_api_key: str
    whisper_model_size: str = "tiny"

    db_path: Path = BASE_DIR / "data" / "db.sqlite3"

@lru_cache
def get_settings() -> "Settings":
    return Settings()

settings = get_settings()

