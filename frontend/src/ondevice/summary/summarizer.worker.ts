/**
 * Runs Qwen3-4B over a meeting transcript, in this tab, on the GPU.
 *
 *   prompt (from the server, byte-for-byte the one Claude gets)
 *     │
 *     ├─ apply_chat_template ──▶ input_ids           measured: promptTokens
 *     │
 *     ├─ chunked prefill ──▶ KV cache                (one chunk at a time)
 *     │
 *     └─ model.generate ──▶ TextStreamer ──▶ 'token' messages to the page
 *            │
 *            first token ends the prefill            measured: prefillMs
 *            the rest is decode                      measured: decodeMs
 *
 * Everything runs here rather than on the main thread because prefilling
 * 30k tokens blocks whatever thread it is on for tens of seconds.
 *
 * Prefill is fed to the model in slices rather than all at once, because
 * every tensor inside a forward pass is as wide as what you hand it. The
 * expensive one is the decoder's own output: it emits logits for *every*
 * position it is given, so an 18k-token transcript asks for an
 * 18014 × 151936 fp16 tensor — 5.5 GB in one allocation, which ONNX Runtime
 * refuses outright ("Tensor shape is too large") after having spent a while
 * trying, which is what makes the machine crawl. (transformers.js has a
 * `num_logits_to_keep` for exactly this, and the generic decoder path does
 * pass it, but only once a cache exists — the first pass over a long
 * prompt still asks for every row.) Slicing caps that at one chunk of positions and, as a
 * bonus, gives the panel something to count. The chunk is sized from the
 * GPU's own buffer limit, see `prefillChunkFor`.
 *
 * Nothing here leaves the machine: the weights come from a CDN once and
 * are cached, and the transcript never goes anywhere but this worker.
 *
 * This worker deliberately loads its own copy of ONNX Runtime — the build
 * transformers.js pins, reached through its own dependency tree. It never
 * touches `ondevice/ortSetup.ts`, which configures the separate 1.29 build
 * Parakeet needs. Two ORT builds in one app is fine as long as they never
 * share a thread, and these do not: the summariser and the transcriber are
 * different workers.
 */
