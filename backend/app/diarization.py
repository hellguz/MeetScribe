"""
app/diarization.py
────────────────────────────────────────────────────────
Local, CPU-only speaker diarization.

Runs once, after a meeting ends, over the concatenated audio. Transcription is
untouched: we reuse the words Whisper already produced and only attach a
speaker label to each of its segments, so the text sent for summarization is
identical to what it would have been without diarization.

Two things here are load-bearing:

1. Chunks are NOT 30 seconds. Measured on a real recording, chunk 0 was 44.6s
   and by chunk 11 the naive `index * 30` assumption was off by +23s. Absolute
   positions therefore come from actual decoded sample counts, never from the
   chunk index.
2. Diarization is best-effort. If the models are missing or anything throws,
   the caller falls back to the plain transcript rather than losing a summary.
"""

from __future__ import annotations

import json
import logging
import queue
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .config import settings

LOGGER = logging.getLogger("meetscribe_diarization")

SAMPLE_RATE = 16_000
SEGMENTATION_MODEL = Path("sherpa-onnx-pyannote-segmentation-3-0") / "model.int8.onnx"

# One diarizer per concurrency slot: checking one out guarantees no two threads
# call process() on the same object, while still amortizing model loading.
_pool: queue.Queue = queue.Queue()
_pool_filled = False


@dataclass
class SpeakerTurn:
    start: float
    end: float
    speaker: int


def model_paths() -> tuple[Path, Path]:
    """(segmentation, embedding) model paths. The embedder is configurable
    because which one is used matters more than any other single setting."""
    root = Path(settings.diarization_model_dir)
    return root / SEGMENTATION_MODEL, root / settings.diarization_embedding_model


def models_available() -> bool:
    return all(p.exists() for p in model_paths())


def is_enabled() -> bool:
    if not settings.diarization_enabled:
        return False
    if not models_available():
        seg, emb = model_paths()
        LOGGER.warning(
            "Diarization enabled but models are missing (%s, %s). Skipping speaker labels.",
            seg,
            emb,
        )
        return False
    return True


def _build_diarizer():
    import sherpa_onnx as so

    seg, emb = model_paths()
    config = so.OfflineSpeakerDiarizationConfig(
        segmentation=so.OfflineSpeakerSegmentationModelConfig(
            pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(seg)),
            num_threads=settings.diarization_threads,
        ),
        embedding=so.SpeakerEmbeddingExtractorConfig(
            model=str(emb), num_threads=settings.diarization_threads
        ),
        clustering=so.FastClusteringConfig(
            num_clusters=-1, threshold=settings.diarization_cluster_threshold
        ),
        min_duration_on=settings.diarization_min_duration_on,
        min_duration_off=settings.diarization_min_duration_off,
    )
    if not config.validate():
        raise RuntimeError("Invalid diarization configuration")
    return so.OfflineSpeakerDiarization(config)


def _acquire_diarizer():
    """Check out a diarizer, blocking while all concurrency slots are busy."""
    global _pool_filled
    if not _pool_filled:
        # Sentinels, not instances: models load lazily on first real use, so a
        # server that never records anything pays nothing.
        for _ in range(max(1, settings.diarization_max_concurrent)):
            _pool.put(None)
        _pool_filled = True

    slot = _pool.get()  # blocks; this is also the concurrency limit
    if slot is None:
        LOGGER.info(
            "Loading diarization models (threads=%d)…", settings.diarization_threads
        )
        slot = _build_diarizer()
    return slot


def _release_diarizer(slot) -> None:
    _pool.put(slot)


