from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    secret_key: str
    access_token_expire_minutes: int = 30

    database_url: str
    redis_url: str

    # S3
    s3_bucket: str
    minio_endpoint: str
    minio_root_user: str
    minio_root_password: str
    s3_secure: bool = False

    # Stripe
    stripe_secret_key: str
    stripe_webhook_secret: str

    whisper_model_path: str

@lru_cache
def get_settings() -> "Settings":
    return Settings()

settings = get_settings()


