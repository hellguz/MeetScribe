/**
 * Stand-in for `parakeet.js` used by the browser test harness when Vite runs
 * with PARAKEET_MOCK=1 (see vite.config.ts). The real downloader (hub.ts)
 * still runs — point VITE_PARAKEET_MODEL_BASE at a directory with the
 * expected file names — but "transcription" emits a placeholder word every
 * 400 ms of audio with real timestamps. That is enough to exercise decoding,
 * the worker protocol, chunk uploads, on-device diarization and the hand-over
 * to the server without a real model. Not part of the app bundle.
 */
import type { TranscribeWord } from '../types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fromUrls() {
	console.warn('[Parakeet.js mock] Creating ONNX sessions (pretend)…')
	await sleep(300)
	return {
		async transcribe(audio: Float32Array, sampleRate = 16_000) {
			const seconds = audio.length / sampleRate
			await sleep(Math.max(20, seconds * 15)) // ~60× realtime
			const words: TranscribeWord[] = []
			for (let t = 0; t + 0.4 <= seconds; t += 0.4) {
				words.push({ text: `w${Math.round(t * 10)}${t % 4 < 0.01 ? '.' : ''}`, start_time: t, end_time: t + 0.3 })
			}
			return { utterance_text: words.map((w) => w.text).join(' '), words, is_final: true, metrics: null }
		},
	}
}