def decode_to_pcm(
    chunk_paths: list[tuple[int, Path]], workdir: Path
) -> tuple[Path, dict[int, tuple[float, float]], float]:
    """
    Decode chunks into one raw float32 mono stream on disk.

    Streaming to disk keeps peak memory at roughly one copy of the audio
    (~230 MB per recorded hour) instead of two.

    Returns (raw_path, {chunk_index: (start_sec, end_sec)}, total_seconds).
    Chunks that fail to decode get no entry — the final chunk is an
    intentionally empty blob and is expected to fail here.
    """
    raw_path = workdir / "concat.f32"
    offsets: dict[int, tuple[float, float]] = {}
    cursor = 0  # samples written so far

    with raw_path.open("wb") as out:
        for index, path in chunk_paths:
            proc = subprocess.run(
                [
                    "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
                    "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-",
                ],
                capture_output=True,
            )
            if proc.returncode != 0 or not proc.stdout:
                detail = proc.stderr.decode(errors="replace").strip().splitlines()
                LOGGER.info(
                    "Chunk %d produced no audio (%s); its text will inherit the previous speaker.",
                    index,
                    (detail[-1][:120] if detail else "empty output"),
                )
                continue

            out.write(proc.stdout)
            n_samples = len(proc.stdout) // 4
            offsets[index] = (
                cursor / SAMPLE_RATE,
                (cursor + n_samples) / SAMPLE_RATE,
            )
            cursor += n_samples

    return raw_path, offsets, cursor / SAMPLE_RATE


def _prune_minor_speakers(turns: list[SpeakerTurn]) -> list[SpeakerTurn]:
    """
    Fold away clusters that look like noise rather than participants.

    Background noise, laughter and one-word interjections produce unreliable
    embeddings, and each fragment tends to become its own "speaker". Without
    this, noisy recordings invent a dozen speakers; with it, one threshold works
    for both clean and noisy audio. Measured on four 21-minute AMI meetings at
    threshold 0.90, true speaker count 4 in every case:

        raw clusters:  21, 18, 19, 21
        after pruning:  4,  3,  3,  4

    A cluster survives on its *share* of the speech alone. An earlier version
    also let a cluster through on absolute duration ("or >= 8 seconds"), which
    backfired: 8s is under 1% of a 21-minute meeting, so almost every noise
    cluster qualified, and long meetings reported 13+ speakers.
    """
    if not turns:
        return turns

    talk: dict[int, float] = {}
    for turn in turns:
        talk[turn.speaker] = talk.get(turn.speaker, 0.0) + (turn.end - turn.start)
    total = sum(talk.values()) or 1.0

    major = {
        speaker
        for speaker, seconds in talk.items()
        if seconds / total >= settings.diarization_min_speaker_share
    }
    if not major or len(major) == len(talk):
        return turns

    major_turns = [t for t in turns if t.speaker in major]
    if not major_turns:
        return turns

    def nearest_major(turn: SpeakerTurn) -> int:
        best, best_distance = turn.speaker, float("inf")
        for other in major_turns:
            if other.end >= turn.start and other.start <= turn.end:
                return other.speaker  # overlapping: no closer answer exists
            distance = min(abs(turn.start - other.end), abs(other.start - turn.end))
            if distance < best_distance:
                best, best_distance = other.speaker, distance
        return best

    LOGGER.info(
        "Folding %d minor speaker cluster(s) into their nearest neighbour.",
        len(talk) - len(major),
    )
    return [
        t if t.speaker in major else SpeakerTurn(t.start, t.end, nearest_major(t))
        for t in turns
    ]


def diarize_file(raw_path: Path) -> tuple[list[SpeakerTurn], int]:
    """Diarize a raw float32 mono stream. Returns (turns, speaker_count)."""
    samples = np.fromfile(raw_path, dtype=np.float32)
    if samples.size == 0:
        return [], 0

    slot = _acquire_diarizer()
    try:
        result = slot.process(samples)
    finally:
        _release_diarizer(slot)

    turns = [
        SpeakerTurn(start=seg.start, end=seg.end, speaker=seg.speaker)
        for seg in result.sort_by_start_time()
    ]
    turns = _prune_minor_speakers(turns)

    # sherpa's speaker ids are arbitrary, and pruning leaves gaps; renumber by
    # first appearance so "Speaker 1" is whoever spoke first.
    order: dict[int, int] = {}
    renumbered: list[SpeakerTurn] = []
    for turn in turns:
        if turn.speaker not in order:
            order[turn.speaker] = len(order) + 1
        renumbered.append(SpeakerTurn(turn.start, turn.end, order[turn.speaker]))

    return renumbered, len(order)