import { AutoModelForCausalLM, AutoTokenizer, Tensor, TextStreamer, env } from '@huggingface/transformers'
import type { PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers'
import { modelById } from './models'

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

/**
 * How many prompt tokens go through the model in one forward pass.
 *
 * Sets the ceiling on transient memory during prefill: every intermediate
 * is this many tokens wide instead of the whole transcript, the discarded
 * logits (chunk × 151936 × fp16: 156 MB at 512, 312 MB at 1024, 624 MB at
 * 2048) included. Smaller is safer on a
 * small GPU and costs throughput, because each slice re-reads the KV cache
 * built so far and the launch overhead per slice is fixed.
 *
 * So the size follows the biggest buffer the adapter will hand out. The
 * thresholds leave the logits tensor at roughly a quarter of that limit,
 * which keeps room for the KV cache and the activations beside it:
 * integrated GPUs on current i7/i9 laptops report ~2 GB and get 1024,
 * discrete cards report 4 GB or more and get 2048, anything smaller (older
 * iGPUs, some phones) keeps the 512 that was the fixed value before.
 */
function prefillChunkFor(adapter: AdapterInfo): number {
	const limit = adapter.maxBufferSize ?? 0
	if (limit >= 4 * 1024 ** 3) return 2048
	if (limit >= 2 * 1024 ** 3) return 1024
	return 512
}

export interface SummarizeRequest {
	type: 'summarize'
	prompt: string
	model: string
	thinking: boolean
	maxNewTokens: number
}

/**
 * Fetch and warm the model without generating anything.
 *
 * The download is ~3 GB and a meeting is usually half an hour, so starting it
 * when the recording starts means the model is ready the moment the transcript
 * is. Starting it when the user reaches the summary page means watching a
 * progress bar for five minutes after the meeting they just sat through.
 */
export interface PreloadRequest {
	type: 'preload'
	model: string
}

export type SummarizerRequest = SummarizeRequest | PreloadRequest

/** What the run is actually executing on, asked of the browser itself. */
export interface AdapterInfo {
	vendor: string | null
	architecture: string | null
	device: string | null
	description: string | null
	/** Biggest single allocation the GPU will accept — the limit prefill lives under. */
	maxBufferSize: number | null
	maxStorageBufferBindingSize: number | null
}

export type SummarizerResponse =
	| { type: 'log'; line: string }
	| { type: 'status'; text: string }
	/** Sent before anything is downloaded, so the panel can name the hardware early. */
	| { type: 'device'; device: 'webgpu'; adapter: AdapterInfo | null; threads: number | null; cores: number | null }
	/** Aggregate over every file transformers.js is fetching. */
	| { type: 'download'; loaded: number; total: number; file: string | null }
	| { type: 'loaded'; device: string; dtype: string; loadMs: number; downloadBytes: number; downloadMs: number; cached: boolean }
	/** One per prefill slice: `processed` of `total` prompt tokens are in the cache. */
	| { type: 'prefill'; processed: number; total: number; ms: number }
	| { type: 'prefilled'; promptTokens: number; prefillMs: number }
	| { type: 'token'; text: string }
	/** Running count while writing, so the panel can show a live rate. */
	| { type: 'decode'; tokens: number; ms: number }
	| { type: 'done'; text: string; outputTokens: number; decodeMs: number; totalMs: number; truncated: boolean }
	| { type: 'preloaded'; cached: boolean }
	| { type: 'error'; message: string }

const post = (msg: SummarizerResponse) => self.postMessage(msg)

/** Bytes as GB/MB, for log lines. Panel numbers go through formatBytes. */
const gb = (n: number | null) => (n === null ? '?' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`)

/**
 * Ask the browser what we are about to run on, before spending 3 GB of
 * download finding out.
 *
 * "WebGPU is available" (`navigator.gpu` exists) and "WebGPU works here"
 * (an adapter can be had) are different questions — a machine with a
 * blocklisted driver answers yes to the first and no to the second — and
 * only the second one decides whether this feature runs. Returning the
 * adapter's own description also settles the question the panel used to
 * answer by assertion: which GPU, and how big an allocation it will take.
 */
async function probeDevice(): Promise<AdapterInfo | null> {
	// The project has no @webgpu/types; the shape we need is three fields
	// deep, so it is spelled out here the way `capabilities.ts` does it.
	type Adapter = { info?: Record<string, string | undefined>; limits?: Record<string, number | undefined> }
	const gpu = (navigator as Navigator & { gpu?: { requestAdapter(options?: { powerPreference?: string }): Promise<Adapter | null> } }).gpu
	if (!gpu) return null
	let adapter: Adapter | null = null
	try {
		adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
	} catch {
		return null
	}
	if (!adapter) return null
	const info = adapter.info ?? null
	return {
		vendor: info?.vendor || null,
		architecture: info?.architecture || null,
		device: info?.device || null,
		description: info?.description || null,
		maxBufferSize: adapter.limits?.maxBufferSize ?? null,
		maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize ?? null,
	}
}

/**
 * How many bytes of this model are already in our Cache API bucket.
 *
 * transformers.js reports progress identically whether the bytes come off
 * the network or out of the cache, which made a 5-second cache read look
 * like a 519 MB/s download. Asking the cache directly is the only way to
 * tell the two apart, and it is worth telling apart: the first run's cost
 * and every later run's cost are different questions.
 */
async function cachedBytesFor(modelId: string): Promise<number> {
	try {
		const cache = await caches.open(env.cacheKey)
		let bytes = 0
		for (const request of await cache.keys()) {
			if (!request.url.includes(modelId)) continue
			const hit = await cache.match(request)
			bytes += Number(hit?.headers.get('content-length') ?? 0)
		}
		return bytes
	} catch {
		// No Cache API (private window, or a browser that walls it off in
		// workers): fall back to calling everything a download.
		return 0
	}
}

/**
 * Loading a multi-gigabyte model is slow enough that a second run against
 * the same model must not repeat it. Keyed by model id, so choosing a
 * different size loads afresh and frees the old one first.
 */
let loaded: {
	key: string
	tokenizer: PreTrainedTokenizer
	model: PreTrainedModel
	device: 'webgpu'
	dtype: string
	loadMs: number
	downloadBytes: number
	downloadMs: number
	cached: boolean
	adapter: AdapterInfo | null
	threads: number | null
	cores: number | null
	/** Chosen once per load from the adapter's buffer limit. */
	prefillChunk: number
} | null = null

/**
 * Re-send what the page needs to describe this model, every run.
 *
 * A second run against a model still in memory used to skip straight to
 * prefill, leaving the panel stuck on "Starting the model…" and the saved
 * row without a device or a load time. The facts have not changed, so say
 * them again.
 */
function announce(l: NonNullable<typeof loaded>) {
	post({ type: 'device', device: l.device, adapter: l.adapter, threads: l.threads, cores: l.cores })
	post({
		type: 'loaded',
		device: l.device,
		dtype: l.dtype,
		loadMs: Math.round(l.loadMs),
		downloadBytes: l.downloadBytes,
		downloadMs: l.downloadMs,
		cached: l.cached,
	})
}

async function load(modelId: string) {
	if (loaded?.key === modelId) {
		post({ type: 'log', line: `model already in memory (${modelId})` })
		announce(loaded)
		return loaded
	}

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
	let currentFile: string | null = null

	// Asked first: a 3 GB download is a rude way to discover there is no GPU.
	post({ type: 'status', text: 'Checking this device…' })
	const adapter = await probeDevice()
	const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? null
	const threads = env.backends.onnx.wasm?.numThreads ?? null
	if (!adapter) {
		throw new Error(
			'WebGPU did not give this browser a GPU adapter, and 4-bit weights on the CPU would take hours rather than minutes. ' +
				'Chrome or Edge on a desktop with an up-to-date driver, or Safari 26+.',
		)
	}
	post({ type: 'device', device: 'webgpu', adapter, threads, cores })
	post({
		type: 'log',
		line: `device: WebGPU · ${[adapter.vendor, adapter.architecture, adapter.device].filter(Boolean).join(' ') || 'unnamed adapter'} · max buffer ${gb(adapter.maxBufferSize)}`,
	})
	const prefillChunk = prefillChunkFor(adapter)
	post({ type: 'log', line: `model: ${modelId} · ${DTYPE} · prefill chunk ${prefillChunk} · ${cores ?? '?'} cores, ${threads ?? '?'} wasm threads` })

	const cachedBefore = await cachedBytesFor(modelId)
	post({
		type: 'log',
		line: cachedBefore > 0 ? `cache: ${gb(cachedBefore)} of this model already stored` : 'cache: empty for this model — first run downloads it',
	})

	const progress_callback = (info: { status: string; loaded?: number; total?: number; file?: string }) => {
		if (info.status === 'progress_total' && typeof info.loaded === 'number' && typeof info.total === 'number') {
			if (firstByteAt === null) firstByteAt = performance.now()
			downloadBytes = info.loaded
			downloadMs = performance.now() - firstByteAt
			post({ type: 'download', loaded: info.loaded, total: info.total, file: currentFile })
		} else if (info.status === 'initiate' && info.file) {
			currentFile = info.file
			post({ type: 'log', line: `fetch ${info.file}` })
		} else if (info.status === 'done' && info.file) {
			post({ type: 'log', line: `ready ${info.file}` })
		}
	}

	post({ type: 'status', text: 'Loading tokenizer…' })
	const tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback })

	post({ type: 'status', text: 'Loading model…' })
	// Qwen3 is a plain causal LM, so this is simply its class, and it goes
	// through the library's generic decoder path: that path slices already
	// cached tokens off the input itself and places each decode position at
	// `past_length`, which is what makes the chunked prefill below correct
	// without any per-architecture patching.
	// `use_external_data_format` overrides the repo's own config.json, which
	// is where a wrong weight-file count comes from. See the field's note.
	const externalDataChunks = modelById(modelId)?.externalDataChunks
	if (externalDataChunks) post({ type: 'log', line: `weight files: ${JSON.stringify(externalDataChunks)} (overriding this repo's config)` })
	const model = await AutoModelForCausalLM.from_pretrained(modelId, {
		dtype: DTYPE,
		device: 'webgpu',
		progress_callback,
		...(externalDataChunks ? { use_external_data_format: externalDataChunks } : {}),
	})
	post({ type: 'log', line: `model type ${String((model.config as { model_type?: string }).model_type ?? '?')}` })

	post({
		type: 'log',
		line: `sessions ready on WebGPU in ${Math.round(performance.now() - startedAt)}ms (${firstByteAt === null ? 'from cache' : `after ${gb(downloadBytes)} downloaded`})`,
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
		// Either nothing was fetched at all, or everything fetched was
		// already in the cache — a run that pulled less than a tokenizer's
		// worth of new bytes did not download this model.
		cached: firstByteAt === null || (cachedBefore > 0 && downloadBytes - cachedBefore < 50_000_000),
		adapter,
		threads,
		cores,
		prefillChunk,
	}
	announce(loaded)
	return loaded
}

/**
 * With thinking on, the model reasons inside `<think>…</think>` before the
 * summary. The reasoning is worth watching as it streams but must not reach
 * the stored markdown, where it would be compared against Claude's prose.
 *
 * The streamer runs with `skip_special_tokens` off so a model whose
 * markers are special tokens still shows them; the end-of-turn tokens that
 * would otherwise be dropped are removed here instead.
 */
const THINK_END_MARKERS = ['</think>']
const TURN_END_TOKENS = ['<end_of_turn>', '<eos>', '<|im_end|>', '<|endoftext|>']
function stripThinking(text: string): string {
	let out = text
	for (const marker of THINK_END_MARKERS) {
		const end = out.lastIndexOf(marker)
		if (end !== -1) out = out.slice(end + marker.length)
	}
	// A run that hit the token cap mid-thought has no closing marker; the
	// opening one then starts the text and everything after it is reasoning.
	for (const opener of ['<think>']) {
		if (out.trimStart().startsWith(opener)) return ''
	}
	for (const token of TURN_END_TOKENS) out = out.split(token).join('')
	return out.trim()
}

/**
 * Feed the prompt to the model `chunk` tokens at a time, returning the KV
 * cache for everything consumed.
 *
 * Each step is a `generate` capped at one token: transformers.js prefills
 * the slice, hands back `past_key_values`, and the sampled token is thrown
 * away (it is never fed back, so the cache holds prompt tokens only). The
 * next step passes the prompt truncated one chunk further along together
 * with that cache. That is the "past shorter than input_ids" case in
 * `decoder_prepare_inputs_for_generation`: the library slices off what the
 * cache already covers and derives the positions for the rest, so the
 * chunking is invisible to the model.
 *
 * Returns null when the prompt is short enough to prefill in one pass.
 */
async function prefillInChunks(model: PreTrainedModel, input_ids: Tensor, attention_mask: Tensor, promptTokens: number, chunk: number): Promise<unknown | null> {
	let past: unknown = null
	const startedAt = performance.now()
	if (promptTokens > chunk) post({ type: 'log', line: `prefill: ${promptTokens.toLocaleString()} tokens in ${Math.ceil(promptTokens / chunk)} slices of ${chunk}` })
	for (let consumed = chunk; consumed < promptTokens; consumed += chunk) {
		post({ type: 'prefill', processed: consumed - chunk, total: promptTokens, ms: performance.now() - startedAt })
		const out = (await model.generate({
			input_ids: input_ids.slice(null, [0, consumed]),
			attention_mask: attention_mask.slice(null, [0, consumed]),
			...(past ? { past_key_values: past } : {}),
			max_new_tokens: 1,
			do_sample: false,
			// Keeps the cache alive past the call — the default is to free
			// it, which is exactly what we are here to accumulate.
			return_dict_in_generate: true,
		} as unknown as Parameters<typeof model.generate>[0])) as unknown as { past_key_values: unknown }
		// Same object every time: transformers.js updates the cache in
		// place and disposes the GPU tensors it replaces.
		past = out.past_key_values
		post({ type: 'prefill', processed: consumed, total: promptTokens, ms: performance.now() - startedAt })
	}
	return past
}

async function summarize(req: SummarizeRequest) {
	const { tokenizer, model, prefillChunk } = await load(req.model)

	post({ type: 'status', text: 'Reading the transcript…' })
	const inputs = tokenizer.apply_chat_template([{ role: 'user', content: req.prompt }], {
		add_generation_prompt: true,
		return_dict: true,
		// Not in the typed options: extra keys are passed straight through
		// to the Jinja template, whose `enable_thinking is false` branch
		// prefills an empty <think> block and so skips reasoning.
		enable_thinking: req.thinking,
	} as unknown as Parameters<typeof tokenizer.apply_chat_template>[1]) as unknown as { input_ids: Tensor; attention_mask: Tensor }

	const promptTokens = inputs.input_ids.dims.at(-1) ?? 0

	// Prefill starts here, chunks included: the number worth reporting is
	// how long the transcript took to read, not just its last slice.
	const generateStartedAt = performance.now()
	let prefillMs: number | null = null
	let decodeStartedAt: number | null = null
	let text = ''
	let streamedTokens = 0

	const past = await prefillInChunks(model, inputs.input_ids, inputs.attention_mask, promptTokens, prefillChunk)

	const streamer = new TextStreamer(tokenizer, {
		skip_prompt: true,
		// Kept so any thinking markers reach `stripThinking`; the
		// end-of-turn tokens this lets through are removed there too.
		skip_special_tokens: false,
		callback_function: (chunk: string) => {
			// The first chunk is the moment prefill finished — the number
			// that decides whether a two-hour meeting is viable at all.
			if (prefillMs === null) {
				prefillMs = performance.now() - generateStartedAt
				decodeStartedAt = performance.now()
				post({ type: 'prefilled', promptTokens, prefillMs: Math.round(prefillMs) })
			}
			text += chunk
			post({ type: 'token', text: chunk })
		},
		token_callback_function: (tokens: bigint[]) => {
			streamedTokens += tokens.length
			// Cheap enough to send every token: the panel turns it into a
			// live rate, which is the number people actually watch.
			post({ type: 'decode', tokens: streamedTokens, ms: performance.now() - (decodeStartedAt ?? generateStartedAt) })
		},
	})

	const output = await model.generate({
		...inputs,
		// Whatever the chunk loop already read; the remaining tail of the
		// prompt is prefilled by this call.
		...(past ? { past_key_values: past } : {}),
		max_new_tokens: req.maxNewTokens,
		// The summary templates are strict about structure, and sampling at
		// the model card's defaults (temp 0.6, top_p 0.95) reworded headings
		// between runs. Greedy is reproducible, which a comparison needs.
		do_sample: false,
		streamer,
	} as unknown as Parameters<typeof model.generate>[0])

	const totalMs = performance.now() - generateStartedAt
	post({ type: 'log', line: `generated ${streamedTokens.toLocaleString()} tokens in ${Math.round(totalMs)}ms` })

	// Passing a cache in tells `generate` someone else owns it, so it stops
	// freeing it for us. A run's worth of KV is hundreds of megabytes of
	// VRAM; drop it before the next one asks for its own.
	try {
		await (past as { dispose?: () => Promise<void> } | null)?.dispose?.()
	} catch {
		/* best effort: the point is to free VRAM, not to be exact */
	}

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
		if (event.data.type === 'preload') {
			// `load` is idempotent and keeps the model in module scope, so a
			// later 'summarize' for the same id costs nothing.
			const before = await cachedBytesFor(event.data.model)
			await load(event.data.model)
			post({ type: 'preloaded', cached: before > 0 })
			return
		}
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
