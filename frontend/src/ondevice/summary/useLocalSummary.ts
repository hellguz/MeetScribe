/**
 * Drives the experimental on-device summariser from the summary page.
 *
 *   GET /summary-prompt ──▶ summarizer.worker ──▶ streamed markdown
 *                                   │
 *                                   └─▶ POST /local-summaries  (text + timings)
 *
 * The point is comparison, so a run is never allowed to become the
 * meeting's real summary: `meeting.summary_markdown` is untouched and every
 * result lands in its own row, judged later against Claude's version.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLocalSummaries, fetchSummaryPrompt, saveLocalSummary, saveVerdict, type LocalSummaryRun } from './api'
import { getLocalSummaryModel, getLocalSummaryThinking } from './pref'

export type LocalSummaryPhase = 'idle' | 'prompt' | 'loading' | 'prefilling' | 'generating' | 'saving' | 'done' | 'error'

/**
 * Claude gets max_tokens 8096 for the same job. Local decode runs at tens of
 * tokens a second, so an 8k cap would mean a five-minute tail on a model
 * that had already said everything; 3k covers the longest stored summary
 * (~2.6k tokens) with headroom. Thinking needs its own budget on top.
 */
const MAX_NEW_TOKENS = 3072
const MAX_NEW_TOKENS_THINKING = 8192

export interface LocalSummaryState {
	phase: LocalSummaryPhase
	statusText: string | null
	error: string | null
	log: string[]
	download: { loaded: number; total: number } | null
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
	streaming: '',
	measured: emptyMeasured(),
})

/**
 * What the run happened on. Recorded with every row because "12 tokens a
 * second" is meaningless without it — the same model is four times faster on
 * a discrete GPU than on an integrated one.
 */
async function describeDevice(): Promise<Record<string, unknown>> {
	const nav = navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(): Promise<unknown> } }
	const info: Record<string, unknown> = {
		cores: nav.hardwareConcurrency ?? null,
		memory_gb: nav.deviceMemory ?? null,
		platform: nav.platform ?? null,
		mobile: /Android|Mobile|iPad|iPhone/i.test(nav.userAgent),
	}
	try {
		const adapter = (await nav.gpu?.requestAdapter()) as
			| { info?: { vendor?: string; architecture?: string; device?: string }; limits?: { maxBufferSize?: number } }
			| null
			| undefined
		if (adapter) {
			info.gpu_vendor = adapter.info?.vendor ?? null
			info.gpu_architecture = adapter.info?.architecture ?? null
			info.max_buffer_size = adapter.limits?.maxBufferSize ?? null
		}
	} catch {
		/* adapter details are a nicety, not a requirement */
	}
	return info
}