def _speaker_for(start: float, end: float, turns: list[SpeakerTurn]) -> int | None:
    """The speaker whose turn overlaps [start, end] most, or None if none does."""
    best_speaker: int | None = None
    best_overlap = 0.0
    for turn in turns:
        if turn.end <= start:
            continue
        if turn.start >= end:
            break  # turns are sorted by start time
        overlap = min(end, turn.end) - max(start, turn.start)
        if overlap > best_overlap:
            best_speaker, best_overlap = turn.speaker, overlap
    return best_speaker


def label_transcript(
    chunks: list[tuple[int, str | None, str | None]],
    offsets: dict[int, tuple[float, float]],
    turns: list[SpeakerTurn],
) -> str:
    """
    Build a speaker-labelled transcript.

    `chunks` is [(chunk_index, text, segments_json)] in index order. Every
    chunk's words are preserved: a chunk with no timings or no decoded audio is
    appended as a continuation of the current speaker rather than dropped.
    """
    blocks: list[tuple[int | None, list[str]]] = []

    def append(speaker: int | None, text: str) -> None:
        text = text.strip()
        if not text:
            return
        if blocks and blocks[-1][0] == speaker:
            blocks[-1][1].append(text)
        else:
            blocks.append((speaker, [text]))

    for index, text, segments_json in chunks:
        base = offsets.get(index, (None, None))[0]

        segments: list[dict] = []
        if segments_json:
            try:
                segments = json.loads(segments_json) or []
            except (ValueError, TypeError):
                segments = []

        if base is None or not segments:
            # No position or no timings: keep the words with the current speaker.
            if text:
                append(blocks[-1][0] if blocks else None, text)
            continue

        for seg in segments:
            seg_text = (seg.get("text") or "").strip()
            if not seg_text:
                continue
            start = base + float(seg.get("start") or 0.0)
            end = base + float(seg.get("end") or 0.0)
            speaker = _speaker_for(start, end, turns)
            if speaker is None:
                speaker = blocks[-1][0] if blocks else None
            append(speaker, seg_text)

    # Speech often starts before the first detected turn, which would open the
    # transcript with "Unknown speaker". Attribute that lead-in to whoever the
    # diarizer heard first instead.
    first_known = next((s for s, _ in blocks if s is not None), None)
    if first_known is not None:
        for i, (speaker, parts) in enumerate(blocks):
            if speaker is not None:
                break
            blocks[i] = (first_known, parts)

    # Backfilling can leave neighbouring blocks with the same speaker.
    coalesced: list[tuple[int | None, list[str]]] = []
    for speaker, parts in blocks:
        if coalesced and coalesced[-1][0] == speaker:
            coalesced[-1][1].extend(parts)
        else:
            coalesced.append((speaker, list(parts)))

    lines = []
    for speaker, parts in coalesced:
        label = f"Speaker {speaker}" if speaker is not None else "Unknown speaker"
        lines.append(f"{label}: {' '.join(parts)}")
    return "\n\n".join(lines)


def diarize_meeting(
    chunk_paths: list[tuple[int, Path]],
    chunks: list[tuple[int, str | None, str | None]],
) -> tuple[str, int, float] | None:
    """
    Full post-meeting pass.

    Returns (labelled_transcript, speaker_count, audio_seconds), or None if
    diarization could not run — in which case the caller keeps the plain
    transcript, which is exactly the pre-diarization behaviour.
    """
    if not is_enabled():
        return None

    try:
        with tempfile.TemporaryDirectory(prefix="meetscribe-diar-") as tmp:
            raw_path, offsets, total_seconds = decode_to_pcm(chunk_paths, Path(tmp))
            if not offsets:
                LOGGER.warning("No chunk decoded to audio; skipping diarization.")
                return None

            turns, speakers = diarize_file(raw_path)
            if not turns:
                LOGGER.warning("Diarization found no speech; keeping plain transcript.")
                return None

            labelled = label_transcript(chunks, offsets, turns)
            LOGGER.info(
                "🗣️  Diarization: %d speakers, %d turns over %.1fs of audio.",
                speakers,
                len(turns),
                total_seconds,
            )
            return labelled, speakers, total_seconds
    except Exception:
        LOGGER.exception("Diarization failed; keeping plain transcript.")
        return None
