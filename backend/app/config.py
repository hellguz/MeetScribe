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

    # ===== Speaker diarization (local, CPU) =====
    # Runs after the meeting ends, over the concatenated audio, and labels the
    # transcript with Speaker 1..N before it is sent for summarization.
    diarization_enabled: bool = True
    diarization_model_dir: Path = BASE_DIR / "data" / "models"
    # Cosine threshold for speaker clustering. Higher merges speakers together;
    # lower splits them apart. Measured on two real recordings:
    #
    #   Bundestag debate, ~3-4 speakers, clean audio:
    #     0.4 -> 7 | 0.5 -> 5 | 0.7 -> 3 | 0.8 -> 2 | 0.9 -> 1 (all collapsed)
    #   Outdoor conversation, ~3 speakers, noisy and sparse:
    #     0.5 -> 15 | 0.7 -> 7 | 0.9 -> 3
    #
    # Clean speech tolerates a lower threshold than noisy speech. 0.6 is paired
    # with the minor-cluster pruning below, which together handle both cases:
    #
    #                                    raw -> pruned   (ground truth)
    #   clean parliament debate           5   -> 3        (3-4)
    #   noisy outdoor conversation       11   -> 4        (3)
    #
    # Lower this if distinct speakers are being merged; raise it if one person
    # keeps appearing under several labels.
    diarization_cluster_threshold: float = 0.6
    # A speaker cluster is treated as noise — and folded into the nearest real
    # speaker — when it holds less than this share of the speech AND less than
    # `min_speaker_seconds` of it. The absolute floor keeps genuinely quiet
    # participants in long meetings, where anyone is a tiny share of the total.
    diarization_min_speaker_share: float = 0.06
    diarization_min_speaker_seconds: float = 8.0
    # Ignore speech/silence runs shorter than these (seconds). Short bursts
    # produce unreliable embeddings and inflate the speaker count.
    diarization_min_duration_on: float = 0.5
    diarization_min_duration_off: float = 0.5
    # ONNX threads per diarization job. Kept small so several concurrent
    # meetings can share a modest CPU without thrashing.
    diarization_threads: int = 2
    # How many meetings may diarize at once; the rest queue.
    diarization_max_concurrent: int = 2


@lru_cache
def get_settings() -> "Settings":
    return Settings()

settings = get_settings()
