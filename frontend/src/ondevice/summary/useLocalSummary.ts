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
import {
	getLocalMeeting,
	patchLocalMeeting,
	beginSummaryRun,
	touchSummaryRun,
	endSummaryRun,
	summaryRunOf,
	summaryRunIsLive,
	liveSummaryRunElsewhere,
	type LocalMeeting,
} from '../../local/store'
import { syncSharedCopy } from '../../local/publish'
import { saveMeeting } from '../../utils/history'
import { setLocalActivity } from '../../local/activity'
import { getLocalSummaryModel } from './pref'
import { getSummaryWorker, setSummaryListener, terminateSummaryWorker } from './worker'
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

/**
 * How often the run's claim on the meeting is written to disk.
 *
 * Well under `SUMMARY_RUN_STALE_MS`, so a live run is never mistaken for a
 * dead one, and well over a token, so the write does not compete with the
 * decode loop for the main thread.
 */
const HEARTBEAT_MS = 15_000

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
	/**
	 * The other meeting holding the graphics card, if a start was refused.
	 *
	 * Not an error: nothing has gone wrong and nothing needs doing. The run
	 * is waiting, and `useSummaryResume` starts it when the card is free.
	 */
	blockedBy: string | null
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
	blockedBy: null,
	measured: emptyMeasured(),
})

/**
 * What the page is shown while the in-flight run belongs to another meeting.
 *
 * One frozen instance rather than a fresh object per render: it goes into
 * effect dependency arrays, and a new identity each time would re-run them
 * forever.
 */
