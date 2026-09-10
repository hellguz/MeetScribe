#!/usr/bin/env python3
"""
scripts/eval_parakeet_encoders.py
───────────────────────────────────────────────────────────────────────────
Compares Parakeet encoder builds — fp32, weight-only int8 (MatMulNBits, from
quantize_parakeet_encoder.py) and the upstream dynamically quantized int8 —
on the same audio, in the same runtime.

Why not measure in the browser: the two questions that decide whether the
weight-only build replaces the two-plan setup are about the *weights*, not
about WebGPU. Both are answerable on the CPU here, in minutes, without
recording a meeting:

  accuracy  encoder output error, and the transcript each build produces,
            against the fp32 encoder as reference
  speed     encoder wall-clock per second of audio, weight-only vs the
            dynamically quantized file that CPU devices download today

The browser still has the last word on absolute speed (ORT Web on WASM is
slower than ORT on native CPU), but the *ratio* between two files in one
runtime carries over.

Feature extraction mirrors parakeet.js/src/mel.js exactly — NeMo's
preprocessor: pre-emphasis 0.97, 512-point FFT over a 400-sample symmetric
Hann window, hop 160, 128 slaney mel bins, log(x + 2^-24), then per-feature
normalization with an N-1 denominator. Decoding mirrors its greedy TDT loop,
including the two rules that are easy to get wrong: the decoder state only
advances on a non-blank token, and a duration of 0 keeps you on the frame.

Usage
─────
    python scripts/eval_parakeet_encoders.py \
        --wavs data/eval/wavs \
        --models data/parakeet-q8 \
        --encoder fp32=data/parakeet-q8/.src/encoder-model.onnx \
        --encoder q8=data/parakeet-q8/encoder-model.int8.onnx \
        --encoder dyn-int8=data/eval/upstream-int8/encoder-model.int8.onnx

The first --encoder is the reference every other one is scored against.
Audio must be 16 kHz mono WAV.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
N_FFT = 512
WIN_LENGTH = 400
HOP_LENGTH = 160
PREEMPH = 0.97
LOG_ZERO_GUARD = 2.0**-24
N_MELS = 128
N_FREQ_BINS = N_FFT // 2 + 1

# TDT durations are the tail of the joint's output; the vocabulary is the head.
DURATION_BINS = 5
MAX_TOKENS_PER_STEP = 10

F_SP = 200.0 / 3
MIN_LOG_HZ = 1000.0
MIN_LOG_MEL = MIN_LOG_HZ / F_SP
LOG_STEP = np.log(6.4) / 27.0


# ── features ───────────────────────────────────────────────────────────────
def hz_to_mel(f):
    """Slaney mel scale, as torchaudio's melscale_fbanks(mel_scale="slaney")."""
    f = np.asarray(f, dtype=np.float64)
    # np.where evaluates both branches, so keep the log away from 0 Hz.
    safe = np.maximum(f, MIN_LOG_HZ)
    return np.where(f >= MIN_LOG_HZ, MIN_LOG_MEL + np.log(safe / MIN_LOG_HZ) / LOG_STEP, f / F_SP)


def mel_to_hz(m):
    m = np.asarray(m, dtype=np.float64)
    return np.where(m >= MIN_LOG_MEL, MIN_LOG_HZ * np.exp(LOG_STEP * (m - MIN_LOG_MEL)), m * F_SP)


def mel_filterbank(n_mels: int = N_MELS) -> np.ndarray:
    """[n_mels, 257] triangular filters with slaney normalization."""
    all_freqs = np.linspace(0.0, SAMPLE_RATE / 2, N_FREQ_BINS)
    pts = mel_to_hz(np.linspace(float(hz_to_mel(0.0)), float(hz_to_mel(SAMPLE_RATE / 2.0)), n_mels + 2))
    diff = np.diff(pts)
    fb = np.zeros((n_mels, N_FREQ_BINS), dtype=np.float64)
    for m in range(n_mels):
        down = (all_freqs - pts[m]) / diff[m]
        up = (pts[m + 2] - all_freqs) / diff[m + 1]
        fb[m] = np.maximum(0.0, np.minimum(down, up)) * (2.0 / (pts[m + 2] - pts[m]))
    return fb.astype(np.float32)


