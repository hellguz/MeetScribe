/// <reference lib="webworker" />
/**
 * Web Worker: speech recognition on this device with NVIDIA Parakeet TDT
 * 0.6B v3 through parakeet.js (ONNX Runtime Web).
 *
 * Model files come from the Hugging Face Hub and are cached by parakeet.js in
 * IndexedDB, so the ~0.6–1.2 GB download happens once per browser. Two plans:
 * the encoder on WebGPU in fp16, or everything on WASM with an int8 encoder.
 */
import { fromHub, type ParakeetModel } from 'parakeet.js'
import type { TranscribeWord } from './types'
import { configureOrt } from './ortSetup'
import type { ParakeetPlan } from './capabilities'

export type ParakeetWorkerRequest =
	| { type: 'load'; plan: ParakeetPlan }
	| { type: 'transcribe'; id: number; audio: Float32Array; sampleRate: number }

export type ParakeetWorkerResponse =
	| { type: 'download'; file: string; loaded: number; total: number; files: Record<string, { loaded: number; total: number }> }
	| { type: 'loaded'; plan: ParakeetPlan; backend: 'webgpu' | 'wasm'; encoderQuant: string; decoderQuant: string; loadMs: number; downloadBytes: number; threads: number }
	| { type: 'transcribed'; id: number; text: string; words: TranscribeWord[]; audioSeconds: number; ms: number }
	| { type: 'error'; id?: number; message: string }

const MODEL_KEY = 'parakeet-tdt-0.6b-v3'
const post = (msg: ParakeetWorkerResponse) => self.postMessage(msg)

let model: ParakeetModel | null = null

async function load(plan: ParakeetPlan) {
	const { threads } = configureOrt()
	const t0 = performance.now()
	const files: Record<string, { loaded: number; total: number }> = {}
	let downloadBytes = 0
	const progress = ({ file, loaded, total }: { file: string; loaded: number; total: number }) => {
		files[file] = { loaded, total }
		downloadBytes = Object.values(files).reduce((s, f) => s + f.loaded, 0)
		post({ type: 'download', file, loaded, total, files: { ...files } })
	}

	const backend = plan === 'gpu-fp16' ? 'webgpu' : 'wasm'
	const encoderQuant = plan === 'gpu-fp16' ? 'fp16' : 'int8'
	// parakeet.js can only run the decoder on WASM, and int8 is its fastest
	// form there.
	const decoderQuant = 'int8'
	model = await fromHub(MODEL_KEY, {
		backend,
		encoderQuant,
		decoderQuant,
		preprocessorBackend: 'js',
		cpuThreads: threads,
		progress,
	})
	post({ type: 'loaded', plan, backend, encoderQuant, decoderQuant, loadMs: performance.now() - t0, downloadBytes, threads })
}

async function transcribe(id: number, audio: Float32Array, sampleRate: number) {
	if (!model) throw new Error('Parakeet is not loaded')
	const t0 = performance.now()
	const result = await model.transcribe(audio, sampleRate, { returnTimestamps: true, enableProfiling: false })
	post({
		type: 'transcribed',
		id,
		text: result.utterance_text ?? '',
		words: result.words ?? [],
		audioSeconds: audio.length / sampleRate,
		ms: performance.now() - t0,
	})
}

self.onmessage = async (event: MessageEvent<ParakeetWorkerRequest>) => {
	const msg = event.data
	try {
		if (msg.type === 'load') await load(msg.plan)
		else if (msg.type === 'transcribe') await transcribe(msg.id, msg.audio, msg.sampleRate)
	} catch (err) {
		post({ type: 'error', id: msg.type === 'transcribe' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) })
	}
}
