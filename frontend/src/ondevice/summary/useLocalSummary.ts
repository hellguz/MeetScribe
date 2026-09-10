/**
 * Drives the on-device summariser for a local meeting.
 *
 *   local transcript ──▶ buildSummaryPrompt ──▶ summarizer.worker ──▶ markdown
 *                                                        │
 *                                                        ├─▶ buildTitlePrompt ──▶ title
 *                                                        │
 *                                                        └─▶ IndexedDB ──▶ onSaved
 *
 * This used to produce a run *beside* the Claude summary, for comparison. It
 * now produces the summary itself: a local meeting has no other one, and the
 * result is written straight onto the stored meeting.
 *
 * The prompt is built here rather than fetched from /summary-prompt, which
 * needs a transcript the server was never given. See `local/prompt.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSummaryPrompt, buildTitlePrompt, cleanTitle, isDefaultTitle } from '../../local/prompt'
import { getLocalMeeting, patchLocalMeeting, type LocalMeeting } from '../../local/store'
import { syncSharedCopy } from '../../local/publish'
import { saveMeeting } from '../../utils/history'
import { setLocalActivity } from '../../local/activity'
import { getLocalSummaryModel } from './pref'
import { getSummaryWorker, terminateSummaryWorker } from './worker'
import type { SummaryLength as LocalSummaryLength } from '../../contexts/SummaryLengthContext'

export type LocalSummaryPhase = 'idle' | 'prompt' | 'loading' | 'prefilling' | 'generating' | 'saving' | 'titling' | 'done' | 'error'

/**
 * Claude gets max_tokens 8096 for the same job. Local decode runs at tens of
 * tokens a second, so an 8k cap would mean a five-minute tail on a model
 * that had already said everything; 3k covers the longest stored summary
 * (~2.6k tokens) with headroom.
 */
const MAX_NEW_TOKENS = 3072

/** A title is 6–15 words. Anything past this is a model ignoring the brief. */
const TITLE_MAX_TOKENS = 64

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

interface Options {
	/**
	 * Called with the stored record every time it changes — once for the
	 * summary, again for the title.
	 *
	 * Without it the run finished, wrote the summary to IndexedDB, and left
	 * the page showing "No summary is available for this meeting", because
	 * the hook that reads the record had no reason to read it again. The
	 * summary appeared on the next reload, which is how it was found.
	 */
	onSaved?: (meeting: LocalMeeting) => void
}

