/// <reference lib="webworker" />
/**
 * Web Worker: speech recognition on this device with NVIDIA Parakeet TDT
 * 0.6B v3 through parakeet.js (ONNX Runtime Web).
 *
 * Two plans: the encoder on WebGPU in fp16 (decoder on WASM), or everything
 * on WASM with an int8 encoder. Model files stream into the Cache API once
 * (see hub.ts) and load from disk afterwards. Every console line from
 * parakeet.js / ORT is forwarded to the page so a stall is diagnosable.
 */
import { fromUrls, type ParakeetModel } from 'parakeet.js'
import { configureOrt, isOrtHelperWorker } from './ortSetup'
import { downloadToObjectUrl, resolveModelFiles } from './hub'
import type { ParakeetPlan } from './capabilities'
import type { TranscribeWord } from './types'

export type ParakeetWorkerRequest =
	| { type: 'load'; plan: ParakeetPlan; modelBase?: string }
	| { type: 'transcribe'; id: number; audio: Float32Array; sampleRate: number }

export type ParakeetWorkerResponse =
	| { type: 'download'; files: Record<string, { loaded: number; total: number }>; cached: boolean }
	| { type: 'status'; text: string }
	| { type: 'downloaded'; bytes: number; cached: boolean }
	| { type: 'log'; level: 'log' | 'warn' | 'error'; text: string }
	| { type: 'loaded'; plan: ParakeetPlan; backend: 'webgpu' | 'wasm'; encoderQuant: string; decoderQuant: string; loadMs: number; downloadBytes: number; cached: boolean; threads: number; source: string }
	| { type: 'transcribed'; id: number; text: string; words: TranscribeWord[]; audioSeconds: number; ms: number }
	| { type: 'error'; id?: number; stage?: 'resolve' | 'download' | 'session' | 'transcribe'; message: string }

const post = (msg: ParakeetWorkerResponse) => self.postMessage(msg)

/** ANSI colour codes ORT emits, which would otherwise show up as "[0;93m". */
// eslint-disable-next-line no-control-regex -- matching the escape byte is the point
const ANSI = /\u001b\[[0-9;]*m/g

/**
 * ORT writes *all* of its native log lines to console.error, including
 * warnings such as the harmless "Unknown CPU vendor". Take the real severity
 * from the line's own "[W:" / "[E:" marker so a warning is not shown as a
 * failure.
 */
function severityOf(text: string, fallback: 'log' | 'warn' | 'error'): 'log' | 'warn' | 'error' {
	const marker = /\[([VIWE]):onnxruntime/.exec(text)
	if (!marker) return fallback
	return marker[1] === 'E' ? 'error' : marker[1] === 'W' ? 'warn' : 'log'
}

function installDiagnostics() {
	// Mirror the worker's console to the page (parakeet.js and ORT log there).
	for (const level of ['log', 'warn', 'error'] as const) {
		const original = console[level].bind(console)
		console[level] = (...args: unknown[]) => {
			original(...args)
			try {
				const text = args
					.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)))
					.join(' ')
					.replace(ANSI, '')
					.slice(0, 400)
				post({ type: 'log', level: severityOf(text, level), text })
			} catch {
				/* not serialisable */
			}
		}
	}
	self.addEventListener('unhandledrejection', (e) => post({ type: 'error', stage: 'session', message: `Unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}` }))
}

let model: ParakeetModel | null = null

/**
 * Before hub.ts existed, parakeet.js's own downloader kept the model files in
 * its IndexedDB (up to ~2 GB across both plans). Nothing reads that database
 * any more, so drop it here instead of asking people to clear site data.
 */
function dropLegacyParakeetCache() {
	try {
		indexedDB.deleteDatabase('parakeet-cache-db')
	} catch {
		/* no IndexedDB in this context */
	}
}

