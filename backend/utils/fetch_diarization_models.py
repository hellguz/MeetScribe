"""
utils/fetch_diarization_models.py
────────────────────────────────────────────────────────
Downloads the local speaker-diarization models, if they are not already there.

Idempotent and safe to run on every start: it skips files that exist and
non-zero-length. Uses only the standard library, so it can run before any
application dependency is importable.

Models (~36 MB total, ONNX/int8, no PyTorch):
  * sherpa-onnx-pyannote-segmentation-3-0 — speech/speaker segmentation
  * wespeaker_en_voxceleb_CAM++           — speaker embeddings

Target directory comes from DIARIZATION_MODEL_DIR, defaulting to the same
`backend/data/models` the application config uses.
"""

import os
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DIR = BASE_DIR / "data" / "models"

RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
SEGMENTATION_ARCHIVE = (
    f"{RELEASES}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
)
# The upstream release tag really is spelled "recongition".
EMBEDDING_URL = f"{RELEASES}/speaker-recongition-models/wespeaker_en_voxceleb_CAM%2B%2B.onnx"

SEGMENTATION_DIR = "sherpa-onnx-pyannote-segmentation-3-0"
SEGMENTATION_FILE = "model.int8.onnx"
EMBEDDING_FILE = "wespeaker_en_voxceleb_CAM++.onnx"


def _present(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0


def _download(url: str, dest: Path) -> None:
    print(f"[models] downloading {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=120) as response, tmp.open("wb") as out:
            while True:
                block = response.read(1 << 20)
                if not block:
                    break
                out.write(block)
    except urllib.error.URLError as exc:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"could not download {url}: {exc}") from exc
    # Rename only once complete, so an interrupted run cannot leave a truncated
    # model that later looks present.
    tmp.replace(dest)
    print(f"[models] saved {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")


def fetch(target_dir: Path) -> None:
    seg_model = target_dir / SEGMENTATION_DIR / SEGMENTATION_FILE
    emb_model = target_dir / EMBEDDING_FILE

    if _present(seg_model):
        print(f"[models] {SEGMENTATION_DIR}/{SEGMENTATION_FILE} already present")
    else:
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "segmentation.tar.bz2"
            _download(SEGMENTATION_ARCHIVE, archive)
            print("[models] extracting segmentation model")
            with tarfile.open(archive, "r:bz2") as tar:
                # filter="data" refuses absolute paths and traversal.
                tar.extractall(path=target_dir, filter="data")
        if not _present(seg_model):
            raise RuntimeError(f"archive did not contain {seg_model}")

    if _present(emb_model):
        print(f"[models] {EMBEDDING_FILE} already present")
    else:
        _download(EMBEDDING_URL, emb_model)


def main() -> int:
    target_dir = Path(os.environ.get("DIARIZATION_MODEL_DIR") or DEFAULT_DIR)
    try:
        fetch(target_dir)
    except Exception as exc:
        # Never fatal: without models the app simply skips speaker labels.
        print(f"[models] WARNING: {exc}", file=sys.stderr)
        print(
            "[models] Diarization will be skipped until the models are available.",
            file=sys.stderr,
        )
        return 0
    print(f"[models] diarization models ready in {target_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
