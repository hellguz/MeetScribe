/**
 * Runs Qwen3.5 over a meeting transcript, in this tab, on the GPU.
 *
 *   prompt (from the server, byte-for-byte the one Claude gets)
 *     │
 *     ├─ apply_chat_template ──▶ input_ids           measured: promptTokens
 *     │
 *     └─ model.generate ──▶ TextStreamer ──▶ 'token' messages to the page
 *            │
 *            first token ends the prefill            measured: prefillMs
 *            the rest is decode                      measured: decodeMs
 *
 * Everything runs here rather than on the main thread because prefilling
 * 30k tokens blocks whatever thread it is on for tens of seconds.
 *
 * This worker deliberately loads its own copy of ONNX Runtime — the build
 * transformers.js pins, reached through its own dependency tree. It never
 * touches `ondevice/ortSetup.ts`, which configures the separate 1.29 build
 * Parakeet needs. Two ORT builds in one app is fine as long as they never
 * share a thread, and these do not: the summariser and the transcriber are
 * different workers.
 */
import { AutoModelForCausalLM, AutoTokenizer, TextStreamer, env } from '@huggingface/transformers'
import type { PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers'

/** Self-hosting: same idea as VITE_PARAKEET_MODEL_BASE, for the LLM files. */
const MODEL_BASE = (import.meta.env.VITE_SUMMARY_MODEL_BASE as string | undefined) || ''
if (MODEL_BASE) env.remoteHost = MODEL_BASE

// Weights live in the Cache API under their own key, so clearing the
// summariser's few GB never takes Parakeet's model with it.
env.cacheKey = 'meetscribe-summary-cache'

// Where ONNX Runtime's own wasm + glue come from.
//
// Left alone, transformers.js points these at jsdelivr, pinned to the exact
// ORT build it depends on — which is the safe default, because the glue and
// the binary have to be the same version and only it knows which that is.
// We cannot serve them from our bundle instead: a `?url` import of
// "onnxruntime-web" would resolve to this project's 1.29, whose binary does
// not match transformers' glue.
//
// So the escape hatch is a mirror: copy ort-wasm-simd-threaded.asyncify.
// {mjs,wasm} (plus the non-asyncify pair for Safari) out of
// node_modules/@huggingface/transformers' nested onnxruntime-web and set
// VITE_ORT_WASM_BASE to wherever they are served from. Needed only where
// the deployment must not reach a CDN at runtime.
const ORT_WASM_BASE = (import.meta.env.VITE_ORT_WASM_BASE as string | undefined) || ''
if (ORT_WASM_BASE) {
	const base = ORT_WASM_BASE.endsWith('/') ? ORT_WASM_BASE : `${ORT_WASM_BASE}/`
	// Safari cannot run the asyncify build; transformers.js makes the same split.
	const stem = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ? 'ort-wasm-simd-threaded' : 'ort-wasm-simd-threaded.asyncify'
	env.backends.onnx.wasm!.wasmPaths = { mjs: `${base}${stem}.mjs`, wasm: `${base}${stem}.wasm` }
}

/** Only quantization we offer: 4-bit weights, fp16 activations, WebGPU. */
const DTYPE = 'q4f16'

export interface SummarizeRequest {
	type: 'summarize'
	prompt: string
	model: string
	thinking: boolean
	maxNewTokens: number
}

export type SummarizerRequest = SummarizeRequest

export type SummarizerResponse =
	| { type: 'log'; line: string }
	| { type: 'status'; text: string }
	/** Aggregate over every file transformers.js is fetching. */
	| { type: 'download'; loaded: number; total: number }
	| { type: 'loaded'; device: string; dtype: string; loadMs: number; downloadBytes: number; downloadMs: number; cached: boolean }
	| { type: 'prefilled'; promptTokens: number; prefillMs: number }
	| { type: 'token'; text: string }
	| { type: 'done'; text: string; outputTokens: number; decodeMs: number; totalMs: number; truncated: boolean }
	| { type: 'error'; message: string }

const post = (msg: SummarizerResponse) => self.postMessage(msg)

/**
 * Loading a multi-gigabyte model is slow enough that a second run against
 * the same model must not repeat it. Keyed by model id, so choosing a
 * different size loads afresh and frees the old one first.
 */
let loaded: {
	key: string
	tokenizer: PreTrainedTokenizer
	model: PreTrainedModel
	device: string
	dtype: string
	loadMs: number
	downloadBytes: number
	downloadMs: number
	cached: boolean
} | null = null

async function load(modelId: string) {
	if (loaded?.key === modelId) return loaded

	// A model already in memory is a couple of GB we are about to need again.
	if (loaded) {
		try {
			await loaded.model.dispose()
		} catch {
			/* best effort: the point is to free VRAM, not to be exact */
		}
		loaded = null
	}

	const startedAt = performance.now()
	let downloadBytes = 0
	let downloadMs = 0
	let firstByteAt: number | null = null

	const progress_callback = (info: { status: string; loaded?: number; total?: number; file?: string }) => {
		if (info.status === 'progress_total' && typeof info.loaded === 'number' && typeof info.total === 'number') {
			if (firstByteAt === null) firstByteAt = performance.now()
			downloadBytes = info.loaded
			downloadMs = performance.now() - firstByteAt
			post({ type: 'download', loaded: info.loaded, total: info.total })
		} else if (info.status === 'initiate' && info.file) {
			post({ type: 'log', line: `fetch ${info.file}` })
		}
	}

	post({ type: 'status', text: 'Loading tokenizer…' })
	const tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback })

	post({ type: 'status', text: 'Loading model…' })
	// `AutoModelForCausalLM` against a repo whose config declares
	// `Qwen3_5ForConditionalGeneration` is what puts transformers.js into
	// text-only mode, which drops the vision encoder from the file
	// manifest — worth ~200 MB of download we would never use. Do not
	// "fix" this to AutoModelForImageTextToText.
	const model = await AutoModelForCausalLM.from_pretrained(modelId, {
		dtype: DTYPE,
		device: 'webgpu',
		progress_callback,
	})

	loaded = {
		key: modelId,
		tokenizer,
		model,
		device: 'webgpu',
		dtype: DTYPE,
		loadMs: performance.now() - startedAt,
		downloadBytes,
		downloadMs: Math.round(downloadMs),
		// No progress events at all means every file came from the cache.
		cached: firstByteAt === null,
	}
	post({
		type: 'loaded',
		device: loaded.device,
		dtype: loaded.dtype,
		loadMs: Math.round(loaded.loadMs),
		downloadBytes: loaded.downloadBytes,
		downloadMs: loaded.downloadMs,
		cached: loaded.cached,
	})
	return loaded
}

