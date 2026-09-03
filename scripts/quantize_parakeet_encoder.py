#!/usr/bin/env python3
"""
scripts/quantize_parakeet_encoder.py
───────────────────────────────────────────────────────────────────────────
Builds a *weight-only* int8 Parakeet encoder for the on-device transcription
mode (frontend/src/ondevice/), and writes it next to the other model files so
`VITE_PARAKEET_MODEL_BASE` can point at the result.

Why this exists
───────────────
The int8 encoder published upstream is *dynamically* quantized: weights AND
activations become int8 at runtime, via the ops MatMulInteger and
DynamicQuantizeLinear. Two consequences:

  * ONNX Runtime Web has no WebGPU kernel for either op, so that file can
    only ever run on the CPU.
  * Quantizing activations costs real accuracy. Measured over a 30-minute
    meeting it dropped 12% of the spoken words outright and substituted
    another 15%, against the fp16 model as reference.

Weight-only quantization stores just the *weights* as int8 and dequantizes
each block back to fp16 at runtime, so the arithmetic keeps fp16 precision.
It compiles to a single op, MatMulNBits, which ORT Web *does* implement on
WebGPU as well as on CPU. One file then serves both paths:

    ~0.65 GB      vs 1.26 GB for fp16 — half the download
    GPU           same speed and accuracy as fp16
    CPU           same weights, so near-lossless instead of the above

8 bits, not 4: measured through six stacked layers, 8-bit weight-only came
out at 1.6% relative error while 4-bit hit 24%. 4-bit is not usable here.

Usage
─────
    pip install onnx onnxruntime onnx_ir
    python scripts/quantize_parakeet_encoder.py --out ./parakeet-q8

Then serve that directory (any static host) and build the frontend with
VITE_PARAKEET_MODEL_BASE pointing at it.

The fp32 encoder is ~2.4 GB, so expect a long download and ~6 GB of free
disk while it runs. Nothing here touches the app at runtime.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_REPO = "ysdede/parakeet-tdt-0.6b-v3-onnx"
# parakeet.js pins the second branch for its fp16 assets; the fp32 encoder
# lives on whichever of these answers first.
REVISIONS = ("main", "feat/fp16-canonical-v3")

FP32_ENCODER = "encoder-model.onnx"
DECODER = "decoder_joint-model.int8.onnx"
VOCAB = "vocab.txt"

# What frontend/src/ondevice/hub.ts asks for, per plan. The same quantized
# file is written under both names so either plan loads it unchanged.
NAME_FOR_PLAN = {"cpu-int8": "encoder-model.int8.onnx", "gpu-fp16": "encoder-model.fp16.onnx"}


def hf_url(repo: str, revision: str, filename: str) -> str:
    return f"https://huggingface.co/{repo}/resolve/{revision}/{filename}"


def download(url: str, dest: Path, optional: bool = False) -> bool:
    """Stream `url` to `dest`. Returns False for an absent optional file."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"[skip] {dest.name} already present ({dest.stat().st_size / 1e6:.0f} MB)")
        return True

    print(f"[get ] {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=120) as response, tmp.open("wb") as out:
            total = int(response.headers.get("content-length") or 0)
            done = 0
            while True:
                block = response.read(1 << 20)
                if not block:
                    break
                out.write(block)
                done += len(block)
                if total:
                    pct = done / total * 100
                    print(f"\r       {done / 1e6:7.0f} / {total / 1e6:.0f} MB ({pct:5.1f}%)", end="", flush=True)
            print()
    except urllib.error.HTTPError as exc:
        tmp.unlink(missing_ok=True)
        if optional and exc.code in (403, 404):
            return False
        raise SystemExit(f"could not download {url}: {exc}") from exc
    except urllib.error.URLError as exc:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"could not download {url}: {exc}") from exc

    tmp.replace(dest)
    return True


def fetch_sources(repo: str, revision: str | None, workdir: Path) -> Path:
    """Download the fp32 encoder (plus decoder and vocab) into `workdir`."""
    revisions = (revision,) if revision else REVISIONS
    for rev in revisions:
        encoder = workdir / FP32_ENCODER
        if download(hf_url(repo, rev, FP32_ENCODER), encoder, optional=True):
            # Models over the 2 GB protobuf limit keep their weights alongside.
            download(hf_url(repo, rev, FP32_ENCODER + ".data"), workdir / (FP32_ENCODER + ".data"), optional=True)
            for name in (DECODER, VOCAB):
                download(hf_url(repo, rev, name), workdir / name)
            print(f"[ok  ] using revision '{rev}'")
            return encoder
        print(f"[miss] {FP32_ENCODER} not on revision '{rev}'")
    raise SystemExit(f"{FP32_ENCODER} not found in {repo} (tried: {', '.join(revisions)})")


