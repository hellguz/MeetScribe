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
WebGPU as well as on CPU, so one file can serve both paths.

8 bits, not 4: measured through six stacked layers, 8-bit weight-only came
out at 1.6% relative error while 4-bit hit 24%. 4-bit is not usable here.

Measured on the real encoder
────────────────────────────
By scripts/eval_parakeet_encoders.py, against the fp32 encoder over 47 s of
speech (six clips, English and Spanish), everything on the CPU:

                    size    CPU speed   encoder error   WER
    fp32           2477 MB    7.2-7.8x       —           —
    weight-only     896 MB    3.2-3.9x      1.8%        0.0%
    + convs folded  672 MB    2.8x          1.9%        0.0%
    dynamic int8    652 MB    7.6-9.3x     44.0%        1.8%

The accuracy case is settled: weight-only int8 reproduces the fp32
transcripts word for word, in both languages, either way. Two costs came out
worse than predicted:

  * Size needed the conv fold to reach ~0.65 GB. Plain weight-only leaves
    302 MB of pointwise Conv weights in fp32 — see fold_pointwise_convs.
  * CPU speed drops ~2.5x against the dynamic int8 file, because
    MatMulNBits dequantizes per block on every pass while MatMulInteger
    runs as a straight int8 GEMM. Folding the convs costs a further ~28%,
    trading it for the 224 MB.

What is still unmeasured is the WebGPU side, the reason the file exists:
MatMulNBits has a WebGPU kernel and the dynamic int8 ops have none.


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


def fold_pointwise_convs(model) -> int:
    """Rewrite every 1x1 grouped-by-1 Conv as Transpose-MatMul-Transpose.

    A pointwise conv over [N, C_in, T] is arithmetically a MatMul: each time
    step is multiplied by the same [C_in, C_out] matrix. ONNX keeps them as
    Conv, and MatMulNBitsQuantizer only rewrites MatMul — so in the Parakeet
    encoder the 48 pointwise convs of the conformer conv modules (302 MB of
    the 2.4 GB) would stay fp32 and dominate the quantized file.

    MatMul contracts over the *last* axis, so the channel axis has to come
    last: hence a Transpose on either side. Those are bandwidth, not
    arithmetic, and the conformer conv module already transposes around this
    block, so ORT's transpose optimizer cancels most of them at load.

    Depthwise convs (group == channels) are left alone: they hold little
    weight and are not matrix products. Returns the number folded.
    """
    import numpy as np
    from onnx import helper, numpy_helper

    graph = model.graph
    initializers = {init.name: init for init in graph.initializer}
    produced_here = set()
    new_nodes = []
    folded = 0

    for node in graph.node:
        weight = initializers.get(node.input[1]) if node.op_type == "Conv" and len(node.input) >= 2 else None
        attrs = {a.name: list(a.ints) if a.ints else a.i for a in node.attribute}
        eligible = (
            weight is not None
            and len(weight.dims) == 3  # [C_out, C_in, 1] — the 1-D convs
            and weight.dims[2] == 1
            and attrs.get("group", 1) == 1
            and attrs.get("strides", [1]) == [1]
            and attrs.get("dilations", [1]) == [1]
            and not any(attrs.get("pads", [0, 0]))
        )
        if not eligible:
            new_nodes.append(node)
            continue

        base = node.name or f"conv_{folded}"
        x, out = node.input[0], node.output[0]

        # [C_out, C_in, 1] -> [C_in, C_out], the B operand of a MatMul.
        w = numpy_helper.to_array(weight).reshape(weight.dims[0], weight.dims[1]).T
        w_name = f"{base}/matmul_weight"
        graph.initializer.append(numpy_helper.from_array(np.ascontiguousarray(w), w_name))

        pre, mm, post = f"{base}/nct", f"{base}/matmul", f"{base}/ntc"
        new_nodes.append(helper.make_node("Transpose", [x], [pre], name=f"{base}/pre", perm=[0, 2, 1]))
        new_nodes.append(helper.make_node("MatMul", [pre, w_name], [mm], name=mm))
        last = mm
        if len(node.input) > 2:  # bias [C_out] broadcasts over the last axis
            last = f"{base}/biased"
            new_nodes.append(helper.make_node("Add", [mm, node.input[2]], [last], name=f"{base}/add"))
        new_nodes.append(helper.make_node("Transpose", [last], [out], name=f"{base}/post", perm=[0, 2, 1]))

        produced_here.update({pre, mm, last})
        folded += 1

    if not folded:
        return 0

    del graph.node[:]
    graph.node.extend(new_nodes)
    # Drop the now-unused Conv weights, then let ONNX re-derive shapes for the
    # tensors we introduced.
    keep = {name for node in graph.node for name in node.input}
    stale = [init for init in graph.initializer if init.name not in keep]
    for init in stale:
        graph.initializer.remove(init)
    graph.value_info.extend(helper.make_empty_tensor_value_info(name) for name in sorted(produced_here))
    # No onnx.checker here: it serializes the model to bytes, and the fp32
    # encoder is over the 2 GB protobuf limit. The quantized result is checked
    # for real by verify(), which loads it in ONNX Runtime.
    return folded