export function useLocalSummary(meetingId: string | undefined) {
	const [state, setState] = useState<LocalSummaryState>(initialState)
	const [runs, setRuns] = useState<LocalSummaryRun[]>([])
	const workerRef = useRef<Worker | null>(null)
	// Set for the duration of a run so the message handler knows what to
	// store; a worker message carries measurements, not the settings.
	const runContextRef = useRef<{ model: string; thinking: boolean; summaryLength: string; targetLanguage: string; maxNewTokens: number } | null>(null)
	const measuredRef = useRef(emptyMeasured())

	/** WebGPU is not optional here: 4-bit weights on WASM would take hours. */
	const webgpuAvailable = useMemo(() => typeof navigator !== 'undefined' && 'gpu' in navigator, [])

	useEffect(() => {
		if (!meetingId) return
		let live = true
		fetchLocalSummaries(meetingId)
			.then((list) => live && setRuns(list))
			.catch(() => {
				/* the panel still works; only the history is missing */
			})
		return () => {
			live = false
		}
	}, [meetingId])

	useEffect(
		() => () => {
			workerRef.current?.terminate()
			workerRef.current = null
		},
		[],
	)

	const generate = useCallback(
		async (summaryLength: string) => {
			if (!meetingId) return
			// Read at click time, not from the hook's own state: the panel
			// owns these controls and may have changed them since render.
			const model = getLocalSummaryModel()
			const thinking = getLocalSummaryThinking()

			measuredRef.current = emptyMeasured()
			setState({ ...initialState(), phase: 'prompt', statusText: 'Fetching the prompt Claude was given…' })

			let prompt: Awaited<ReturnType<typeof fetchSummaryPrompt>>
			try {
				prompt = await fetchSummaryPrompt(meetingId, summaryLength)
			} catch (e) {
				setState((s) => ({ ...s, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
				return
			}

			const maxNewTokens = thinking ? MAX_NEW_TOKENS_THINKING : MAX_NEW_TOKENS
			runContextRef.current = { model, thinking, summaryLength: prompt.summary_length, targetLanguage: prompt.target_language, maxNewTokens }
			measuredRef.current.promptChars = prompt.prompt_chars
			setState((s) => ({
				...s,
				phase: 'loading',
				statusText: 'Starting the model…',
				measured: { ...s.measured, promptChars: prompt.prompt_chars },
			}))

			if (!workerRef.current) {
				workerRef.current = new Worker(new URL('./summarizer.worker.ts', import.meta.url), { type: 'module' })
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
							setState((s) => ({ ...s, download: { loaded: msg.loaded, total: msg.total } }))
							break
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
							setState((s) => ({ ...s, phase: 'generating', statusText: 'Writing the summary…', measured: { ...s.measured, ...measuredRef.current } }))
							break
						case 'token':
							setState((s) => ({ ...s, streaming: s.streaming + msg.text }))
							break
						case 'done': {
							Object.assign(measuredRef.current, { outputTokens: msg.outputTokens, decodeMs: msg.decodeMs, totalMs: msg.totalMs })
							const ctx = runContextRef.current
							setState((s) => ({ ...s, phase: 'saving', statusText: 'Saving the run…', streaming: msg.text, measured: { ...s.measured, ...measuredRef.current } }))
							if (!ctx) return
							try {
								const saved = await saveLocalSummary(meetingId, {
									model: ctx.model,
									dtype: measuredRef.current.dtype ?? 'q4f16',
									device: measuredRef.current.device ?? 'webgpu',
									thinking: ctx.thinking,
									summary_length: ctx.summaryLength,
									target_language: ctx.targetLanguage,
									markdown: msg.text,
									prompt_chars: measuredRef.current.promptChars,
									prompt_tokens: measuredRef.current.promptTokens,
									output_tokens: msg.outputTokens,
									download_bytes: measuredRef.current.downloadBytes,
									download_ms: measuredRef.current.downloadMs,
									cached: measuredRef.current.cached,
									load_ms: measuredRef.current.loadMs,
									prefill_ms: measuredRef.current.prefillMs,
									decode_ms: msg.decodeMs,
									total_ms: msg.totalMs,
									truncated: msg.truncated,
									device_info: await describeDevice(),
								})
								setRuns((list) => [...list.filter((r) => r.id !== saved.id), saved])
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

			workerRef.current.postMessage({ type: 'summarize', prompt: prompt.prompt, model, thinking, maxNewTokens })
		},
		[meetingId],
	)

	/**
	 * Terminating is the only way to stop a `generate` already on the GPU,
	 * which also drops the loaded model — the next run pays the load again.
	 */
	const cancel = useCallback(() => {
		workerRef.current?.terminate()
		workerRef.current = null
		setState((s) => ({ ...initialState(), log: s.log }))
	}, [])

	const setVerdict = useCallback(
		async (runId: number, verdict: string | null, note: string | null) => {
			if (!meetingId) return
			const saved = await saveVerdict(meetingId, runId, verdict, note)
			setRuns((list) => list.map((r) => (r.id === saved.id ? saved : r)))
		},
		[meetingId],
	)

	const busy = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error'

	return { state, runs, busy, webgpuAvailable, generate, cancel, setVerdict }
}
