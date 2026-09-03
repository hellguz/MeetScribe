/**
 * Orchestrates on-device processing for a live recording:
 *
 *   recorder chunk (webm) ──decode──▶ 16 kHz PCM ──▶ Parakeet worker ──▶ text + word times
 *                                        │                                    │
 *                                        ▼                                    ▼
 *                                  kept for later                 PUT /chunks/{i}/transcript
 *
 *   stop ──▶ wait for queue ──▶ diarization worker over all PCM ──▶ label ──▶ POST /finalize
 *
 * The recorder and the audio upload are untouched; this hook only adds a
 * second consumer of every chunk. Everything it measures ends up in
 * `state` for the panel and in `client_stats` on the meeting.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl } from '../utils/api'
import { detectCapabilities, resolvePlan, type DeviceCapabilities, type ParakeetPlan, type PlanChoice } from './capabilities'
import { fetchModelManifest, finalizeMeeting, putChunkTranscript, requestServerFallback, type ModelManifest } from './api'
import { labelTranscript, pruneMinorSpeakers, renumberByFirstAppearance, type SpeakerTurn, type TranscriptChunk, type TranscriptSegment } from './diarization/label'
import type { ParakeetWorkerRequest, ParakeetWorkerResponse } from './parakeet.worker'
import type { DiarizationWorkerRequest, DiarizationWorkerResponse } from './diarization.worker'
import type { TranscribeWord } from './types'

const SAMPLE_RATE = 16_000
const STORAGE_ENABLED = 'meetscribe_ondevice'
const STORAGE_PLAN = 'meetscribe_ondevice_plan'

export type OnDevicePhase = 'idle' | 'loading' | 'ready' | 'diarizing' | 'finalizing' | 'error' | 'fallback'

export interface DownloadState {
	loaded: number
	total: number
	startedAt: number
	bytesPerSec: number
	done: boolean
}

export interface OnDeviceState {
	enabled: boolean
	planChoice: PlanChoice
	plan: ParakeetPlan | null
	caps: DeviceCapabilities | null
	phase: OnDevicePhase
	error: string | null
	download: DownloadState | null
	modelLoadMs: number | null
	backend: 'webgpu' | 'wasm' | null
	threads: number | null
	transcription: { done: number; queued: number; audioSeconds: number; processMs: number }
	diarization: { stage: string | null; done: number; total: number; ms: number | null; speakers: number | null; modelBytes: number | null; modelLoadMs: number | null }
}

export interface OnDeviceController {
	state: OnDeviceState
	setEnabled: (enabled: boolean) => void
	setPlanChoice: (choice: PlanChoice) => void
	/** True when a meeting started now would be processed on this device. */
	isUsable: boolean
	beginMeeting: (meetingId: string) => void
	addChunk: (blob: Blob, index: number) => void
	/** Drain, diarize, hand over. Resolves once the server has the transcript. */
	finish: () => Promise<void>
	/** What the status box should say while the server still reports nothing. */
	localStage: 'diarizing' | 'summarizing' | null
}

const initialState = (): OnDeviceState => ({
	enabled: (() => {
		try {
			return localStorage.getItem(STORAGE_ENABLED) === 'true'
		} catch {
			return false
		}
	})(),
	planChoice: (() => {
		try {
			const v = localStorage.getItem(STORAGE_PLAN)
			return v === 'gpu-fp16' || v === 'cpu-int8' ? v : 'auto'
		} catch {
			return 'auto'
		}
	})(),
	plan: null,
	caps: null,
	phase: 'idle',
	error: null,
	download: null,
	modelLoadMs: null,
	backend: null,
	threads: null,
	transcription: { done: 0, queued: 0, audioSeconds: 0, processMs: 0 },
	diarization: { stage: null, done: 0, total: 0, ms: null, speakers: null, modelBytes: null, modelLoadMs: null },
})

/** Decode a recorder chunk (a complete webm/opus file) to mono 16 kHz PCM. */
async function decodeToPcm(blob: Blob): Promise<Float32Array> {
	const bytes = await blob.arrayBuffer()
	const probe = new OfflineAudioContext(1, 1, SAMPLE_RATE)
	let decoded = await probe.decodeAudioData(bytes)
	if (decoded.sampleRate !== SAMPLE_RATE) {
		// Some browsers decode at the file's rate; render through a 16 kHz context to resample.
		const frames = Math.ceil(decoded.duration * SAMPLE_RATE)
		const ctx = new OfflineAudioContext(1, Math.max(1, frames), SAMPLE_RATE)
		const source = ctx.createBufferSource()
		source.buffer = decoded
		source.connect(ctx.destination)
		source.start()
		decoded = await ctx.startRendering()
	}
	if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice()
	const out = new Float32Array(decoded.length)
	for (let c = 0; c < decoded.numberOfChannels; c++) {
		const data = decoded.getChannelData(c)
		for (let i = 0; i < out.length; i++) out[i] += data[i] / decoded.numberOfChannels
	}
	return out
}