async function load(plan: ParakeetPlan, modelBase?: string) {
	const { threads } = configureOrt()
	const t0 = performance.now()
	dropLegacyParakeetCache()

	post({ type: 'status', text: 'Locating model files…' })
	let files
	try {
		files = await resolveModelFiles(plan, modelBase)
	} catch (err) {
		post({ type: 'error', stage: 'resolve', message: err instanceof Error ? err.message : String(err) })
		return
	}

	const progress: Record<string, { loaded: number; total: number }> = {}
	let allCached = true
	const report = (file: string, loaded: number, total: number) => {
		progress[file] = { loaded, total }
		post({ type: 'download', files: { ...progress }, cached: allCached })
	}
	const urls: Record<string, string> = {}
	let downloadBytes = 0
	try {
		// Sequential on purpose: one big stream saturates the link, and the
		// progress bar is easier to read.
		for (const [key, url] of Object.entries({ encoder: files.encoder, encoderData: files.encoderData, decoder: files.decoder, tokenizer: files.tokenizer })) {
			if (!url) continue
			const { objectUrl, bytes, cached } = await downloadToObjectUrl(url, report)
			urls[key] = objectUrl
			downloadBytes += bytes
			if (!cached) allCached = false
		}
	} catch (err) {
		post({ type: 'error', stage: 'download', message: err instanceof Error ? err.message : String(err) })
		return
	}

	post({ type: 'downloaded', bytes: downloadBytes, cached: allCached })
	const backend = plan === 'gpu-fp16' ? 'webgpu' : 'wasm'
	post({ type: 'status', text: `Loading ${(downloadBytes / 1e9).toFixed(2)} GB into ${backend === 'webgpu' ? 'GPU + ' : ''}memory…` })
	try {
		model = await fromUrls({
			encoderUrl: urls.encoder,
			encoderDataUrl: urls.encoderData ?? null,
			decoderUrl: urls.decoder,
			tokenizerUrl: files.tokenizer, // small text file, fetched directly
			filenames: files.filenames,
			// parakeet.js only knows 'webgpu-hybrid' | 'webgpu-strict' | 'wasm'
			// when it builds the execution-provider list; plain 'webgpu' leaves it empty.
			backend: backend === 'webgpu' ? 'webgpu-hybrid' : 'wasm',
			preprocessorBackend: 'js',
			cpuThreads: threads,
		})
	} catch (err) {
		post({ type: 'error', stage: 'session', message: err instanceof Error ? err.message : String(err) })
		return
	} finally {
		for (const u of Object.values(urls)) URL.revokeObjectURL(u)
	}

	post({
		type: 'loaded',
		plan,
		backend,
		encoderQuant: plan === 'gpu-fp16' ? 'fp16' : 'int8',
		decoderQuant: 'int8',
		loadMs: performance.now() - t0,
		downloadBytes,
		cached: allCached,
		threads,
		source: files.base,
	})
}

async function transcribe(id: number, audio: Float32Array, sampleRate: number) {
	if (!model) throw new Error('Parakeet is not loaded')
	const t0 = performance.now()
	const result = await model.transcribe(audio, sampleRate, { returnTimestamps: true, enableProfiling: false })
	post({
		type: 'transcribed',
		id,
		text: result.utterance_text ?? '',
		words: (result.words ?? []) as TranscribeWord[],
		audioSeconds: audio.length / sampleRate,
		ms: performance.now() - t0,
	})
}

// Only the real worker installs handlers; an ORT pthread evaluating this
// file must leave `self.onmessage` to ORT.
if (!isOrtHelperWorker()) {
	installDiagnostics()
	self.onmessage = async (event: MessageEvent<ParakeetWorkerRequest>) => {
		const msg = event.data
		try {
			if (msg.type === 'load') await load(msg.plan, msg.modelBase)
			else if (msg.type === 'transcribe') await transcribe(msg.id, msg.audio, msg.sampleRate)
		} catch (err) {
			post({ type: 'error', id: msg.type === 'transcribe' ? msg.id : undefined, stage: msg.type === 'transcribe' ? 'transcribe' : 'session', message: err instanceof Error ? err.message : String(err) })
		}
	}
}
