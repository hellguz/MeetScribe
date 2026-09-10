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
    summary_model: str = "claude-sonnet-5"

    # Seconds of inactivity before a recording is auto-finalized
    inactivity_timeout_seconds: int = 120

    # ===== Whisper hallucination guards =====
    # Whisper invents text when it hears noise or silence — one 30s chunk of
    # street noise here produced the Korean "3분간" (no_speech_prob 0.76,
    # avg_logprob -1.18). These are Whisper's own published heuristics applied
    # to the segments we get back, so they work for the cloud API too.
    #
    # The first two are deliberately an AND: quiet-but-real speech has a LOW
    # no_speech_prob, so it survives. Only low-confidence output on probable
    # silence is dropped, which keeps sensitivity on quiet recordings.
    whisper_no_speech_threshold: float = 0.6
    whisper_logprob_threshold: float = -1.0
    # A high compression ratio means the decoder is looping ("yeah yeah yeah…").
    whisper_compression_ratio_threshold: float = 2.4

    # ===== Speaker diarization (local, CPU) =====
    # Runs after the meeting ends, over the concatenated audio, and labels the
    # transcript with Speaker 1..N before it is sent for summarization.
    diarization_enabled: bool = True
    diarization_model_dir: Path = BASE_DIR / "data" / "models"
    # Speaker-embedding model. Measured over four 21-minute AMI meetings
    # (mean DER, 0.25s collar) plus two of our own recordings:
    #
    #   campplus @0.90   DER 23.7   speakers 4,3,3,4 (truth 4)   RTF ~0.08
    #   eres2net @0.95   DER 25.7   speakers 3,3,2,4             RTF ~0.15-0.41
    #   wespeaker@0.60   DER 60.7   speakers 13,15,14,14         RTF ~0.07
    #
    # campplus wins on accuracy, on speaker count, and on cost. It is trained
    # on Chinese yet transfers well to English, German and Russian — speaker
    # embeddings are far less language-bound than they look.
    diarization_embedding_model: str = "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"
    # Cosine threshold for clustering. Higher merges speakers, lower splits
    # them. 0.90 matches sherpa-onnx's own recommendation; 0.60 (our first
    # guess) produced 13-15 speakers in a 4-person meeting because the optimal
    # value drifts badly with recording length.
    diarization_cluster_threshold: float = 0.9
    # A speaker cluster holding less than this share of the speech is treated as
    # noise and folded into the nearest real speaker.
    #
    # There is deliberately NO absolute-seconds escape hatch. An earlier
    # "6% share OR 8 seconds" rule was meant to protect quiet participants, but
    # 8s is under 1% of a 21-minute meeting, so nearly every noise cluster
    # survived it — that single clause was most of why long meetings reported
    # 13+ speakers. The cost is that someone speaking under ~6% of the time
    # gets merged into a neighbour, which barely affects a summary.
    diarization_min_speaker_share: float = 0.06
    # How far the segmentation window advances, as a fraction of its length.
    # sherpa-onnx defaults to 0.1 — a 90% overlap that analyses every moment
    # about ten times over. Measured across six recordings, 0.5 is 4.9x faster
    # AND slightly more accurate (mean DER 22.6% vs 23.7%), with identical
    # speaker counts, so the overlap was buying nothing.
    diarization_window_shift_ratio: float = 0.5
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
