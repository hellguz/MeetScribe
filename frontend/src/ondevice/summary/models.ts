/**
 * Which models the experimental on-device summariser offers.
 *
 * Both are loaded through `AutoModelForCausalLM`, both switch reasoning
 * with the chat template's `enable_thinking`, and both fit an integrated
 * laptop GPU.
 *
 * Qwen3-4B (Apr 2025) is the speed pick. It is a plain dense decoder that
 * transformers.js runs on its generic, well-fused ONNX Runtime WebGPU path;
 * the library's own issue tracker measures it at ~3× the decode speed and
 * ~20× the prompt-reading speed of Qwen3.5-4B on the same GPU. 32k native
 * context (40k with YaRN), enough for a two-hour transcript. The `webgpu/`
 * org hosts the q4f16-only export, which is why the repo is 3 GB rather
 * than the 20 GB every-dtype one under `onnx-community/`.
 *
 * Qwen3.5-4B (Feb 2026) is the newer generation: mostly Gated DeltaNet
 * (linear attention) with every fourth layer full attention, so the KV
 * cache stays small over a 30k-token transcript, and 262k native context.
 * It scores higher on knowledge benchmarks, but its hybrid layers and 248k
 * vocabulary hit unfused kernels on WebGPU today, which makes reading a
 * long transcript painfully slow. Kept for quality comparisons.
 *
 * Tried and dropped: Gemma 4 E4B (8B weights on disk, 4.9 GB, pages every
 * token on an integrated GPU — 0.6 tok/s measured), and Qwen3.5 2B/0.8B
 * (fast enough, not good enough).
 *
 * `bytes` is the q4f16 text-only footprint — decoder + embeddings +
 * tokenizer. It only feeds the "~N GB once, then cached" hint; the real
 * figure is reported from the download itself.
 */

export interface SummaryModel {
	id: string
	/** Chip label. */
	label: string
	/** Rough q4f16 text-only download. */
	bytes: number
	/** Why someone would pick this one. */
	note: string
}

export const SUMMARY_MODELS: SummaryModel[] = [
	{
		id: 'webgpu/Qwen3-4B-ONNX',
		label: 'Qwen3 4B',
		// Whole-repo size as listed on Hugging Face (q4f16 only).
		bytes: 3_050_000_000,
		note: 'Fastest 4B on WebGPU: plain attention on the optimised kernel path. Reads a transcript many times faster than Qwen3.5.',
	},
	{
		id: 'onnx-community/Qwen3.5-4B-ONNX-OPT',
		label: 'Qwen3.5 4B',
		bytes: 2_821_000_000,
		note: 'Newer generation, higher benchmark scores, but slow to read long transcripts on WebGPU today.',
	},
]

/** Speed decides the default; anyone stored on a dropped model lands here too. */
export const DEFAULT_SUMMARY_MODEL = SUMMARY_MODELS[0].id

export const modelById = (id: string): SummaryModel | undefined => SUMMARY_MODELS.find((m) => m.id === id)

/** "Qwen3-4B" — for a tab label, where the org prefix is noise. */
export const shortModelName = (id: string): string => id.split('/').pop()?.replace(/-ONNX(-OPT)?$/, '') ?? id
