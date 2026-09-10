/// <reference lib="webworker" />
/**
 * Web Worker: speaker diarization on this device.
 *
 * Loads the pyannote segmentation + campplus embedding models served by the
 * backend (/api/models/…) into ONNX Runtime Web (WASM) and runs the sherpa
 * port in ./diarization/pipeline.ts. Both models are small (~36 MB together)
 * and int8/fp32 CPU models, so WASM is the right backend for them.
 */
import { configureOrt, isOrtHelperWorker, ort } from './ortSetup'
import { diarize, DEFAULT_DIARIZATION_CONFIG, type DiarizationConfig, type DiarizationModels, type DiarizationProgress } from './diarization/pipeline'
import type { SpeakerTurn } from './diarization/label'

export type DiarizationWorkerRequest =
	| { type: 'load'; segmentationUrl: string; embeddingUrl: string }
	| { type: 'run'; audio: Float32Array; config: Partial<DiarizationConfig> }

export type DiarizationWorkerResponse =
	| { type: 'loaded'; loadMs: number; downloadBytes: number; threads: number }
	| { type: 'progress'; progress: DiarizationProgress }
	| { type: 'result'; turns: SpeakerTurn[]; ms: number }
	| { type: 'error'; message: string }

const post = (msg: DiarizationWorkerResponse) => self.postMessage(msg)

let models: DiarizationModels | null = null

async function fetchBytes(url: string): Promise<ArrayBuffer> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
	return res.arrayBuffer()
}

async function load(segmentationUrl: string, embeddingUrl: string) {
	const { threads } = configureOrt()
	const t0 = performance.now()
	const [segBytes, embBytes] = await Promise.all([fetchBytes(segmentationUrl), fetchBytes(embeddingUrl)])
	const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
	const [seg, emb] = await Promise.all([
		ort.InferenceSession.create(new Uint8Array(segBytes), opts),
		ort.InferenceSession.create(new Uint8Array(embBytes), opts),
	])
	const segIn = seg.inputNames[0]
	const segOut = seg.outputNames[0]
	const embIn = emb.inputNames[0]
	const embOut = emb.outputNames[0]

	models = {
		async segment(window) {
			const out = await seg.run({ [segIn]: new ort.Tensor('float32', window, [1, 1, window.length]) })
			const y = out[segOut]
			return { data: y.data as Float32Array, frames: Number(y.dims[1]) }
		},
		async embed(features, frames) {
			const out = await emb.run({ [embIn]: new ort.Tensor('float32', features, [1, frames, 80]) })
			return out[embOut].data as Float32Array
		},
	}
	post({ type: 'loaded', loadMs: performance.now() - t0, downloadBytes: segBytes.byteLength + embBytes.byteLength, threads })
}

async function run(audio: Float32Array, config: Partial<DiarizationConfig>) {
	if (!models) throw new Error('Diarization models are not loaded')
	const t0 = performance.now()
	let lastPost = 0
	const turns = await diarize(audio, models, { ...DEFAULT_DIARIZATION_CONFIG, ...config }, (progress) => {
		// Throttle: embedding reports per segment, which can be thousands.
		const now = performance.now()
		if (now - lastPost > 150 || progress.done === progress.total) {
			lastPost = now
			post({ type: 'progress', progress })
		}
	})
	post({ type: 'result', turns, ms: performance.now() - t0 })
}

// An ORT pthread may evaluate this file too (see isOrtHelperWorker); it must
// not take over the message handler.
if (!isOrtHelperWorker()) {
	self.onmessage = async (event: MessageEvent<DiarizationWorkerRequest>) => {
		const msg = event.data
		try {
			if (msg.type === 'load') await load(msg.segmentationUrl, msg.embeddingUrl)
			else if (msg.type === 'run') await run(msg.audio, msg.config)
		} catch (err) {
			post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
		}
	}
}
