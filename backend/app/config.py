# backend/app/config.py

from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    secret_key: str
    openai_api_key: str
    whisper_model_size: str = "tiny"

    frontend_origin: str

    db_path: Path = BASE_DIR / "data" / "db.sqlite3"

    # Redis URL for RQ
    redis_url: str = "redis://localhost:6379/0"

    # OpenMP / Whisper threading
    omp_num_threads: int = 3
    mkl_num_threads: int = 3
    openblas_num_threads: int = 3

@lru_cache
def get_settings() -> "Settings":
    return Settings()

settings = get_settings()
