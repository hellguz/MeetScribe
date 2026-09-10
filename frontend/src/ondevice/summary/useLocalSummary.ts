/**
 * Drives the on-device summariser for a local meeting.
 *
 *   local transcript ──▶ buildSummaryPrompt ──▶ summarizer.worker ──▶ markdown
 *                                                        │
 *                                                        └─▶ IndexedDB
 *
 * This used to produce a run *beside* the Claude summary, for comparison. It
 * now produces the summary itself: a local meeting has no other one, and the
 * result is written straight onto the stored meeting.
 *
 * The prompt is built here rather than fetched from /summary-prompt, which
 * needs a transcript the server was never given. See `local/prompt.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSummaryPrompt } from '../../local/prompt'
import { getLocalMeeting, patchLocalMeeting } from '../../local/store'
import { saveMeeting } from '../../utils/history'
import { getLocalSummaryModel } from './pref'
import { getSummaryWorker, terminateSummaryWorker } from './worker'
import type { SummaryLength as LocalSummaryLength } from '../../contexts/SummaryLengthContext'

export type LocalSummaryPhase = 'idle' | 'prompt' | 'loading' | 'prefilling' | 'generating' | 'saving' | 'done' | 'error'

/**
 * Claude gets max_tokens 8096 for the same job. Local decode runs at tens of
 * tokens a second, so an 8k cap would mean a five-minute tail on a model
 * that had already said everything; 3k covers the longest stored summary
 * (~2.6k tokens) with headroom.
 */
const MAX_NEW_TOKENS = 3072

export interface LocalSummaryState {
	phase: LocalSummaryPhase
	statusText: string | null
	error: string | null
	log: string[]
	download: { loaded: number; total: number; file: string | null } | null
	/**
	 * What the worker found to run on, reported before the download starts.
	 * Named rather than assumed: "GPU" on the old panel was a hard-coded
	 * string, and a machine that quietly has no adapter looked identical.
	 */
	hardware: { device: string; adapter: string | null; maxBufferSize: number | null; threads: number | null; cores: number | null } | null
	/** Prompt tokens already in the KV cache, updated once per slice. */
	prefill: { processed: number; total: number; tokensPerSecond: number | null; etaMs: number | null } | null
	/** Tokens written so far, against the cap the run was given. */
	decode: { tokens: number; max: number; tokensPerSecond: number | null } | null
	/** Markdown as it streams in, before the run is saved. */
	streaming: string
	/** Filled progressively so the panel can show numbers as they land. */
	measured: {
		device: string | null
		dtype: string | null
		loadMs: number | null
		downloadBytes: number | null
		downloadMs: number | null
		cached: boolean
		promptChars: number | null
		promptTokens: number | null
		prefillMs: number | null
		outputTokens: number | null
		decodeMs: number | null
		totalMs: number | null
	}
}

const emptyMeasured = (): LocalSummaryState['measured'] => ({
	device: null,
	dtype: null,
	loadMs: null,
	downloadBytes: null,
	downloadMs: null,
	cached: false,
	promptChars: null,
	promptTokens: null,
	prefillMs: null,
	outputTokens: null,
	decodeMs: null,
	totalMs: null,
})

const initialState = (): LocalSummaryState => ({
	phase: 'idle',
	statusText: null,
	error: null,
	log: [],
	download: null,
	hardware: null,
	prefill: null,
	decode: null,
	streaming: '',
	measured: emptyMeasured(),
})

