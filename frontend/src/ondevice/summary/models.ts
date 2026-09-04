/**
 * Which models the experimental on-device summariser offers.
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
		id: 'onnx-community/Qwen3.5-4B-ONNX-OPT',
		label: '4B',
		bytes: 2_821_000_000,
		note: 'Best quality. MMLU-Pro 79.1 — the smallest size worth comparing against Claude.',
	},
	{
		id: 'onnx-community/Qwen3.5-2B-ONNX-OPT',
		label: '2B',
		bytes: 1_403_000_000,
		note: 'Half the download and roughly twice the speed. Expect weaker structure and attribution.',
	},
	{
		id: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',
		label: '0.8B',
		bytes: 603_000_000,
		note: 'Loads almost anywhere. Useful for proving the pipeline works, not for judging quality.',
	},
]

export const DEFAULT_SUMMARY_MODEL = SUMMARY_MODELS[0].id

export const modelById = (id: string): SummaryModel | undefined => SUMMARY_MODELS.find((m) => m.id === id)

/** "Qwen3.5-4B" — for a tab label, where the org prefix is noise. */
export const shortModelName = (id: string): string => id.split('/').pop()?.replace(/-ONNX(-OPT)?$/, '') ?? id