_FB = mel_filterbank()
# Symmetric (periodic=False) Hann over 400 samples, zero-padded into 512.
_WINDOW = np.zeros(N_FFT, dtype=np.float64)
_WINDOW[:WIN_LENGTH] = np.hanning(WIN_LENGTH)


def log_mel(audio: np.ndarray) -> np.ndarray:
    """16 kHz mono float32 samples -> normalized log-mel [128, frames]."""
    n = len(audio)
    pad = N_FFT // 2
    padded = np.zeros(n + N_FFT, dtype=np.float32)
    padded[pad] = audio[0]
    padded[pad + 1 : pad + n] = (audio[1:] - PREEMPH * audio[:-1]).astype(np.float32)

    frames = (len(padded) - N_FFT) // HOP_LENGTH + 1
    idx = np.arange(frames)[:, None] * HOP_LENGTH + np.arange(N_FFT)[None, :]
    windowed = padded[idx].astype(np.float64) * _WINDOW
    spec = np.fft.rfft(windowed, n=N_FFT, axis=1)
    power = (spec.real**2 + spec.imag**2).astype(np.float32)  # [frames, 257]

    mel = np.log(power @ _FB.T + LOG_ZERO_GUARD).T  # [128, frames]
    mean = mel.mean(axis=1, keepdims=True)
    std = mel.std(axis=1, ddof=1, keepdims=True) if frames > 1 else np.ones_like(mean)
    return ((mel - mean) / (std + 1e-5)).astype(np.float32)


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wf:
        if wf.getframerate() != SAMPLE_RATE or wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise SystemExit(f"{path.name}: need 16 kHz mono 16-bit WAV, got {wf.getframerate()} Hz / {wf.getnchannels()} ch / {wf.getsampwidth() * 8}-bit")
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype="<i2")
    return (pcm.astype(np.float32) / 32768.0).astype(np.float32)


# ── tokenizer ──────────────────────────────────────────────────────────────
class Tokenizer:
    """vocab.txt is "<token> <id>" per line, as parakeet.js reads it."""

    def __init__(self, vocab_path: Path):
        tokens: dict[int, str] = {}
        for line in vocab_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            tok, _, idx = line.rpartition(" ")
            tokens[int(idx)] = tok
        self.id2token = [tokens.get(i, "") for i in range(max(tokens) + 1)]
        self.blank_id = self.id2token.index("<blk>")

    def decode(self, ids: list[int]) -> str:
        text = "".join(self.id2token[i].replace("▁", " ") for i in ids if i != self.blank_id)
        text = re.sub(r"^\s+", "", text)
        text = re.sub(r"\s+(?=[^\w\s])", "", text)
        return re.sub(r"\s+", " ", text).strip()


# ── decoding ───────────────────────────────────────────────────────────────
def greedy_tdt(joint, encoded: np.ndarray, vocab_size: int, blank_id: int) -> list[int]:
    """Greedy TDT decode of one utterance. `encoded` is [1, D, T]."""
    t_total = encoded.shape[2]
    state1 = np.zeros((2, 1, 640), dtype=np.float32)
    state2 = np.zeros((2, 1, 640), dtype=np.float32)
    target_length = np.array([1], dtype=np.int32)

    ids: list[int] = []
    t, emitted = 0, 0
    while t < t_total:
        frame = np.ascontiguousarray(encoded[:, :, t : t + 1])
        prev = ids[-1] if ids else blank_id
        outputs, _, out1, out2 = joint.run(
            None,
            {
                "encoder_outputs": frame,
                "targets": np.array([[prev]], dtype=np.int32),
                "target_length": target_length,
                "input_states_1": state1,
                "input_states_2": state2,
            },
        )
        logits = outputs.reshape(-1)
        token_id = int(np.argmax(logits[:vocab_size]))
        step = int(np.argmax(logits[vocab_size : vocab_size + DURATION_BINS]))

        if token_id != blank_id:
            # Only a non-blank emission advances the decoder state.
            state1, state2 = out1, out2
            ids.append(token_id)
            emitted += 1

        if step > 0:
            t += step
            emitted = 0
        elif token_id == blank_id or emitted >= MAX_TOKENS_PER_STEP:
            t += 1
            emitted = 0
        # A duration of 0 on a non-blank token deliberately stays on the frame.
    return ids


