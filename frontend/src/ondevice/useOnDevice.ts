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
import { detectCapabilities, resolvePlan, type DeviceCapabilities, type ParakeetPlan, type PlanChoice } from './capabilities'
import { fetchModelManifest, serverSink, type MeetingSink, type ModelManifest } from './api'
import { MODEL_BASE } from './hub'
import { labelTranscript, pruneMinorSpeakers, renumberByFirstAppearance, type SpeakerTurn, type TranscriptChunk, type TranscriptSegment } from './diarization/label'
import type { ParakeetWorkerRequest, ParakeetWorkerResponse } from './parakeet.worker'
import type { DiarizationWorkerRequest, DiarizationWorkerResponse } from './diarization.worker'
import type { TranscribeWord } from './types'
import { isLocalMode } from '../local/mode'
import { setLocalActivity } from '../local/activity'

const SAMPLE_RATE = 16_000
const STORAGE_PLAN = 'meetscribe_ondevice_plan'

export type OnDevicePhase = 'idle' | 'loading' | 'ready' | 'diarizing' | 'finalizing' | 'error' | 'fallback'

export interface DownloadState {
	loaded: number
	total: number
	startedAt: number
	bytesPerSec: number
	/** Every file is on disk; the model is now being loaded into memory. */
	done: boolean
	/** All files came from the on-disk cache (no network). */
	cached: boolean
	/** When `done` flipped, so the panel can show how long loading takes. */
	doneAt: number | null
}

export interface OnDeviceState {
	enabled: boolean
	planChoice: PlanChoice
	plan: ParakeetPlan | null
	caps: DeviceCapabilities | null
	phase: OnDevicePhase
	error: string | null
	download: DownloadState | null
	/** Worker's own description of what it is doing right now. */
	statusText: string | null
	/** Last console lines from the worker (parakeet.js / ORT), newest last. */
	log: string[]
	/** Set when the GPU plan failed and the CPU plan was loaded instead. */
	autoFallbackPlan: ParakeetPlan | null
	autoFallbackReason: string | null
	modelLoadMs: number | null
	backend: 'webgpu' | 'wasm' | null
	threads: number | null
	transcription: { done: number; queued: number; audioSeconds: number; processMs: number }
	/**
	 * Everything transcribed so far, in chunk order. A local meeting is never
	 * polled, so without this the recording page had no live transcript at all
	 * — the text existed, it just never left the worker's bookkeeping.
	 */
	transcript: string
	diarization: { stage: string | null; done: number; total: number; ms: number | null; speakers: number | null; modelBytes: number | null; modelLoadMs: number | null }
}

export interface OnDeviceController {
	state: OnDeviceState
	setPlanChoice: (choice: PlanChoice) => void
	/** True when a meeting started now would be processed on this device. */
	isUsable: boolean
	/**
	 * Start a meeting. `sink` decides where the results go — omit it and they
	 * go to the server, exactly as before.
	 */
	beginMeeting: (meetingId: string, sink?: MeetingSink) => void
	addChunk: (blob: Blob, index: number) => void
	/** Drain, diarize, hand over. Resolves once the server has the transcript. */
	finish: () => Promise<void>
	/** What the status box should say while the server still reports nothing. */
	localStage: 'diarizing' | 'summarizing' | null
}