def quantize(encoder_path: Path, out_path: Path, bits: int, block_size: int, fold_convs: bool = True) -> None:
    import onnx
    from onnxruntime.quantization import matmul_nbits_quantizer as q

    print(f"[load] {encoder_path.name} ({encoder_path.stat().st_size / 1e6:.0f} MB)")
    model = onnx.load(str(encoder_path))
    if fold_convs:
        folded = fold_pointwise_convs(model)
        print(f"[fold] {folded} pointwise Conv -> MatMul" if folded else "[fold] no pointwise Conv found")
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


def write_model_card(out: Path, repo: str, bits: int, block_size: int, folded: bool) -> None:
    """Write a Hugging Face model card, so `out` can be uploaded as-is."""
    sizes = "\n".join(f"| `{p.name}` | {p.stat().st_size / 1e6:.0f} MB |" for p in sorted(out.iterdir()) if p.is_file() and p.suffix in (".onnx", ".txt"))
    (out / "README.md").write_text(
        f"""---
license: cc-by-4.0
base_model: {repo}
library_name: onnx
pipeline_tag: automatic-speech-recognition
tags: [onnx, onnxruntime-web, webgpu, parakeet, tdt, asr, quantized]
---

# Parakeet TDT 0.6B v3 — weight-only int{bits} encoder (ONNX)

The encoder of [{repo}](https://huggingface.co/{repo}), requantized so that
**one file runs on both WebGPU and CPU** in ONNX Runtime Web. Built by
[MeetScribe](https://github.com/hellguz/MeetScribe)'s
`scripts/quantize_parakeet_encoder.py`; the decoder and vocabulary here are
copied from the base repo unchanged.

The upstream int8 encoder is *dynamically* quantized — weights and
activations both — which compiles to `MatMulInteger` and
`DynamicQuantizeLinear`. Neither op has a WebGPU kernel, so that file is
CPU-only, and quantizing activations costs real accuracy. This build keeps
int{bits} **weights** and fp16 arithmetic, which compiles to `MatMulNBits`
(block size {block_size}) — implemented on WebGPU and on CPU.

{"Pointwise convolutions are rewritten as MatMul before quantizing, so the conformer conv modules quantize too instead of staying fp32." if folded else "Pointwise convolutions are left as Conv, so their weights stay fp32."}

| file | size |
|---|---|
{sizes}

## Accuracy

Against the fp32 encoder over 47 s of English and Spanish speech: **{"1.9" if folded else "1.8"}%**
encoder output error, and **identical transcripts on every clip** (0.0% WER).
The upstream dynamic int8 encoder scores 44% encoder error on the same audio.

## Use

Same interface as the base repo — `parakeet.js` or any ONNX Runtime Web
setup. Inputs `audio_signal` [B, 128, T] (NeMo log-mel) and `length`;
outputs `outputs` [B, 1024, T/8] and `encoded_lengths`. The identical
weights are stored under both `encoder-model.int8.onnx` and
`encoder-model.fp16.onnx` so a loader that picks a file per device gets this
build either way.

In MeetScribe, point the frontend at this repo:

```
VITE_PARAKEET_MODEL_BASE=https://huggingface.co/<user>/<repo>/resolve/main/
```
""",
        encoding="utf-8",
    )

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("parakeet-q8"), help="directory to write the servable model files into")
    parser.add_argument("--workdir", type=Path, default=None, help="where to keep the fp32 download (default: <out>/.src)")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Hugging Face repo holding the fp32 encoder")
    parser.add_argument("--revision", default=None, help="pin a branch instead of trying main then the fp16 branch")
    parser.add_argument("--bits", type=int, default=8, choices=(4, 8), help="weight width; 4 measured 24%% error, so 8 unless you are experimenting")
    parser.add_argument("--block-size", type=int, default=128, help="weights per quantization block")
    parser.add_argument("--no-alias", action="store_true", help="write only the CPU plan's filename, not both")
    parser.add_argument("--no-fold-convs", action="store_true", help="leave the pointwise convs as Conv, so they stay fp32 (~230 MB larger)")
    args = parser.parse_args()

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    workdir: Path = args.workdir or (out / ".src")
    workdir.mkdir(parents=True, exist_ok=True)

    encoder = fetch_sources(args.repo, args.revision, workdir)

    primary = out / NAME_FOR_PLAN["cpu-int8"]
    quantize(encoder, primary, args.bits, args.block_size, fold_convs=not args.no_fold_convs)
    verify(primary)

    for name in (DECODER, VOCAB):
        shutil.copyfile(workdir / name, out / name)

    if not args.no_alias:
        # Both plans then load these identical weights, which makes GPU vs CPU
        # a clean A/B on speed alone.
        shutil.copyfile(primary, out / NAME_FOR_PLAN["gpu-fp16"])

    write_model_card(out, args.repo, args.bits, args.block_size, not args.no_fold_convs)

    print(f"\nWrote to {out.resolve()}:")
    for path in sorted(out.iterdir()):
        if path.is_file():
            print(f"  {path.name:34} {path.stat().st_size / 1e6:8.1f} MB")
    print(
        "\nServe that directory, then build the frontend with\n"
        f"  VITE_PARAKEET_MODEL_BASE=<url of {out.name}/> pnpm -C frontend build\n"
        "\nOr host it on Hugging Face, whose CDN already sends the CORS headers\n"
        "the app needs (README.md is a model card for exactly that):\n"
        f"  hf upload <user>/<repo> {out} . --repo-type=model\n"
        f"  VITE_PARAKEET_MODEL_BASE=https://huggingface.co/<user>/<repo>/resolve/main/\n"
        f"\nThe fp32 source is still in {workdir}; delete it to reclaim the space."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