const IDLE_STATE: LocalSummaryState = Object.freeze(initialState())

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
	/**
	 * Which meeting the in-flight run belongs to, and which one the page is
	 * showing. Usually the same; they come apart when someone navigates
	 * mid-run, and the whole point is that a run survives that — the worker
	 * keeps going and the summary still lands on the meeting it was for.
	 *
	 * Both are needed because moving between `/summary/:mid` routes does not
	 * remount this page, so one hook instance sees several meetings and one
	 * worker listener sees several runs. Without them:
	 *
	 *   · the listener, attached on the first run, wrote every later run's
	 *     summary onto that first meeting;
	 *   · a finished run handed its record to `onSaved`, which applied it to
	 *     whichever meeting was on screen by then;
	 *   · and a run that was still loading its model kept the dial saying
	 *     "Loading model" over a meeting the reader had just opened, with no
	 *     panel to explain it, because that meeting was somebody's share and
	 *     had nothing to do with it.
	 */
	const runMeetingIdRef = useRef<string | null>(null)
	const pageMeetingIdRef = useRef(meetingId)
	pageMeetingIdRef.current = meetingId
	// The same fact as `runMeetingIdRef`, in state, because the render needs it.
	const [runMeetingId, setRunMeetingId] = useState<string | null>(null)
	const claimRun = useCallback((id: string | null) => {
		runMeetingIdRef.current = id
		setRunMeetingId(id)
	}, [])
	/** True while the run in flight is about some other meeting. */
	const runningElsewhere = runMeetingId !== null && runMeetingId !== meetingId
	/** Does a worker message concern the meeting currently on screen? */
	const forThisPage = useCallback(() => runMeetingIdRef.current !== null && runMeetingIdRef.current === pageMeetingIdRef.current, [])
	// Read through a ref so the worker listener, which is attached once, never
	// closes over a stale callback.
	const onSavedRef = useRef(onSaved)
	onSavedRef.current = onSaved

	/** WebGPU is not optional here: 4-bit weights on WASM would take hours. */
	const webgpuAvailable = useMemo(() => typeof navigator !== 'undefined' && 'gpu' in navigator, [])

	// The worker is deliberately *not* terminated on unmount: it is shared and
	// holds a ~3 GB model the next page would otherwise have to load again.
	//
	// Nor is the listener detached any more. It used to be, to stop a second
	// mount writing every result twice — but that also meant leaving the
	// summary page mid-run dropped the result on the floor. `setSummaryListener`
	// keeps exactly one attached instead, so the run that outlives this page
	// still writes its summary to IndexedDB (and still beats, so no other tab
	// starts a second one over the top of it). The `setState` calls it makes
	// afterwards land on an unmounted component, which React ignores.
	useEffect(
		() => () => {
			workerRef.current = null
		},
		[],
	)

	// ---- the top bar's one-line "what is happening" ------------------------
	const { phase, download, prefill, decode } = state
	useEffect(() => {
		// A run for another meeting is not this page's story to tell.
		if (runningElsewhere) return setLocalActivity('summary', null)
		switch (phase) {
			case 'prompt':
				return setLocalActivity('summary', { label: 'Preparing', progress: null })
			case 'loading':
				return setLocalActivity(
					'summary',
					download && download.total > 0
						? { label: 'Fetching summary model', progress: download.loaded / download.total }
						: { label: 'Loading model', progress: null },
				)
			case 'prefilling':
				return setLocalActivity('summary', {
					label: 'Reading transcript',
					progress: prefill && prefill.total > 0 ? prefill.processed / prefill.total : null,
				})
			case 'generating':
				return setLocalActivity('summary', {
					label: 'Writing summary',
					progress: null,
					// A token count against the cap is not progress: most runs
					// stop well short of it, so a bar filling to 40% and then
					// vanishing would be a lie. The rate is the honest number.
					detail: decode?.tokensPerSecond ? `${decode.tokens} words so far, ${decode.tokensPerSecond.toFixed(1)}/s` : undefined,
				})
			case 'titling':
				return setLocalActivity('summary', { label: 'Naming meeting', progress: null })
			case 'saving':
				return setLocalActivity('summary', { label: 'Saving', progress: null })
			default:
				return setLocalActivity('summary', null)
		}
	}, [runningElsewhere, phase, download, prefill, decode])

	useEffect(() => () => setLocalActivity('summary', null), [])

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
			summary_pending: !updated.summary_markdown,
		})
		// Only the page that is actually showing this meeting wants it.
		if (id === pageMeetingIdRef.current) onSavedRef.current?.(updated)
		return updated
	}, [])

	/**
	 * Keep the stored run's claim alive while the GPU is busy.
	 *
	 * Throttled hard: this is an IndexedDB write on the same thread as a page
	 * rendering streamed tokens, and its only reader is another tab deciding
	 * whether this run is still alive — which it does against a 90-second
	 * staleness window.
	 */
	const lastBeatRef = useRef(0)
	/** Set when a start was refused because another run holds the meeting. */
	const liveElsewhereRef = useRef(false)
	const beat = useCallback((id: string | null) => {
		if (!id) return
		const now = Date.now()
		if (now - lastBeatRef.current < HEARTBEAT_MS) return
		lastBeatRef.current = now
		void touchSummaryRun(id).catch(() => {
			/* a missed beat costs nothing; the next one covers it */
		})
	}, [])

	const generate = useCallback(
		async (summaryLength: string, options: { manual?: boolean } = {}): Promise<boolean> => {
			if (!meetingId) return false
			// One model on one GPU. Two `generate` calls would drive the same
			// session at once, and the second would also take ownership of the
			// first's results.
			if (runMeetingIdRef.current !== null && runMeetingIdRef.current !== meetingId) {
				console.warn('The summariser is still working on another meeting; not starting a second run.')
				return false
			}
			// Read at click time, not from the hook's own state: the panel
			// owns these controls and may have changed them since render.
			const model = getLocalSummaryModel()

			measuredRef.current = emptyMeasured()
			titlingRef.current = false
			claimRun(meetingId)
			setState({ ...initialState(), phase: 'prompt', statusText: 'Reading the transcript…' })

			let prompt: Awaited<ReturnType<typeof buildSummaryPrompt>>
			try {
				const meeting = await getLocalMeeting(meetingId)
				if (!meeting) throw new Error('This meeting is not stored on this device.')
				if (!meeting.transcript.trim()) throw new Error('There is no transcript to summarize.')
				// Somebody is already writing this one — another tab, or a run
				// this browser started on a page since navigated away from,
				// which keeps going and keeps beating. Starting a second run
				// would put two sessions on one graphics card and have them
				// race to store the result.
				//
				// A run whose heartbeat has stopped is *not* live, which is
				// what makes the closed-tab case resumable rather than locked
				// out by its own leftover claim.
				if (summaryRunIsLive(summaryRunOf(meeting))) {
					liveElsewhereRef.current = true
					throw new Error('A summary for this meeting is already being written in this browser. It will appear here as soon as it finishes.')
				}
				// And no other meeting may be on the GPU either. The worker's
				// replies do not say which meeting they belong to, so a second
				// run started over a first one files the first one's summary
				// against the second one's meeting.
				const otherMeeting = await liveSummaryRunElsewhere(meetingId)
				if (otherMeeting) {
					// Left idle rather than failed, so `useSummaryResume` keeps
					// asking and starts this one the moment the card is free.
					// An error phase would stop it, and the panel would be
					// promising a wait that nothing was going to end.
					claimRun(null)
					setState({ ...initialState(), blockedBy: otherMeeting })
					return false
				}
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
				const message = e instanceof Error ? e.message : String(e)
				// A run already in flight is not a failure of the record: its
				// own `running` claim is correct and must be left alone.
				// Anything else is worth writing down, so the panel is not
				// left offering a button that will fail the same way with no
				// explanation of why.
				if (liveElsewhereRef.current) liveElsewhereRef.current = false
				else void endSummaryRun(meetingId, 'failed', message).catch(() => {})
				claimRun(null)
				setState((s) => ({ ...s, phase: 'error', error: message }))
				return false
			}

			// Claim the meeting on disk before touching the GPU. This is what
			// survives the tab: a record left saying `running` with a
			// heartbeat that stops is exactly how the next tab to open the
			// meeting knows a summary is owed and nobody is producing it.
			try {
				await beginSummaryRun(meetingId, options.manual === true)
				lastBeatRef.current = Date.now()
			} catch (e) {
				// Not fatal. The run can still produce a summary; it just
				// cannot be resumed automatically if this tab goes away.
				console.warn('Could not record the start of the summary run:', e)
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

			{
				// Shared with the preloader, so a model fetched while the meeting
				// was still recording is already resident here.
				workerRef.current = getSummaryWorker()
				const listener = async (event: MessageEvent) => {
					const msg = event.data as import('./summarizer.worker').SummarizerResponse
					// The meeting this message is about — the run's, not the
					// page's, and not the one whose `generate` call happened to
					// attach this listener.
					const runId = runMeetingIdRef.current
					// Progress is only worth rendering if the reader is looking
					// at the meeting it belongs to. Results are stored either
					// way: navigating away must not throw the summary out.
					const visible = forThisPage()
					switch (msg.type) {
						case 'log':
							if (visible) setState((s) => ({ ...s, log: [...s.log.slice(-60), msg.line] }))
							break
						case 'status':
							// Loading a cached model reports little else for
							// tens of seconds at a time, and a run whose beat
							// lapses looks dead to every other tab.
							beat(runId)
							if (visible) setState((s) => ({ ...s, statusText: msg.text }))
							break
						case 'download':
							beat(runId)
							if (visible) setState((s) => ({ ...s, download: { loaded: msg.loaded, total: msg.total, file: msg.file } }))
							break
						case 'device': {
							if (!visible) break
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
							beat(runId)
							if (!visible) break
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
							beat(runId)
							if (!visible) break
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
							if (titlingRef.current || !visible) break
							setState((s) => ({
								...s,
								phase: 'prefilling',
								statusText: 'Reading the transcript (prefill)…',
								measured: { ...s.measured, ...measuredRef.current },
							}))
							break
						case 'prefilled':
							Object.assign(measuredRef.current, { promptTokens: msg.promptTokens, prefillMs: msg.prefillMs })
							if (!visible) break
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
							if (visible) setState((s) => ({ ...s, streaming: s.streaming + msg.text }))
							break
						case 'done': {
							Object.assign(measuredRef.current, { outputTokens: msg.outputTokens, decodeMs: msg.decodeMs, totalMs: msg.totalMs })
							const ctx = runContextRef.current
							if (visible) {
								setState((s) => ({
									...s,
									phase: 'saving',
									statusText: 'Saving to this device…',
									streaming: msg.text,
									measured: { ...s.measured, ...measuredRef.current },
								}))
							}
							if (!ctx || !runId) {
								claimRun(null)
								return
							}
							try {
								// The run *is* the summary now: it goes onto the
								// meeting, not into a table beside it.
								const updated = await persist(runId, {
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
									if (visible) setState((s) => ({ ...s, phase: 'titling', statusText: 'Naming the meeting…' }))
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
								// The summary is stored and nothing else is
								// outstanding, so release the claim. Until this
								// lands the record still reads `running`, which
								// is correct — a tab that dies between the
								// summary write and here has already saved the
								// summary, and `needsSummaryRun` looks at the
								// summary before it looks at the run.
								await endSummaryRun(runId, 'done')
								const stored = (await getLocalMeeting(runId)) ?? updated
								if (stored) void syncSharedCopy(stored)
								claimRun(null)
								if (visible) setState((s) => ({ ...s, phase: 'done', statusText: null }))
							} catch (e) {
								const message = e instanceof Error ? e.message : String(e)
								void endSummaryRun(runId, 'failed', `Could not be saved: ${message}`).catch(() => {})
								claimRun(null)
								// The summary is on screen either way; say plainly
								// that it will not survive a reload.
								if (visible) {
									setState((s) => ({ ...s, phase: 'error', error: `Generated, but could not be saved: ${message}` }))
								}
							}
							break
						}
						case 'titled': {
							titlingRef.current = false
							const title = cleanTitle(msg.text)
							try {
								// An empty or unusable answer leaves the date in
								// place, which is a fine name for a meeting.
								if (runId) {
									if (title) await persist(runId, { title })
									// The summary landed before the title was
									// even asked for, so the run is done
									// whether or not the name came back.
									await endSummaryRun(runId, 'done')
									const updated = await getLocalMeeting(runId)
									if (updated) void syncSharedCopy(updated)
								}
							} catch (e) {
								console.warn('Could not store the generated title:', e)
							}
							claimRun(null)
							if (visible) setState((s) => ({ ...s, phase: 'done', statusText: null }))
							break
						}
						case 'error':
							// A failed title is not a failed summary: that one is
							// already in IndexedDB and on screen.
							if (titlingRef.current) {
								titlingRef.current = false
								// The summary is stored; only the name is missing.
								if (runId) void endSummaryRun(runId, 'done').catch(() => {})
								claimRun(null)
								console.warn('On-device title generation failed:', msg.message)
								if (visible) {
									setState((s) => ({ ...s, phase: 'done', statusText: null, log: [...s.log.slice(-60), `[title] ${msg.message}`] }))
								}
								break
							}
							if (runId) void endSummaryRun(runId, 'failed', msg.message).catch(() => {})
							claimRun(null)
							if (visible) setState((s) => ({ ...s, phase: 'error', error: msg.message }))
							break
					}
				}
				listenerRef.current = listener
				// Replaces whatever was there, including a listener left behind
				// by a page that has since unmounted.
				setSummaryListener(listener)
			}

			workerRef.current.postMessage({ type: 'summarize', prompt: prompt.prompt, model, thinking: false, maxNewTokens })
			return true
		},
		[meetingId, persist, claimRun, forThisPage, beat],
	)

	/**
	 * Terminating is the only way to stop a `generate` already on the GPU,
	 * which also drops the loaded model — the next run pays the load again.
	 */
	const cancel = useCallback(() => {
		// Recorded as 'stopped', not 'failed': automatic resume must not
		// restart a run the reader has just cancelled. The panel still offers
		// "Generate summary", which starts a fresh, counted attempt.
		const stopped = runMeetingIdRef.current
		if (stopped) void endSummaryRun(stopped, 'stopped', null).catch(() => {})
		terminateSummaryWorker()
		workerRef.current = null
		listenerRef.current = null
		titlingRef.current = false
		claimRun(null)
		// The log and the hardware survive: what this machine is does not
		// change because a run was stopped, and the log is the only record
		// of why it was.
		setState((s) => ({ ...initialState(), log: s.log, hardware: s.hardware }))
	}, [claimRun])

	const busy = !runningElsewhere && state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error'

	return {
		/**
		 * Idle while the run belongs to another meeting. The page asks this
		 * hook "what is happening with the meeting I am showing", and the
		 * honest answer then is "nothing" — the run is still going and will
		 * still save, it is simply not about what the reader is looking at.
		 *
		 * Nothing is thrown away: navigating back restores the real state,
		 * which is also what stops a second run being started over the first.
		 */
		state: runningElsewhere ? IDLE_STATE : state,
		busy,
		/** A run is in flight, for some meeting. Blocks starting another. */
		runningElsewhere,
		webgpuAvailable,
		generate,
		cancel,
	}
}