export function useLocalSummary(meetingId: string | undefined) {
	const [state, setState] = useState<LocalSummaryState>(initialState)
	const workerRef = useRef<Worker | null>(null)
	// Set for the duration of a run so the message handler knows what to
	// store; a worker message carries measurements, not the settings.
	const runContextRef = useRef<{ model: string; summaryLength: string; targetLanguage: string; maxNewTokens: number } | null>(null)
	const measuredRef = useRef(emptyMeasured())

	/** WebGPU is not optional here: 4-bit weights on WASM would take hours. */
	const webgpuAvailable = useMemo(() => typeof navigator !== 'undefined' && 'gpu' in navigator, [])

	// Deliberately not terminated on unmount: the worker is shared and holds a
	// ~3 GB model that the next page would otherwise have to load again.
	useEffect(() => () => {
		workerRef.current = null
	}, [])

	const generate = useCallback(
		async (summaryLength: string) => {
			if (!meetingId) return
			// Read at click time, not from the hook's own state: the panel
			// owns these controls and may have changed them since render.
			const model = getLocalSummaryModel()

			measuredRef.current = emptyMeasured()
			setState({ ...initialState(), phase: 'prompt', statusText: 'Reading the transcript…' })

			let prompt: Awaited<ReturnType<typeof buildSummaryPrompt>>
			try {
				const meeting = await getLocalMeeting(meetingId)
				if (!meeting) throw new Error('This meeting is not stored on this device.')
				if (!meeting.transcript.trim()) throw new Error('There is no transcript to summarize.')
				prompt = await buildSummaryPrompt({
					transcript: meeting.transcript,
					summaryLength: summaryLength || meeting.summary_length,
					languageMode: meeting.summary_language_mode,
					customLanguage: meeting.summary_custom_language,
					context: meeting.context,
					meetingDate: meeting.started_at.slice(0, 10),
					durationSeconds: meeting.duration_seconds,
				})
			} catch (e) {
				setState((s) => ({ ...s, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
				return
			}

			const maxNewTokens = MAX_NEW_TOKENS
			runContextRef.current = { model, summaryLength: prompt.summaryLength, targetLanguage: prompt.targetLanguage, maxNewTokens }
			measuredRef.current.promptChars = prompt.promptChars
			setState((s) => ({
				...s,
				phase: 'loading',
				statusText: 'Starting the model…',
				measured: { ...s.measured, promptChars: prompt.promptChars },
			}))

			if (!workerRef.current) {
				// Shared with the preloader, so a model fetched while the meeting
				// was still recording is already resident here.
				workerRef.current = getSummaryWorker()
				workerRef.current.addEventListener('message', async (event: MessageEvent) => {
					const msg = event.data as import('./summarizer.worker').SummarizerResponse
					switch (msg.type) {
						case 'log':
							setState((s) => ({ ...s, log: [...s.log.slice(-60), msg.line] }))
							break
						case 'status':
							setState((s) => ({ ...s, statusText: msg.text }))
							break
						case 'download':
							setState((s) => ({ ...s, download: { loaded: msg.loaded, total: msg.total, file: msg.file } }))
							break
						case 'device': {
							const adapter =
								[msg.adapter?.vendor, msg.adapter?.architecture, msg.adapter?.device].filter(Boolean).join(' ') || msg.adapter?.description || null
							Object.assign(measuredRef.current, { device: msg.device })
							setState((s) => ({
								...s,
								hardware: { device: msg.device, adapter, maxBufferSize: msg.adapter?.maxBufferSize ?? null, threads: msg.threads, cores: msg.cores },
								measured: { ...s.measured, device: msg.device },
							}))
							break
						}
						case 'prefill': {
							// Rate over the whole prefill so far, not the last
							// slice: slices vary, the average does not.
							const rate = msg.ms > 0 && msg.processed > 0 ? msg.processed / (msg.ms / 1000) : null
							setState((s) => ({
								...s,
								prefill: {
									processed: msg.processed,
									total: msg.total,
									tokensPerSecond: rate,
									etaMs: rate ? ((msg.total - msg.processed) / rate) * 1000 : null,
								},
							}))
							break
						}
						case 'decode': {
							const ctx = runContextRef.current
							setState((s) => ({
								...s,
								decode: { tokens: msg.tokens, max: ctx?.maxNewTokens ?? msg.tokens, tokensPerSecond: msg.ms > 0 ? msg.tokens / (msg.ms / 1000) : null },
							}))
							break
						}
						case 'loaded':
							Object.assign(measuredRef.current, {
								device: msg.device,
								dtype: msg.dtype,
								loadMs: msg.loadMs,
								downloadBytes: msg.downloadBytes,
								downloadMs: msg.downloadMs,
								cached: msg.cached,
							})
							setState((s) => ({
								...s,
								phase: 'prefilling',
								statusText: 'Reading the transcript (prefill)…',
								measured: { ...s.measured, ...measuredRef.current },
							}))
							break
						case 'prefilled':
							Object.assign(measuredRef.current, { promptTokens: msg.promptTokens, prefillMs: msg.prefillMs })
							setState((s) => ({
								...s,
								phase: 'generating',
								statusText: 'Writing the summary…',
								// The last slice is only counted here: it is the
								// streaming call that reads it, not the loop.
								prefill: {
									processed: msg.promptTokens,
									total: msg.promptTokens,
									tokensPerSecond: msg.prefillMs > 0 ? msg.promptTokens / (msg.prefillMs / 1000) : null,
									etaMs: 0,
								},
								measured: { ...s.measured, ...measuredRef.current },
							}))
							break
						case 'token':
							setState((s) => ({ ...s, streaming: s.streaming + msg.text }))
							break
						case 'done': {
							Object.assign(measuredRef.current, { outputTokens: msg.outputTokens, decodeMs: msg.decodeMs, totalMs: msg.totalMs })
							const ctx = runContextRef.current
							setState((s) => ({
								...s,
								phase: 'saving',
								statusText: 'Saving to this device…',
								streaming: msg.text,
								measured: { ...s.measured, ...measuredRef.current },
							}))
							if (!ctx) return
							try {
								// The run *is* the summary now: it goes onto the
								// meeting, not into a table beside it.
								const updated = await patchLocalMeeting(meetingId, {
									summary_markdown: msg.text,
									summary_length: ctx.summaryLength as LocalSummaryLength,
									unfinished: false,
								})
								if (updated) {
									saveMeeting({
										id: updated.id,
										title: updated.title,
										started_at: updated.started_at,
										status: 'complete',
										storage: 'local',
									})
								}
								setState((s) => ({ ...s, phase: 'done', statusText: null }))
							} catch (e) {
								// The summary is on screen either way; say plainly
								// that it will not survive a reload.
								setState((s) => ({ ...s, phase: 'error', error: `Generated, but could not be saved: ${e instanceof Error ? e.message : String(e)}` }))
							}
							break
						}
						case 'error':
							setState((s) => ({ ...s, phase: 'error', error: msg.message }))
							break
					}
				})
			}

			workerRef.current.postMessage({ type: 'summarize', prompt: prompt.prompt, model, thinking: false, maxNewTokens })
		},
		[meetingId],
	)

	/**
	 * Terminating is the only way to stop a `generate` already on the GPU,
	 * which also drops the loaded model — the next run pays the load again.
	 */
	const cancel = useCallback(() => {
		terminateSummaryWorker()
		workerRef.current = null
		// The log and the hardware survive: what this machine is does not
		// change because a run was stopped, and the log is the only record
		// of why it was.
		setState((s) => ({ ...initialState(), log: s.log, hardware: s.hardware }))
	}, [])

	const busy = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error'

	return { state, busy, webgpuAvailable, generate, cancel }
}