# ── scoring ────────────────────────────────────────────────────────────────
def wer(reference: str, hypothesis: str) -> tuple[float, int, int, int, int]:
    """Levenshtein over words: (rate, substitutions, deletions, insertions, N)."""
    ref, hyp = reference.lower().split(), hypothesis.lower().split()
    # Each cell carries (cost, substitutions, deletions, insertions).
    prev: list[tuple[float, int, int, int]] = [(j, 0, 0, j) for j in range(len(hyp) + 1)]
    for i in range(1, len(ref) + 1):
        cur: list[tuple[float, int, int, int]] = [(i, 0, i, 0)] + [(float("inf"), 0, 0, 0)] * len(hyp)
        for j in range(1, len(hyp) + 1):
            if ref[i - 1] == hyp[j - 1]:
                cur[j] = prev[j - 1]
            else:
                sub = (prev[j - 1][0] + 1, prev[j - 1][1] + 1, prev[j - 1][2], prev[j - 1][3])
                dele = (prev[j][0] + 1, prev[j][1], prev[j][2] + 1, prev[j][3])
                ins = (cur[j - 1][0] + 1, cur[j - 1][1], cur[j - 1][2], cur[j - 1][3] + 1)
                cur[j] = min(sub, dele, ins, key=lambda x: x[0])
        prev = cur
    cost, subs, dels, inss = prev[-1]
    return cost / max(1, len(ref)), subs, dels, inss, len(ref)