export function useLocalSummary(meetingId: string | undefined, { onSaved }: Options = {}) {
	const [state, setState] = useState<LocalSummaryState>(initialState)
	const workerRef = useRef<Worker | null>(null)
	const listenerRef = useRef<((event: MessageEvent) => void) | null>(null)
	// Set for the duration of a run so the message handler knows what to
	// store; a worker message carries measurements, not the settings.
	const runContextRef = useRef<{ model: string; summaryLength: string; targetLanguage: string; maxNewTokens: number } | null>(null)
	const measuredRef = useRef(emptyMeasured())
	// True between posting 'title' and hearing back, so a failure there is
	// read as "the meeting kept its date for a name" rather than as the
	// summary having failed — the summary is already saved by then.
	const titlingRef = useRef(false)
	// Read through a ref so the worker listener, which is attached once, never
	// closes over a stale callback.
	const onSavedRef = useRef(onSaved)
	onSavedRef.current = onSaved

	/** WebGPU is not optional here: 4-bit weights on WASM would take hours. */
	const webgpuAvailable = useMemo(() => typeof navigator !== 'undefined' && 'gpu' in navigator, [])

	// The worker is deliberately *not* terminated: it is shared and holds a
	// ~3 GB model the next page would otherwise have to load again. The
	// listener does go, or a second mount would write every result twice.
	useEffect(
		() => () => {
			if (workerRef.current && listenerRef.current) workerRef.current.removeEventListener('message', listenerRef.current)
			listenerRef.current = null
			workerRef.current = null
		},
		[],
	)

	// ---- the top bar's one-line "what is happening" ------------------------
	const { phase, download, prefill, decode } = state
	useEffect(() => {
		switch (phase) {
			case 'prompt':
				return setLocalActivity({ label: 'Preparing', progress: null })
			case 'loading':
				return setLocalActivity(
					download && download.total > 0
						? { label: 'Fetching summary model', progress: download.loaded / download.total }
						: { label: 'Loading model', progress: null },
				)
			case 'prefilling':
				return setLocalActivity({
					label: 'Reading transcript',
					progress: prefill && prefill.total > 0 ? prefill.processed / prefill.total : null,
				})
			case 'generating':
				return setLocalActivity({
					label: 'Writing summary',
					progress: null,
					// A token count against the cap is not progress: most runs
					// stop well short of it, so a bar filling to 40% and then
					// vanishing would be a lie. The rate is the honest number.
					detail: decode?.tokensPerSecond ? `${decode.tokens} words so far, ${decode.tokensPerSecond.toFixed(1)}/s` : undefined,
				})
			case 'titling':
				return setLocalActivity({ label: 'Naming meeting', progress: null })
			case 'saving':
				return setLocalActivity({ label: 'Saving', progress: null })
			default:
				return setLocalActivity(null)
		}
	}, [phase, download, prefill, decode])

	useEffect(() => () => setLocalActivity(null), [])

	/** Store a patch, tell the history list, and hand the record to the page. */
	const persist = useCallback(async (id: string, patch: Partial<LocalMeeting>) => {
		const updated = await patchLocalMeeting(id, patch)
		if (!updated) return null
		saveMeeting({
			id: updated.id,
			title: updated.title,
			started_at: updated.started_at,
			status: 'complete',
			storage: 'local',
			// Carried through, or a finished summary would quietly relabel a
			// shared meeting as private in the history list.
			shared_until: updated.shared_until ?? null,
			published: updated.published ?? !!updated.shared_until,
			duration_seconds: updated.duration_seconds,
		})
		onSavedRef.current?.(updated)
		return updated
	}, [])

	const generate = useCallback(
		async (summaryLength: string) => {
			if (!meetingId) return
			// Read at click time, not from the hook's own state: the panel
			// owns these controls and may have changed them since render.
			const model = getLocalSummaryModel()

			measuredRef.current = emptyMeasured()
			titlingRef.current = false
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
				const listener = async (event: MessageEvent) => {
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
							// A title run reuses the same model and re-announces
							// it; that must not drag the phase back to prefill.
							if (titlingRef.current) break
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
								const updated = await persist(meetingId, {
									summary_markdown: msg.text,
									summary_length: ctx.summaryLength as LocalSummaryLength,
									unfinished: false,
								})
								// Naming the meeting is the server's last step
								// too (`generate_title_for_meeting`), and it was
								// simply missing here — every local meeting kept
								// "Recording 10.9.2026, 14:59:33" for a title.
								if (updated && msg.text.trim() && isDefaultTitle(updated.title) && workerRef.current) {
									titlingRef.current = true
									setState((s) => ({ ...s, phase: 'titling', statusText: 'Naming the meeting…' }))
									workerRef.current.postMessage({
										type: 'title',
										prompt: buildTitlePrompt(msg.text, updated.transcript),
										model: ctx.model,
										maxNewTokens: TITLE_MAX_TOKENS,
									})
									return
								}
								// Once, at the end, rather than after each write:
								// the sync uploads the whole record, and a run
								// that also names the meeting writes twice.
								void syncSharedCopy(updated ?? (await getLocalMeeting(meetingId))!)
								setState((s) => ({ ...s, phase: 'done', statusText: null }))
							} catch (e) {
								// The summary is on screen either way; say plainly
								// that it will not survive a reload.
								setState((s) => ({ ...s, phase: 'error', error: `Generated, but could not be saved: ${e instanceof Error ? e.message : String(e)}` }))
							}
							break
						}
						case 'titled': {
							titlingRef.current = false
							const title = cleanTitle(msg.text)
							try {
								// An empty or unusable answer leaves the date in
								// place, which is a fine name for a meeting.
								const updated = title ? await persist(meetingId, { title }) : await getLocalMeeting(meetingId)
								if (updated) void syncSharedCopy(updated)
							} catch (e) {
								console.warn('Could not store the generated title:', e)
							}
							setState((s) => ({ ...s, phase: 'done', statusText: null }))
							break
						}
						case 'error':
							// A failed title is not a failed summary: that one is
							// already in IndexedDB and on screen.
							if (titlingRef.current) {
								titlingRef.current = false
								console.warn('On-device title generation failed:', msg.message)
								setState((s) => ({ ...s, phase: 'done', statusText: null, log: [...s.log.slice(-60), `[title] ${msg.message}`] }))
								break
							}
							setState((s) => ({ ...s, phase: 'error', error: msg.message }))
							break
					}
				}
				listenerRef.current = listener
				workerRef.current.addEventListener('message', listener)
			}

			workerRef.current.postMessage({ type: 'summarize', prompt: prompt.prompt, model, thinking: false, maxNewTokens })
		},
		[meetingId, persist],
	)

	/**
	 * Terminating is the only way to stop a `generate` already on the GPU,
	 * which also drops the loaded model — the next run pays the load again.
	 */
	const cancel = useCallback(() => {
		terminateSummaryWorker()
		workerRef.current = null
		listenerRef.current = null
		titlingRef.current = false
		// The log and the hardware survive: what this machine is does not
		// change because a run was stopped, and the log is the only record
		// of why it was.
		setState((s) => ({ ...initialState(), log: s.log, hardware: s.hardware }))
	}, [])

	const busy = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error'

	return { state, busy, webgpuAvailable, generate, cancel }
}