const initialState = (): OnDeviceState => ({
	// Driven by Local mode, not a switch of its own. There used to be a
	// separate "transcribe on device" toggle, which meant a meeting could be
	// half-private — transcribed here, summarized in the cloud.
	enabled: isLocalMode(),
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
	statusText: null,
	log: [],
	autoFallbackPlan: null,
	autoFallbackReason: null,
	modelLoadMs: null,
	backend: null,
	threads: null,
	transcription: { done: 0, queued: 0, audioSeconds: 0, processMs: 0 },
	transcript: '',
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
	const sinkRef = useRef<MeetingSink | null>(null)
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

	const plan = useMemo(() => {
		if (!state.caps) return null
		if (state.planChoice === 'auto' && state.autoFallbackPlan) return state.autoFallbackPlan
		return resolvePlan(state.planChoice, state.caps)
	}, [state.caps, state.planChoice, state.autoFallbackPlan])

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
			patch({ phase: 'loading', error: null, plan: chosen, download: null, statusText: null, log: [], modelLoadMs: null, backend: null })

			const parakeet = new Worker(new URL('./parakeet.worker.ts', import.meta.url), { type: 'module' })
			parakeetRef.current = parakeet
			const fail = (message: string) => {
				// The GPU plan can fail for reasons the CPU plan does not share
				// (fp16 files missing, GPU memory, driver quirks). When the plan
				// was picked automatically, try the CPU one before giving up.
				if (chosen === 'gpu-fp16' && stateRef.current.planChoice === 'auto' && !stateRef.current.autoFallbackPlan) {
					patch({ autoFallbackPlan: 'cpu-int8', autoFallbackReason: message })
					return
				}
				patch({ phase: 'error', error: `Parakeet failed to load: ${message} — flip the switch off and on to retry, or pick the other plan.` })
			}
			parakeetReady.current = new Promise<void>((resolve, reject) => {
				parakeet.onmessage = (event: MessageEvent<ParakeetWorkerResponse>) => {
					const msg = event.data
					if (msg.type === 'download') {
						patch((s) => {
							const loaded = Object.values(msg.files).reduce((sum, f) => sum + f.loaded, 0)
							const total = Object.values(msg.files).reduce((sum, f) => sum + f.total, 0)
							const startedAt = s.download?.startedAt ?? Date.now()
							const elapsed = (Date.now() - startedAt) / 1000
							return { statusText: null, download: { loaded, total, startedAt, bytesPerSec: elapsed > 0.5 ? loaded / elapsed : 0, done: false, cached: msg.cached, doneAt: null } }
						})
					} else if (msg.type === 'downloaded') {
						patch((s) => ({
							download: {
								...(s.download ?? { startedAt: Date.now(), bytesPerSec: 0 }),
								loaded: msg.bytes,
								total: msg.bytes,
								cached: msg.cached,
								done: true,
								doneAt: Date.now(),
							},
						}))
					} else if (msg.type === 'status') {
						patch({ statusText: msg.text })
					} else if (msg.type === 'log') {
						patch((s) => ({ log: [...s.log.slice(-29), `${msg.level === 'error' ? '❌ ' : msg.level === 'warn' ? '⚠️ ' : ''}${msg.text}`] }))
					} else if (msg.type === 'loaded') {
						patch((s) => ({
							phase: 'ready',
							statusText: null,
							modelLoadMs: msg.loadMs,
							backend: msg.backend,
							threads: msg.threads,
							download: s.download
								? { ...s.download, done: true, cached: msg.cached, loaded: msg.downloadBytes, total: msg.downloadBytes }
								: { loaded: msg.downloadBytes, total: msg.downloadBytes, startedAt: Date.now(), bytesPerSec: 0, done: true, cached: msg.cached, doneAt: Date.now() },
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
							fail(`${msg.stage ? `${msg.stage}: ` : ''}${msg.message}`)
							reject(new Error(msg.message))
						}
					}
				}
				parakeet.onerror = (e) => {
					fail(`worker crashed: ${e.message}`)
					reject(new Error(e.message))
				}
			})
			parakeetReady.current.catch(() => {})
			parakeet.postMessage({ type: 'load', plan: chosen, modelBase: MODEL_BASE } satisfies ParakeetWorkerRequest)

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

	/**
	 * Nothing is fetched until a meeting starts.
	 *
	 * This used to load the moment Local mode was switched on, so that the
	 * download was over before the meeting began. It also meant that simply
	 * *having* the switch on pulled ~700 MB of Parakeet plus the diarization
	 * models every time the record page was opened — seventeen requests
	 * before the user had touched anything — and put "Reading model 3%" in
	 * the top bar of a page where nothing had been asked for.
	 *
	 * So the models are armed by `beginMeeting` instead. The first chunk
	 * waits on the load, which costs the first thirty seconds of a meeting
	 * and is the trade the user asked for. Staying armed afterwards keeps a
	 * second recording instant.
	 */
	const [armed, setArmed] = useState(false)

	useEffect(() => {
		if (!state.enabled) {
			if (state.phase !== 'idle' || state.plan !== null) {
				terminateWorkers()
				patch({ phase: 'idle', error: null, download: null, plan: null, statusText: null, log: [], autoFallbackPlan: null, autoFallbackReason: null })
			}
			setArmed(false)
			return
		}
		if (!armed) return
		if (!plan) return
		if (meetingIdRef.current && state.plan === plan) return // never swap models mid-meeting
		// Load once per plan. A failed load stays failed until the user flips
		// the switch (or picks another plan) — no silent retry loop.
		if (state.plan !== plan || state.phase === 'idle') loadWorkers(plan)
	}, [state.enabled, armed, plan, state.plan, state.phase, loadWorkers, terminateWorkers, patch])

	// Local mode lives in localStorage and can be flipped from the toggle or
	// another tab; this keeps the pipeline in step with it.
	useEffect(() => {
		const sync = () => patch({ enabled: isLocalMode() })
		window.addEventListener('storage', sync)
		window.addEventListener('meetscribe:localmode', sync)
		return () => {
			window.removeEventListener('storage', sync)
			window.removeEventListener('meetscribe:localmode', sync)
		}
	}, [patch])

	// ---- the top bar's one-line "what is happening" -----------------------
	//
	// Derived rather than pushed from each message handler: the phase and the
	// counters already say everything the indicator shows, and a single place
	// to map them means the record page and the summary page cannot disagree
	// about what the device is doing.
	const { enabled, phase, download, transcription, diarization } = state
	useEffect(() => {
		if (!enabled) return setLocalActivity(null)
		if (phase === 'loading') {
			if (download && !download.done && download.total > 0) {
				return setLocalActivity({
					label: download.cached ? 'Reading model' : 'Fetching speech model',
					progress: download.loaded / download.total,
				})
			}
			return setLocalActivity({ label: 'Loading model', progress: null })
		}
		if (phase === 'diarizing') {
			return setLocalActivity({
				label: 'Finding speakers',
				progress: diarization.total > 0 ? diarization.done / diarization.total : null,
			})
		}
		if (phase === 'finalizing') return setLocalActivity({ label: 'Finishing up', progress: null })
		if (phase === 'ready' && transcription.queued > 0) {
			const total = transcription.done + transcription.queued
			return setLocalActivity({
				label: 'Transcribing',
				progress: total > 0 ? transcription.done / total : null,
				detail: `${transcription.done} of ${total} chunks transcribed on this device`,
			})
		}
		return setLocalActivity(null)
	}, [enabled, phase, download, transcription, diarization])

	// Leaving the page must not leave a stale pill behind.
	useEffect(() => () => setLocalActivity(null), [])

	useEffect(() => () => terminateWorkers(), [terminateWorkers])

	const setPlanChoice = useCallback(
		(choice: PlanChoice) => {
			try {
				localStorage.setItem(STORAGE_PLAN, choice)
			} catch {
				/* private mode */
			}
			patch({ planChoice: choice, autoFallbackPlan: null, autoFallbackReason: null })
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
			// Rebuilt from the chunk map rather than appended, because chunks
			// finish out of order and the transcript has to read in order.
			const soFar = [...chunksRef.current.keys()]
				.sort((a, b) => a - b)
				.map((i) => chunksRef.current.get(i)?.text ?? '')
				.filter(Boolean)
				.join(' ')
				.trim()
			patch((s) => ({
				transcript: soFar,
				transcription: {
					done: s.transcription.done + 1,
					queued: Math.max(0, s.transcription.queued - 1),
					audioSeconds: s.transcription.audioSeconds + result.audioSeconds,
					processMs: s.transcription.processMs + result.ms,
				},
			}))
			const sink = sinkRef.current
			try {
				await sink?.putChunk(index, result.text, record.segments, result.audioSeconds)
			} catch (err) {
				console.warn('Retrying chunk transcript hand-off once:', err)
				await sink?.putChunk(index, result.text, record.segments, result.audioSeconds).catch((e) => console.error(e))
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
		(meetingId: string, sink?: MeetingSink) => {
			// The moment the models are actually needed. Everything up to here
			// has cost the user nothing.
			setArmed(true)
			meetingIdRef.current = meetingId
			sinkRef.current = sink ?? serverSink(meetingId)
			chunksRef.current = new Map()
			queueRef.current = []
			inFlightRef.current = null
			decodingRef.current = 0
			drainWaitersRef.current = []
			patch({
				transcript: '',
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
		const sink = sinkRef.current ?? serverSink(meetingId)
		const heartbeat = setInterval(() => sink.heartbeat(), 60_000)

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
				download: s.download ? { bytes: s.download.total, ms: s.download.cached ? 0 : Math.round((s.download.loaded / Math.max(s.download.bytesPerSec, 1)) * 1000), cached: s.download.cached } : null,
				model_load_ms: s.modelLoadMs,
				transcription: { chunks: s.transcription.done, audio_seconds: Math.round(s.transcription.audioSeconds), process_ms: Math.round(s.transcription.processMs) },
				diarization: { audio_seconds: durationSeconds, ms: diarizationMs === null ? null : Math.round(diarizationMs), speakers, model_bytes: s.diarization.modelBytes, model_load_ms: s.diarization.modelLoadMs },
				device: { webgpu: s.caps?.webgpu ?? null, fp16: s.caps?.fp16 ?? null, cross_origin_isolated: s.caps?.crossOriginIsolated ?? null, cores: s.caps?.cores ?? null, memory_gb: s.caps?.memoryGb ?? null, mobile: s.caps?.isMobile ?? null, user_agent: navigator.userAgent },
			}

			patch({ phase: 'finalizing' })
			await sink.finalize({
				transcript,
				// Chunk-relative timings, shifted onto the meeting's own clock —
				// the only form that survives without the audio to re-derive them.
				segments: chunks.flatMap((c) => {
					const offset = c.offset ?? 0
					return c.segments.map((seg) => ({ ...seg, start: seg.start + offset, end: seg.end + offset }))
				}),
				speakerCount: speakers,
				durationSeconds,
				clientStats,
			})
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			if (sink.requestFallback) {
				// The server already has the audio, so it can simply take over.
				console.error('On-device processing failed; falling back to the server.', err)
				patch({ phase: 'fallback', error: message })
				await sink.requestFallback()
			} else {
				// A local meeting never uploaded anything, so there is nothing to
				// fall back to without the user's say-so. Stop here and let the
				// page ask; `error` is what it shows them.
				console.error('On-device processing failed and this meeting is local; awaiting consent.', err)
				patch({ phase: 'error', error: message })
			}
		} finally {
			clearInterval(heartbeat)
			meetingIdRef.current = null
			sinkRef.current = null
			chunksRef.current = new Map()
		}
	}, [patch])

	// A failed load while a meeting is running means the server must take over.
	useEffect(() => {
		if (state.phase === 'error' && meetingIdRef.current) {
			const fallback = sinkRef.current?.requestFallback
			// Local meetings have nothing on the server to take over; the page
			// asks for consent instead of this firing silently.
			if (!fallback) return
			meetingIdRef.current = null
			sinkRef.current = null
			patch({ phase: 'fallback' })
			fallback().catch(console.error)
		}
	}, [state.phase, patch])

	/**
	 * Would a meeting started now be handled here?
	 *
	 * "Local mode is on and nothing has failed" — deliberately not "the model
	 * is already loaded". `useRecording` reads this to decide where a meeting
	 * goes, and the models are no longer fetched until a meeting starts, so
	 * requiring them to be resident first would send every first recording of
	 * a session to the server while the switch said "On device". A failed or
	 * abandoned load still says no, which is what hands the next meeting to
	 * the server on purpose.
	 */
	const isUsable = state.enabled && state.phase !== 'error' && state.phase !== 'fallback'
	const localStage = state.phase === 'diarizing' ? 'diarizing' : state.phase === 'finalizing' ? 'summarizing' : null

	return { state: { ...state, plan }, setPlanChoice, isUsable, beginMeeting, addChunk, finish, localStage }
}
