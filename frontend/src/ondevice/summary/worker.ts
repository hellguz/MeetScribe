/**
 * One summariser worker for the whole app.
 *
 * It has to be shared, not per-component. The model is ~3 GB in memory, so a
 * second worker would either double that or reload from scratch — and the
 * whole point of preloading during the recording is that the model is *still
 * there* when the user lands on the summary page a page-navigation later.
 *
 * The worker keeps the loaded model in its own module scope, so a `summarize`
 * that follows a `preload` for the same id costs nothing.
 */
import { setLocalActivity } from '../../local/activity'
import type { SummarizerRequest, SummarizerResponse } from './summarizer.worker'

let worker: Worker | null = null
let preloadedModel: string | null = null
let runListener: ((event: MessageEvent) => void) | null = null

export function getSummaryWorker(): Worker {
	if (!worker) worker = new Worker(new URL('./summarizer.worker.ts', import.meta.url), { type: 'module' })
	return worker
}

/**
 * Install the one handler for a summary run's messages.
 *
 * The listener lives here rather than on the hook because it has to outlive
 * the page. It used to be attached in `useLocalSummary` and removed on
 * unmount, which meant navigating away from the summary page mid-run threw
 * the result away: the model went on writing, finished, posted `done` — and
 * nobody was listening, so the summary was never written to IndexedDB. The
 * user came back to a meeting that still had no summary and no explanation.
 *
 * Exactly one is attached at a time, which is the other half of the same
 * problem: leaving the old one on and adding a new one on the next mount
 * would store every result twice.
 */
export function setSummaryListener(listener: (event: MessageEvent) => void): void {
	const w = getSummaryWorker()
	if (runListener) w.removeEventListener('message', runListener)
	runListener = listener
	w.addEventListener('message', listener)
}

/**
 * Terminating is the only way to stop generation already on the GPU, and it
 * drops the loaded model with it — the next run pays the load again.
 */
export function terminateSummaryWorker(): void {
	if (worker && runListener) worker.removeEventListener('message', runListener)
	runListener = null
	worker?.terminate()
	worker = null
	preloadedModel = null
}

/**
 * Start fetching the weights now, in the background.
 *
 * Called when a local recording starts. A meeting runs for tens of minutes and
 * the download takes a few, so by the time there is a transcript the model is
 * usually resident. Safe to call repeatedly: the worker's own load is
 * idempotent, and this skips the message entirely once a model is in flight.
 */
export function preloadSummaryModel(model: string): void {
	if (preloadedModel === model) return
	preloadedModel = model
	const w = getSummaryWorker()
	// The preload has no page watching it — it starts during a recording and
	// finishes some minutes later — so it reports to the top-bar indicator
	// itself. Three gigabytes arriving in silence is the one moment where the
	// browser looks broken and is not.
	const onMessage = (event: MessageEvent<SummarizerResponse>) => {
		const msg = event.data
		if (msg.type === 'download') {
			setLocalActivity('summary-preload', {
				label: 'Fetching summary model',
				progress: msg.total > 0 ? msg.loaded / msg.total : null,
				detail: 'Downloading the summariser now, so it is ready when the meeting ends.',
			})
		} else if (msg.type === 'preloaded' || msg.type === 'error') {
			setLocalActivity('summary-preload', null)
			w.removeEventListener('message', onMessage)
		}
	}
	w.addEventListener('message', onMessage)
	w.postMessage({ type: 'preload', model } satisfies SummarizerRequest)
}

export const isPreloading = (model: string): boolean => preloadedModel === model