def count_ops(model) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in model.graph.node:
        counts[node.op_type] = counts.get(node.op_type, 0) + 1
    return counts


def quantize(encoder_path: Path, out_path: Path, bits: int, block_size: int) -> None:
    import onnx
    from onnxruntime.quantization import matmul_nbits_quantizer as q

    print(f"[load] {encoder_path.name} ({encoder_path.stat().st_size / 1e6:.0f} MB)")
    model = onnx.load(str(encoder_path))
    before = count_ops(model)

    print(f"[quant] weight-only, {bits}-bit, block size {block_size} — takes a few minutes")
    config = q.DefaultWeightOnlyQuantConfig(bits=bits, block_size=block_size, is_symmetric=True)
    quantizer = q.MatMulNBitsQuantizer(model, algo_config=config)
    quantizer.process()

    # The quantized model is well under the 2 GB protobuf limit, so keep it as
    # a single file: hub.ts then needs no .data sidecar.
    quantizer.model.save_model_to_file(str(out_path), use_external_data_format=False)

    after = count_ops(onnx.load(str(out_path)))
    converted = after.get("MatMulNBits", 0)
    print(f"[quant] MatMul {before.get('MatMul', 0)} -> MatMulNBits {converted}")
    if converted == 0:
        raise SystemExit(
            "no MatMul nodes were quantized — the encoder may use Gemm instead, "
            "which this quantizer does not rewrite."
        )
    left = before.get("MatMul", 0) - after.get("MatMul", 0) - converted
    if left:
        print(f"[warn] {abs(left)} MatMul node(s) unaccounted for; check the model")


def verify(model_path: Path) -> None:
    """Load the result and print its signature, so a broken file fails here."""
    import onnxruntime as ort

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    ins = ", ".join(f"{i.name}{i.shape}" for i in session.get_inputs())
    outs = ", ".join(f"{o.name}{o.shape}" for o in session.get_outputs())
    print(f"[check] loads OK\n        inputs : {ins}\n        outputs: {outs}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("parakeet-q8"), help="directory to write the servable model files into")
    parser.add_argument("--workdir", type=Path, default=None, help="where to keep the fp32 download (default: <out>/.src)")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Hugging Face repo holding the fp32 encoder")
    parser.add_argument("--revision", default=None, help="pin a branch instead of trying main then the fp16 branch")
    parser.add_argument("--bits", type=int, default=8, choices=(4, 8), help="weight width; 4 measured 24%% error, so 8 unless you are experimenting")
    parser.add_argument("--block-size", type=int, default=128, help="weights per quantization block")
    parser.add_argument("--no-alias", action="store_true", help="write only the CPU plan's filename, not both")
    args = parser.parse_args()

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    workdir: Path = args.workdir or (out / ".src")
    workdir.mkdir(parents=True, exist_ok=True)

    encoder = fetch_sources(args.repo, args.revision, workdir)

    primary = out / NAME_FOR_PLAN["cpu-int8"]
    quantize(encoder, primary, args.bits, args.block_size)
    verify(primary)

    for name in (DECODER, VOCAB):
        shutil.copyfile(workdir / name, out / name)

    if not args.no_alias:
        # Both plans then load these identical weights, which makes GPU vs CPU
        # a clean A/B on speed alone.
        shutil.copyfile(primary, out / NAME_FOR_PLAN["gpu-fp16"])

    print(f"\nWrote to {out.resolve()}:")
    for path in sorted(out.iterdir()):
        if path.is_file():
            print(f"  {path.name:34} {path.stat().st_size / 1e6:8.1f} MB")
    print(
        "\nServe that directory, then build the frontend with\n"
        f"  VITE_PARAKEET_MODEL_BASE=<url of {out.name}/> pnpm -C frontend build\n"
        f"The fp32 source is still in {workdir}; delete it to reclaim the space."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
