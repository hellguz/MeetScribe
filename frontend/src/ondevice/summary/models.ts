/**
 * Which models the experimental on-device summariser offers.
 *
 * Two families, both loaded text-only through `AutoModelForCausalLM`:
 *
 * Gemma 4 E4B (Apr 2026) is Google's on-device size — 8B weights on disk,
 * ~4.5B effective — and the one Google itself pitches for local
 * summarisation. Independent comparisons put its writing at or above
 * Qwen3.5-4B, which is why it sits first. 128k context, sliding-window
 * attention on most layers so the KV cache stays small, and a thought
 * channel that the chat template's `enable_thinking` switches on and off.
 * It goes through transformers.js's generic decoder path, which
 * Qwen3.5 does not (see `patchQwen3_5` in the worker), so on ONNX
 * Runtime's WebGPU kernels its prefill may well be faster; that is
 * unmeasured until someone runs it.
 *
 * Qwen3.5 (Feb 2026) is the newest Qwen generation that ships small dense
 * sizes at all — 3.6 and 3.8 are 27B dense and 35B-A3B MoE, far past what a
 * browser tab can hold — and the only one with ONNX conversions. All three
 * sizes share the architecture: mostly Gated DeltaNet (linear attention)
 * with every fourth layer full attention, so the KV cache stays small even
 * over a 30k-token transcript, which is the whole reason a 4B model can
 * take a two-hour meeting in one pass. 262k native context, 201 languages.
 *
 * These repos are natively multimodal (there is a vision encoder in each).
 * We never download it: loading through `AutoModelForCausalLM` while the
 * config declares `Qwen3_5ForConditionalGeneration` puts transformers.js in
 * text-only mode, which drops the vision session from the manifest.
 *
 * `bytes` is the q4f16 text-only footprint — decoder + embeddings +
 * tokenizer — measured against the Hugging Face API on 2026-09-04. It only
 * feeds the "~N GB once, then cached" hint; the real figure is reported
 * from the download itself.
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
		id: 'onnx-community/gemma-4-E4B-it-ONNX',
		label: 'Gemma 4 E4B',
		// Measured from a real download on 2026-09-09. 8B parameters on
		// disk: the "effective 4B" excludes per-layer embeddings, which are
		// cheap to run but still have to live in GPU memory.
		bytes: 4_910_000_000,
		note: 'Quality pick, but 8B weights: needs a discrete GPU. On an integrated GPU it pages weights every token (0.6 tok/s measured on Intel Xe-LPG).',
	},
	{
		id: 'onnx-community/Qwen3.5-4B-ONNX-OPT',
		label: 'Qwen3.5 4B',
		bytes: 2_821_000_000,
		note: 'MMLU-Pro 79.1 — the smallest size worth comparing against Claude. Slow to read long transcripts on WebGPU.',
	},
	{
		id: 'onnx-community/Qwen3.5-2B-ONNX-OPT',
		label: 'Qwen3.5 2B',
		bytes: 1_403_000_000,
		note: 'Half the download and roughly twice the speed. Expect weaker structure and attribution.',
	},
	{
		id: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',
		label: 'Qwen3.5 0.8B',
		bytes: 603_000_000,
		note: 'Loads almost anywhere. Useful for proving the pipeline works, not for judging quality.',
	},
]

/**
 * Qwen3.5-4B stays the default: it is the one that has been run end to end
 * here. Gemma is a pick, not a switch, until its speed on ORT-WebGPU is
 * measured.
 */
export const DEFAULT_SUMMARY_MODEL = 'onnx-community/Qwen3.5-4B-ONNX-OPT'

export const modelById = (id: string): SummaryModel | undefined => SUMMARY_MODELS.find((m) => m.id === id)

/** "Qwen3.5-4B" / "gemma-4-E4B-it" — for a tab label, where the org prefix is noise. */
export const shortModelName = (id: string): string => id.split('/').pop()?.replace(/-ONNX(-OPT)?$/, '') ?? id