/**
 * With thinking on, the model emits `<think>…</think>` before the summary.
 * The reasoning is worth watching as it streams but must not reach the
 * stored markdown, where it would be compared against Claude's prose.
 */
function stripThinking(text: string): string {
	const end = text.lastIndexOf('</think>')
	return (end === -1 ? text : text.slice(end + '</think>'.length)).trim()
}

async function summarize(req: SummarizeRequest) {
	const { tokenizer, model } = await load(req.model)

	post({ type: 'status', text: 'Reading the transcript…' })
	const inputs = tokenizer.apply_chat_template([{ role: 'user', content: req.prompt }], {
		add_generation_prompt: true,
		return_dict: true,
		// Not in the typed options: extra keys are passed straight through
		// to the Jinja template, whose `enable_thinking is false` branch
		// prefills an empty <think> block and so skips reasoning.
		enable_thinking: req.thinking,
	} as unknown as Parameters<typeof tokenizer.apply_chat_template>[1]) as unknown as { input_ids: { dims: number[] } }

	const promptTokens = inputs.input_ids.dims.at(-1) ?? 0

	const generateStartedAt = performance.now()
	let prefillMs: number | null = null
	let text = ''
	let streamedTokens = 0

	const streamer = new TextStreamer(tokenizer, {
		skip_prompt: true,
		skip_special_tokens: true,
		callback_function: (chunk: string) => {
			// The first chunk is the moment prefill finished — the number
			// that decides whether a two-hour meeting is viable at all.
			if (prefillMs === null) {
				prefillMs = performance.now() - generateStartedAt
				post({ type: 'prefilled', promptTokens, prefillMs: Math.round(prefillMs) })
			}
			text += chunk
			post({ type: 'token', text: chunk })
		},
		token_callback_function: (tokens: bigint[]) => {
			streamedTokens += tokens.length
		},
	})

	const output = await model.generate({
		...inputs,
		max_new_tokens: req.maxNewTokens,
		// The summary templates are strict about structure, and sampling at
		// the model card's defaults (temp 0.6, top_p 0.95) reworded headings
		// between runs. Greedy is reproducible, which a comparison needs.
		do_sample: false,
		streamer,
	} as unknown as Parameters<typeof model.generate>[0])

	const totalMs = performance.now() - generateStartedAt

	// `generate` returns the whole sequence, prompt included, so the
	// generated length is the difference. Anything that reached the cap was
	// cut off mid-sentence rather than ending on an EOS token.
	const dims = (output as { dims?: number[] })?.dims
	const outputTokens = dims ? (dims.at(-1) ?? 0) - promptTokens : streamedTokens

	post({
		type: 'done',
		text: stripThinking(text),
		outputTokens,
		decodeMs: Math.round(totalMs - (prefillMs ?? 0)),
		totalMs: Math.round(totalMs),
		truncated: outputTokens >= req.maxNewTokens,
	})
}

self.addEventListener('message', async (event: MessageEvent<SummarizerRequest>) => {
	try {
		await summarize(event.data)
	} catch (e) {
		post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
	}
})

// ONNX Runtime and transformers.js report real problems through console
// rather than by throwing, and a worker's console is easy to miss. Mirror
// it into the panel's log, the same trick parakeet.worker.ts uses.
for (const level of ['warn', 'error'] as const) {
	const original = console[level].bind(console)
	console[level] = (...args: unknown[]) => {
		original(...args)
		post({ type: 'log', line: `[${level}] ${args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')}` })
	}
}