def rel_error(reference: np.ndarray, other: np.ndarray) -> float:
    """||other - reference|| / ||reference||, over the common frame span."""
    t = min(reference.shape[2], other.shape[2])
    a, b = reference[:, :, :t].astype(np.float64), other[:, :, :t].astype(np.float64)
    denom = np.linalg.norm(a)
    return float(np.linalg.norm(b - a) / denom) if denom else float("nan")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--wavs", type=Path, required=True, help="directory of 16 kHz mono WAV files")
    parser.add_argument("--models", type=Path, required=True, help="directory holding decoder_joint-model.int8.onnx and vocab.txt")
    parser.add_argument("--encoder", action="append", required=True, metavar="LABEL=PATH", help="encoder to evaluate; the first is the reference")
    parser.add_argument("--threads", type=int, default=0, help="intra-op threads (0 = ORT default)")
    parser.add_argument("--json", type=Path, default=None, help="also write the results here")
    args = parser.parse_args()

    import onnxruntime as ort

    encoders: list[tuple[str, Path]] = []
    for spec in args.encoder:
        label, _, path = spec.partition("=")
        if not path:
            raise SystemExit(f"--encoder wants LABEL=PATH, got {spec!r}")
        p = Path(path)
        if not p.exists():
            raise SystemExit(f"no such encoder: {p}")
        encoders.append((label, p))

    wavs = sorted(p for p in args.wavs.iterdir() if p.suffix.lower() == ".wav")
    if not wavs:
        raise SystemExit(f"no .wav files in {args.wavs}")

    tokenizer = Tokenizer(args.models / "vocab.txt")
    vocab_size = len(tokenizer.id2token)

    opts = ort.SessionOptions()
    if args.threads:
        opts.intra_op_num_threads = args.threads
    joint = ort.InferenceSession(str(args.models / "decoder_joint-model.int8.onnx"), opts, providers=["CPUExecutionProvider"])

    print("Extracting features")
    features: dict[str, tuple[np.ndarray, float]] = {}
    total_seconds = 0.0
    for wav in wavs:
        audio = read_wav(wav)
        seconds = len(audio) / SAMPLE_RATE
        total_seconds += seconds
        features[wav.name] = (log_mel(audio), seconds)
        print(f"  {wav.name:14} {seconds:6.2f} s -> {features[wav.name][0].shape[1]:5} frames")
    print(f"  {'total':14} {total_seconds:6.2f} s\n")

    results: dict[str, dict] = {}
    reference_label = encoders[0][0]

    for label, path in encoders:
        size_mb = path.stat().st_size / 1e6
        data = path.with_suffix(path.suffix + ".data")
        if data.exists():
            size_mb += data.stat().st_size / 1e6
        print(f"-- {label}  ({path.name}, {size_mb:.0f} MB)")
        load_start = time.perf_counter()
        session = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
        length_is_int32 = session.get_inputs()[1].type == "tensor(int32)"
        print(f"   session ready in {time.perf_counter() - load_start:.1f} s")

        per_clip: dict[str, dict] = {}
        encoder_seconds = 0.0
        for wav in wavs:
            mel, seconds = features[wav.name]
            length = np.array([mel.shape[1]], dtype=np.int32 if length_is_int32 else np.int64)
            t0 = time.perf_counter()
            encoded, _ = session.run(None, {"audio_signal": mel[None, :, :], "length": length})
            elapsed = time.perf_counter() - t0
            encoder_seconds += elapsed
            text = tokenizer.decode(greedy_tdt(joint, encoded, vocab_size, tokenizer.blank_id))
            per_clip[wav.name] = {"seconds": seconds, "encoder_s": elapsed, "encoded": encoded, "text": text}
            print(f"   {wav.name:14} enc {elapsed:6.2f} s ({seconds / elapsed:5.1f}x)  {text[:70]}")

        results[label] = {
            "path": str(path),
            "size_mb": round(size_mb, 1),
            "encoder_s": round(encoder_seconds, 2),
            "realtime_x": round(total_seconds / encoder_seconds, 2),
            "clips": per_clip,
        }
        print(f"   encoder total {encoder_seconds:.2f} s for {total_seconds:.2f} s audio = {total_seconds / encoder_seconds:.1f}x realtime\n")

    print(f"== against {reference_label} ==")
    reference = results[reference_label]
    print(f"{'build':12} {'size':>8} {'speed':>9} {'enc err':>9} {'WER':>8}   sub/del/ins")
    for label, res in results.items():
        errors = []
        subs = dels = inss = cost = ref_words = 0
        for name, clip in res["clips"].items():
            ref_clip = reference["clips"][name]
            errors.append(rel_error(ref_clip["encoded"], clip["encoded"]))
            _, s, d, i, n = wer(ref_clip["text"], clip["text"])
            subs, dels, inss, ref_words, cost = subs + s, dels + d, inss + i, ref_words + n, cost + s + d + i
        overall = cost / max(1, ref_words)
        res["encoder_rel_error"] = round(float(np.mean(errors)), 5)
        res["wer_vs_reference"] = round(overall, 5)
        res["errors"] = {"substitutions": subs, "deletions": dels, "insertions": inss, "reference_words": ref_words}
        print(f"{label:12} {res['size_mb']:7.0f}M {res['realtime_x']:8.1f}x {np.mean(errors) * 100:8.2f}% {overall * 100:7.2f}%   {subs}/{dels}/{inss}")

    print("\nTranscripts")
    for wav in wavs:
        print(f"  {wav.name}")
        for label, res in results.items():
            print(f"    {label:10} {res['clips'][wav.name]['text']}")

    if args.json:
        payload = {}
        for label, res in results.items():
            entry = {k: v for k, v in res.items() if k != "clips"}
            entry["clips"] = {n: {k: v for k, v in c.items() if k != "encoded"} for n, c in res["clips"].items()}
            payload[label] = entry
        args.json.write_text(
            json.dumps({"audio_seconds": total_seconds, "reference": reference_label, "builds": payload}, indent=2),
            encoding="utf-8",
        )
        print(f"\nWrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
