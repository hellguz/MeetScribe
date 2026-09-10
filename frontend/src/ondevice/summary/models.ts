/**
 * The model the experimental on-device summariser runs.
 *
 * One entry, deliberately. Qwen3-4B (Apr 2025) is a plain dense decoder,
 * which is exactly why it wins: transformers.js runs it on the generic,
 * well-fused ONNX Runtime WebGPU path, and it needs none of the input
 * corrections a multimodal architecture does. 32k native context (40k with
 * YaRN), comfortably more than a two-hour transcript. The `webgpu/` org
 * hosts the q4f16-only export, which is why the repo is 3 GB rather than
 * the 20 GB every-dtype one under `onnx-community/`.
 *
 * Measured on one 1.2k-token meeting, same prompt, q4f16 throughout:
 *
 *   Apple M-series (Metal)          255 tok/s prefill, 35.9 tok/s decode
 *   RTX 5070 laptop (D3D12)         144 tok/s prefill, 29.8 tok/s decode
 *   Intel Arc iGPU (D3D12)          186 tok/s prefill,  8.8 tok/s decode
 *
 * Chrome on Windows reaches the discrete GPU only when the user enables
 * chrome://flags/#force-high-performance-gpu; `powerPreference` is ignored
 * there. Decode on Windows stays around a tenth of what the hardware could
 * do because Dawn's subgroup-matrix path, which is what reaches the tensor
 * cores, does not exist on D3D12. That is a browser limit, not ours.
 *
 * Tried and dropped, so nobody re-litigates it:
 *
 *   Qwen3.5-4B     newer and smarter, but its hybrid attention layers and
 *                  248k vocabulary hit unfused WebGPU kernels: ~3× slower
 *                  decode and ~20× slower prompt reading than Qwen3-4B on
 *                  the same GPU, and it needed a Qwen2-VL input patch to
 *                  work at all.
 *   Gemma 4 E4B    8B weights on disk (4.9 GB); pages every token on an
 *                  integrated GPU, measured at 0.6 tok/s.
 *   Qwen3.5 2B/0.8B  fast enough, not good enough.
 *
 * `bytes` is the q4f16 download. It only feeds the "~N GB once, then
 * cached" hint; the real figure is reported from the download itself.
 */

export interface SummaryModel {
	id: string
	/** Chip label. */
	label: string
	/** Rough q4f16 text-only download. */
	bytes: number
	/** Why someone would pick this one. */
	note: string
	/**
	 * How many `.onnx_data` files each ONNX file is split across, when the
	 * repo's own `transformers.js_config` gets it wrong.
	 *
	 * transformers.js does not read the split from the graph; it trusts
	 * `use_external_data_format` in config.json and fetches
	 * `NAME.onnx_data`, `NAME.onnx_data_1`, … up to that count. A repo that
	 * declares one number for every dtype over-counts the small ones:
	 * `webgpu/Qwen3-4B-ONNX` says 2, which is right for fp16 and wrong for
	 * q4f16, whose weights are one file — so loading died on a 404 for
	 * `model_q4f16.onnx_data_1` after downloading all 3 GB.
	 *
	 * Keyed by ONNX file name, matching the option transformers.js takes.
	 * Set it only where the repo is wrong; leaving it out trusts the repo.
	 */
	externalDataChunks?: Record<string, number>
}

export const SUMMARY_MODELS: SummaryModel[] = [
	{
		id: 'webgpu/Qwen3-4B-ONNX',
		label: 'Qwen3 4B',
		bytes: 3_050_000_000,
		note: 'Dense 4B on the optimised WebGPU kernel path — the fastest browser summariser we measured at a quality worth reading.',
		// The repo declares 2 data files for every dtype; q4f16 has one.
		externalDataChunks: { 'model_q4f16.onnx': 1 },
	},
]

/** The only model; anyone whose browser stored a dropped one lands here. */
export const DEFAULT_SUMMARY_MODEL = SUMMARY_MODELS[0].id

export const modelById = (id: string): SummaryModel | undefined => SUMMARY_MODELS.find((m) => m.id === id)

/** "Qwen3-4B" — for a tab label, where the org prefix is noise. Older
 * runs are stored under the ids of models no longer offered, so this still
 * has to handle any of them. */
export const shortModelName = (id: string): string => id.split('/').pop()?.replace(/-ONNX(-OPT)?$/, '') ?? id