/**
 * Group Parakeet's words into short segments so diarization can attribute
 * them: a new segment at a pause > 0.6 s, after sentence punctuation, or
 * every 24 words. Same shape as the Whisper segments the server stores.
 */
function wordsToSegments(words: TranscribeWord[], text: string, audioSeconds: number): TranscriptSegment[] {
	if (words.length === 0) return text.trim() ? [{ start: 0, end: audioSeconds, text: text.trim() }] : []
	const segments: TranscriptSegment[] = []
	let current: TranscribeWord[] = []
	const flush = () => {
		if (current.length === 0) return
		segments.push({ start: current[0].start_time, end: current[current.length - 1].end_time, text: current.map((w) => w.text).join(' ').trim() })
		current = []
	}
	for (const word of words) {
		const prev = current[current.length - 1]
		if (prev && (word.start_time - prev.end_time > 0.6 || /[.!?…]$/.test(prev.text) || current.length >= 24)) flush()
		current.push(word)
	}
	flush()
	return segments.filter((s) => s.text)
}

interface ChunkRecord {
	pcm: Float32Array
	text: string | null
	segments: TranscriptSegment[]
}

export function useOnDevice(): OnDeviceController {
	const [state, setState] = useState<OnDeviceState>(initialState)
	const stateRef = useRef(state)
	stateRef.current = state
	const patch = useCallback((update: Partial<OnDeviceState> | ((s: OnDeviceState) => Partial<OnDeviceState>)) => {
		setState((s) => ({ ...s, ...(typeof update === 'function' ? update(s) : update) }))
	}, [])

	const parakeetRef = useRef<Worker | null>(null)
	const diarizerRef = useRef<Worker | null>(null)
	const parakeetReady = useRef<Promise<void> | null>(null)
	const diarizerReady = useRef<Promise<void> | null>(null)
	const manifestRef = useRef<ModelManifest | null>(null)

	// Per-meeting data.
	const meetingIdRef = useRef<string | null>(null)
	const chunksRef = useRef<Map<number, ChunkRecord>>(new Map())
	const queueRef = useRef<number[]>([])
	const inFlightRef = useRef<number | null>(null)
	const decodingRef = useRef(0)
	const drainWaitersRef = useRef<(() => void)[]>([])
	const pendingResolvers = useRef<Map<number, { resolve: (r: Extract<ParakeetWorkerResponse, { type: 'transcribed' }>) => void; reject: (e: Error) => void }>>(new Map())

	// ---- capabilities ------------------------------------------------------
	useEffect(() => {
		detectCapabilities().then((caps) => patch({ caps }))
	}, [patch])

	const plan = useMemo(() => (state.caps ? resolvePlan(state.planChoice, state.caps) : null), [state.caps, state.planChoice])

	// ---- workers -----------------------------------------------------------
	const terminateWorkers = useCallback(() => {
		parakeetRef.current?.terminate()
		diarizerRef.current?.terminate()
		parakeetRef.current = null
		diarizerRef.current = null
		parakeetReady.current = null
		diarizerReady.current = null
	}, [])

	const loadWorkers = useCallback(
		(chosen: ParakeetPlan) => {
			terminateWorkers()
			patch({ phase: 'loading', error: null, plan: chosen, download: null, modelLoadMs: null, backend: null })

			const parakeet = new Worker(new URL('./parakeet.worker.ts', import.meta.url), { type: 'module' })
			parakeetRef.current = parakeet
			parakeetReady.current = new Promise<void>((resolve, reject) => {
				parakeet.onmessage = (event: MessageEvent<ParakeetWorkerResponse>) => {
					const msg = event.data
					if (msg.type === 'download') {
						patch((s) => {
							const loaded = Object.values(msg.files).reduce((sum, f) => sum + f.loaded, 0)
							const total = Object.values(msg.files).reduce((sum, f) => sum + f.total, 0)
							const startedAt = s.download?.startedAt ?? Date.now()
							const elapsed = (Date.now() - startedAt) / 1000
							return { download: { loaded, total, startedAt, bytesPerSec: elapsed > 0.5 ? loaded / elapsed : 0, done: false } }
						})
					} else if (msg.type === 'loaded') {
						patch((s) => ({
							phase: 'ready',
							modelLoadMs: msg.loadMs,
							backend: msg.backend,
							threads: msg.threads,
							download: s.download ? { ...s.download, done: true } : { loaded: 0, total: 0, startedAt: Date.now(), bytesPerSec: 0, done: true },
						}))
						resolve()
					} else if (msg.type === 'transcribed') {
						pendingResolvers.current.get(msg.id)?.resolve(msg)
						pendingResolvers.current.delete(msg.id)
					} else if (msg.type === 'error') {
						if (msg.id !== undefined) {
							pendingResolvers.current.get(msg.id)?.reject(new Error(msg.message))
							pendingResolvers.current.delete(msg.id)
						} else {
							patch({ phase: 'error', error: `Parakeet failed to load: ${msg.message} — flip the switch off and on to retry.` })
							reject(new Error(msg.message))
						}
					}
				}
				parakeet.onerror = (e) => {
					patch({ phase: 'error', error: `Parakeet worker crashed: ${e.message}` })
					reject(new Error(e.message))
				}
			})
			parakeetReady.current.catch(() => {})
			parakeet.postMessage({ type: 'load', plan: chosen } satisfies ParakeetWorkerRequest)

			const diarizer = new Worker(new URL('./diarization.worker.ts', import.meta.url), { type: 'module' })
			diarizerRef.current = diarizer
			diarizerReady.current = (async () => {
				const manifest = await fetchModelManifest()
				manifestRef.current = manifest
				await new Promise<void>((resolve, reject) => {
					diarizer.onmessage = (event: MessageEvent<DiarizationWorkerResponse>) => {
						const msg = event.data
						if (msg.type === 'loaded') {
							patch((s) => ({ diarization: { ...s.diarization, modelBytes: msg.downloadBytes, modelLoadMs: msg.loadMs } }))
							resolve()
						} else if (msg.type === 'error') reject(new Error(msg.message))
					}
					diarizer.onerror = (e) => reject(new Error(e.message))
					diarizer.postMessage({ type: 'load', segmentationUrl: manifest.segmentation.url, embeddingUrl: manifest.embedding.url } satisfies DiarizationWorkerRequest)
				})
			})()
			// Diarization is optional: if its models are missing the meeting
			// still gets a plain transcript, like the server without models.
			diarizerReady.current.catch((err) => console.warn('On-device diarization unavailable:', err))
		},
		[patch, terminateWorkers],
	)

	// Load as soon as the feature is on and we know the plan, so the download
	// happens before the meeting rather than during it.
	useEffect(() => {
		if (!state.enabled) {
			if (state.phase !== 'idle' || state.plan !== null) {
				terminateWorkers()
				patch({ phase: 'idle', error: null, download: null, plan: null })
			}
			return
		}
		if (!plan) return
		if (meetingIdRef.current) return // never swap models mid-meeting
		// Load once per plan. A failed load stays failed until the user flips
		// the switch (or picks another plan) — no silent retry loop.
		if (state.plan !== plan || state.phase === 'idle') loadWorkers(plan)
	}, [state.enabled, plan, state.plan, state.phase, loadWorkers, terminateWorkers, patch])

	useEffect(() => () => terminateWorkers(), [terminateWorkers])

	const setEnabled = useCallback(
		(enabled: boolean) => {
			try {
				localStorage.setItem(STORAGE_ENABLED, String(enabled))
			} catch {
				/* private mode */
			}
			patch({ enabled })
		},
		[patch],
	)

	const setPlanChoice = useCallback(
		(choice: PlanChoice) => {
			try {
				localStorage.setItem(STORAGE_PLAN, choice)
			} catch {
				/* private mode */
			}
			patch({ planChoice: choice })
		},
		[patch],
	)

	// ---- transcription queue ----------------------------------------------
	const notifyDrained = () => {
		if (queueRef.current.length === 0 && inFlightRef.current === null && decodingRef.current === 0) {
			drainWaitersRef.current.forEach((fn) => fn())
			drainWaitersRef.current = []
		}
	}

	const pump = useCallback(async () => {
		if (inFlightRef.current !== null) return
		const index = queueRef.current.shift()
		if (index === undefined) {
			notifyDrained()
			return
		}
		inFlightRef.current = index
		const meetingId = meetingIdRef.current
		const record = chunksRef.current.get(index)
		try {
			await parakeetReady.current
			const worker = parakeetRef.current
			if (!worker || !record || !meetingId) throw new Error('Parakeet is not available')
			const result = await new Promise<Extract<ParakeetWorkerResponse, { type: 'transcribed' }>>((resolve, reject) => {
				pendingResolvers.current.set(index, { resolve, reject })
				const audio = record.pcm.slice()
				worker.postMessage({ type: 'transcribe', id: index, audio, sampleRate: SAMPLE_RATE } satisfies ParakeetWorkerRequest, [audio.buffer])
			})
			record.text = result.text
			record.segments = wordsToSegments(result.words, result.text, result.audioSeconds)
			patch((s) => ({
				transcription: {
					done: s.transcription.done + 1,
					queued: Math.max(0, s.transcription.queued - 1),
					audioSeconds: s.transcription.audioSeconds + result.audioSeconds,
					processMs: s.transcription.processMs + result.ms,
				},
			}))
			try {
				await putChunkTranscript(meetingId, index, result.text, record.segments, result.audioSeconds)
			} catch (err) {
				console.warn('Retrying chunk transcript upload once:', err)
				await putChunkTranscript(meetingId, index, result.text, record.segments, result.audioSeconds).catch((e) => console.error(e))
			}
		} catch (err) {
			console.error(`On-device transcription failed for chunk ${index}:`, err)
			if (record) record.text = record.text ?? ''
			patch((s) => ({ transcription: { ...s.transcription, queued: Math.max(0, s.transcription.queued - 1) } }))
		} finally {
			inFlightRef.current = null
			void pump()
		}
	}, [patch])

	const beginMeeting = useCallback(
		(meetingId: string) => {
			meetingIdRef.current = meetingId
			chunksRef.current = new Map()
			queueRef.current = []
			inFlightRef.current = null
			decodingRef.current = 0
			drainWaitersRef.current = []
			patch({
				transcription: { done: 0, queued: 0, audioSeconds: 0, processMs: 0 },
				diarization: { ...stateRef.current.diarization, stage: null, done: 0, total: 0, ms: null, speakers: null },
			})
		},
		[patch],
	)

	const addChunk = useCallback(
		(blob: Blob, index: number) => {
			if (!meetingIdRef.current) return
			decodingRef.current += 1
			patch((s) => ({ transcription: { ...s.transcription, queued: s.transcription.queued + 1 } }))
			decodeToPcm(blob)
				.then((pcm) => {
					chunksRef.current.set(index, { pcm, text: null, segments: [] })
					queueRef.current.push(index)
				})
				.catch((err) => {
					console.error(`Could not decode chunk ${index}:`, err)
					patch((s) => ({ transcription: { ...s.transcription, queued: Math.max(0, s.transcription.queued - 1) } }))
				})
				.finally(() => {
					decodingRef.current -= 1
					void pump()
				})
		},
		[patch, pump],
	)

	const waitForDrain = () =>
		new Promise<void>((resolve) => {
			if (queueRef.current.length === 0 && inFlightRef.current === null && decodingRef.current === 0) resolve()
			else drainWaitersRef.current.push(resolve)
		})

	// ---- finish: diarize + hand over ---------------------------------------
	const finish = useCallback(async () => {
		const meetingId = meetingIdRef.current
		if (!meetingId) return
		const heartbeat = setInterval(() => {
			fetch(apiUrl(`/api/meetings/${meetingId}/heartbeat`), { method: 'POST' }).catch(() => {})
		}, 60_000)

		try {
			await waitForDrain()
			await parakeetReady.current?.catch(() => null)
			if (!parakeetRef.current || stateRef.current.phase === 'error' || stateRef.current.phase === 'fallback') {
				throw new Error(stateRef.current.error ?? 'Parakeet did not load')
			}

			// Concatenate every decoded chunk, in order, remembering offsets.
			const indexes = Array.from(chunksRef.current.keys()).sort((a, b) => a - b)
			let totalSamples = 0
			for (const i of indexes) totalSamples += chunksRef.current.get(i)!.pcm.length
			const audio = new Float32Array(totalSamples)
			const chunks: TranscriptChunk[] = []
			let cursor = 0
			for (const i of indexes) {
				const rec = chunksRef.current.get(i)!
				audio.set(rec.pcm, cursor)
				chunks.push({ index: i, text: rec.text ?? '', segments: rec.segments, offset: cursor / SAMPLE_RATE })
				cursor += rec.pcm.length
			}
			const durationSeconds = Math.round(totalSamples / SAMPLE_RATE)

			let turns: SpeakerTurn[] = []
			let speakers: number | null = null
			let diarizationMs: number | null = null
			patch((s) => ({ phase: 'diarizing', diarization: { ...s.diarization, stage: 'segmenting', done: 0, total: 0 } }))
			try {
				await diarizerReady.current
				const worker = diarizerRef.current
				const manifest = manifestRef.current
				if (!worker || !manifest) throw new Error('diarization models unavailable')
				const raw = await new Promise<{ turns: SpeakerTurn[]; ms: number }>((resolve, reject) => {
					worker.onmessage = (event: MessageEvent<DiarizationWorkerResponse>) => {
						const msg = event.data
						if (msg.type === 'progress') patch((s) => ({ diarization: { ...s.diarization, stage: msg.progress.stage, done: msg.progress.done, total: msg.progress.total } }))
						else if (msg.type === 'result') resolve({ turns: msg.turns, ms: msg.ms })
						else if (msg.type === 'error') reject(new Error(msg.message))
					}
					worker.onerror = (e) => reject(new Error(e.message))
					const cfg = manifest.config
					worker.postMessage(
						{
							type: 'run',
							audio,
							config: { windowShiftRatio: cfg.window_shift_ratio, clusterThreshold: cfg.cluster_threshold, minDurationOn: cfg.min_duration_on, minDurationOff: cfg.min_duration_off },
						} satisfies DiarizationWorkerRequest,
						[audio.buffer],
					)
				})
				diarizationMs = raw.ms
				const [renumbered, count] = renumberByFirstAppearance(pruneMinorSpeakers(raw.turns, manifest.config.min_speaker_share))
				turns = renumbered
				speakers = count
			} catch (err) {
				console.warn('On-device diarization failed; sending the plain transcript.', err)
			}
			patch((s) => ({ diarization: { ...s.diarization, stage: null, ms: diarizationMs, speakers } }))

			const transcript = turns.length > 0 ? labelTranscript(chunks, turns) : chunks.map((c) => c.text).filter(Boolean).join(' ').trim()

			const s = stateRef.current
			const clientStats = {
				plan: s.plan,
				backend: s.backend,
				threads: s.threads,
				download: s.download ? { bytes: s.download.total, ms: s.download.total > 0 ? Math.round(s.download.loaded / Math.max(s.download.bytesPerSec, 1) * 1000) : 0, cached: s.download.total === 0 } : null,
				model_load_ms: s.modelLoadMs,
				transcription: { chunks: s.transcription.done, audio_seconds: Math.round(s.transcription.audioSeconds), process_ms: Math.round(s.transcription.processMs) },
				diarization: { audio_seconds: durationSeconds, ms: diarizationMs === null ? null : Math.round(diarizationMs), speakers, model_bytes: s.diarization.modelBytes, model_load_ms: s.diarization.modelLoadMs },
				device: { webgpu: s.caps?.webgpu ?? null, fp16: s.caps?.fp16 ?? null, cross_origin_isolated: s.caps?.crossOriginIsolated ?? null, cores: s.caps?.cores ?? null, memory_gb: s.caps?.memoryGb ?? null, mobile: s.caps?.isMobile ?? null, user_agent: navigator.userAgent },
			}

			patch({ phase: 'finalizing' })
			await finalizeMeeting(meetingId, { transcript, speaker_count: speakers, duration_seconds: durationSeconds, client_stats: clientStats })
		} catch (err) {
			// Anything unrecoverable: let the server pipeline take the audio it already has.
			console.error('On-device processing failed; falling back to the server.', err)
			patch({ phase: 'fallback', error: err instanceof Error ? err.message : String(err) })
			await requestServerFallback(meetingId)
		} finally {
			clearInterval(heartbeat)
			meetingIdRef.current = null
			chunksRef.current = new Map()
		}
	}, [patch])

	// A failed load while a meeting is running means the server must take over.
	useEffect(() => {
		if (state.phase === 'error' && meetingIdRef.current) {
			const id = meetingIdRef.current
			meetingIdRef.current = null
			patch({ phase: 'fallback' })
			requestServerFallback(id).catch(console.error)
		}
	}, [state.phase, patch])

	const isUsable = state.enabled && state.phase !== 'error' && state.phase !== 'fallback' && state.phase !== 'idle'
	const localStage = state.phase === 'diarizing' ? 'diarizing' : state.phase === 'finalizing' ? 'summarizing' : null

	return { state: { ...state, plan }, setEnabled, setPlanChoice, isUsable, beginMeeting, addChunk, finish, localStage }
}
