/**
 * Stand-in for `parakeet.js` used by the browser test harness when Vite runs
 * with PARAKEET_MOCK=1 (see vite.config.ts). It never touches the network:
 * "download" is a short simulated progress ramp and "transcription" emits a
 * placeholder word every 400 ms of audio with real timestamps, which is
 * enough to exercise decoding, the worker protocol, chunk uploads, on-device
 * diarization and the hand-over to the server. Not part of the app bundle.
 */
import type { TranscribeWord } from '../types'

interface HubOptions {
	backend?: string
	progress?: (p: { file: string; loaded: number; total: number }) => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fromHub(_key: string, options: HubOptions = {}) {
	const files = { 'encoder-model.mock.onnx': 40_000_000, 'decoder_joint-model.int8.onnx': 6_000_000, 'vocab.txt': 20_000 }
	for (const [file, total] of Object.entries(files)) {
		for (let loaded = 0; loaded <= total; loaded += total / 4) {
			options.progress?.({ file, loaded: Math.min(loaded, total), total })
			await sleep(40)
		}
	}
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
