/**
 * Which of the summary page's four progress surfaces to show.
 *
 * Pulled out of the page because getting it wrong is not obvious from
 * reading it, and it has been wrong twice in opposite directions: the
 * streaming card rendered the new summary a second time underneath the saved
 * one, and then, once that was fixed by hiding it whenever a summary
 * existed, a re-run replaced a readable summary with the words "Writing the
 * summary…" for several minutes.
 *
 * The four are:
 *
 *   panel      the summariser's own report — rate, percentage, Stop, or the
 *              button that starts it, or the error and its two ways out
 *   card       the live text, as it lands
 *   dimStale   a summary that is about to be replaced, still worth reading
 *   banner     "still working", for when nothing else is saying so
 *
 * The rule behind all four: text that has nowhere else to live goes in the
 * card, and text that has been stored is shown as the summary. By the
 * 'saving' phase the record has been written and the page has re-read it, so
 * the card and the summary would be the same words twice.
 */
import type { LocalSummaryPhase } from '../ondevice/summary/useLocalSummary'

export interface LocalSummaryViewInput {
	/** This meeting lives in the browser. */
	isLocal: boolean
	hasTranscript: boolean
	/** A stored summary exists — the page is reading it from the record. */
	hasSummary: boolean
	phase: LocalSummaryPhase
	/** How much text the current run has streamed so far. */
	streamingLength: number
	/** The on-device run is between 'prompt' and 'done'. */
	localBusy: boolean
	/** The server is working on this meeting: processing or regenerating. */
	serverBusy: boolean
}

export interface LocalSummaryView {
	showPanel: boolean
	showStreaming: boolean
	dimStale: boolean
	showRegeneratingBanner: boolean
	/** The generic server-side "Processing summary…" line. */
	showProcessingMessage: boolean
}

export function localSummaryView(input: LocalSummaryViewInput): LocalSummaryView {
	const { isLocal, hasTranscript, hasSummary, phase, streamingLength, localBusy, serverBusy } = input

	const busy = serverBusy || (isLocal && localBusy)

	// Only these two phases put words on the screen that are not stored yet.
	const writing = phase === 'prefilling' || phase === 'generating'
	const showStreaming = isLocal && streamingLength > 0 && (writing || !hasSummary)

	// Running, failed, or waiting to be started: all three need saying.
	const showPanel = isLocal && hasTranscript && (localBusy || phase === 'error' || !hasSummary)

	/**
	 * Dimming means "the text you are reading is about to be replaced", so it
	 * lasts exactly as long as that is true: while the server is working, or
	 * while the model here is still writing the replacement.
	 *
	 * Not for the whole run. By 'saving' the summary on screen *is* the new
	 * one, and by 'titling' the only thing still outstanding is the meeting's
	 * name — dimming the result at that point, with a banner over it saying
	 * "still working", reads as a promise that it is going to change again.
	 */
	const dimStale = hasSummary && (serverBusy || (isLocal && writing))

	return {
		showPanel,
		showStreaming,
		dimStale,
		// The card is a better version of this message, so they never both show.
		showRegeneratingBanner: dimStale && !showStreaming,
		// A local run reports itself through the panel and the card, which say
		// what is happening; this generic line would sit above them adding
		// nothing but the word "Processing".
		showProcessingMessage: busy && !hasSummary && !isLocal,
	}
}
