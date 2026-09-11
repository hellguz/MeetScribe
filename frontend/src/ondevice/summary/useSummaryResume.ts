/**
 * Picks a local meeting's summary back up after the tab that was writing it
 * went away.
 *
 * The summary of a local meeting is produced in the browser, by one page, in
 * a run that takes minutes. Everything about that run used to live in the
 * memory of that page: close the tab and the run was gone, with the stored
 * record left saying nothing about the fact that a summary was owed. Reopening
 * the meeting showed "No summary is available for this meeting", and the only
 * way back was for the reader to work out that a button somewhere would start
 * it again. A meeting they had recorded, transcribed and waited for.
 *
 * So the record now carries its own run state (`summary_run` in `local/store`)
 * and this hook is what reads it: on open, on an interval, and whenever the
 * tab comes back to the foreground, it asks the stored record whether a
 * summary is still owed and starts one if it is.
 *
 * Two things it deliberately does *not* do:
 *
 *   · start a run over the top of a live one. A run in another tab beats every
 *     few seconds while it works; a record whose beat has stopped is the dead
 *     tab this exists for, and only that one is resumed. There is one model on
 *     one graphics card.
 *   · retry forever. Automatic attempts are capped (`MAX_SUMMARY_ATTEMPTS`),
 *     and a run the reader stopped is never restarted at all. Past that the
 *     meeting waits to be asked, with the last error on screen — a transcript
 *     the model chokes on must not have every visit burn ten minutes of GPU.
 */
import { useCallback, useEffect, useRef } from 'react'
import { getLocalMeeting, needsSummaryRun, type LocalMeeting } from '../../local/store'

/**
 * How often the stored record is re-read while a summary is still outstanding.
 *
 * The interval is not the main path — the check on open is — it is what
 * notices the *other* tab dying halfway through, and what notices the other
 * tab succeeding so this page can show the summary instead of a stale "no
 * summary" message. Neither is urgent to the second.
 */
const RECHECK_MS = 20_000

interface Options {
	meetingId?: string
	/** The record as this page currently has it. Null for a cloud meeting. */
	record: LocalMeeting | null
	/** This page's summariser is working on this meeting. */
	busy: boolean
	/** This page's summariser is working on a different meeting. */
	blocked: boolean
	/** This page's last attempt failed, and is showing the reader why. */
	failed: boolean
	/**
	 * Start a run for this meeting. Counted against the attempt cap.
	 *
	 * Resolves false if it did not begin — the graphics card is busy with
	 * another meeting, say. That is a wait, not a refusal, so the visit's one
	 * automatic attempt is not spent on it and the next check tries again.
	 */
	start: () => Promise<boolean>
	/**
	 * A newer record was found on disk than the page is showing — because
	 * another tab finished the summary. Hand it to the page.
	 */
	onRecord: (m: LocalMeeting) => void
}

export function useSummaryResume({ meetingId, record, busy, blocked, failed, start, onRecord }: Options): void {
	// Read through refs so `check` keeps one identity: it is on an interval
	// and on two window listeners, and a new function each render would tear
	// all three down and rebuild them every time a token arrived.
	const latest = useRef({ record, busy, blocked, failed, start, onRecord })
	latest.current = { record, busy, blocked, failed, start, onRecord }

	/** The meeting this hook has already spent its one automatic start on. */
	const startedFor = useRef<string | null>(null)

	const check = useCallback(async () => {
		if (!meetingId) return
		const { record: known, busy: isBusy, blocked: isBlocked, failed: hasFailed, start: begin, onRecord: hand } = latest.current
		// Nothing to resume for a meeting that does not live in this browser.
		if (!known) return

		let fresh: LocalMeeting | undefined
		try {
			fresh = await getLocalMeeting(meetingId)
		} catch {
			// A database that will not open is not something to retry into;
			// the page is already showing whatever it loaded.
			return
		}
		if (!fresh) return

		// Somebody else finished it — another tab, or a run this page started
		// before it was navigated away from and back to.
		if (fresh.summary_markdown && fresh.summary_markdown !== known.summary_markdown) {
			hand(fresh)
			return
		}

		if (isBusy || isBlocked || hasFailed) return
		// One automatic start per visit. The attempt cap in the record is the
		// long-term limit; this is what stops a run that fails in two seconds
		// from spending all three of them in the same breath.
		if (startedFor.current === meetingId) return
		if (!needsSummaryRun(fresh)) return

		const began = await begin()
		if (began) startedFor.current = meetingId
	}, [meetingId])

	// A different meeting gets its own automatic start.
	useEffect(() => {
		startedFor.current = null
	}, [meetingId])

	useEffect(() => {
		void check()
		const timer = setInterval(() => void check(), RECHECK_MS)
		// Coming back to the tab is the moment a reader most expects to see
		// something have happened, and it is also when a browser un-throttles
		// the timers it had been sitting on.
		const onWake = () => {
			if (document.visibilityState === 'visible') void check()
		}
		document.addEventListener('visibilitychange', onWake)
		window.addEventListener('focus', onWake)
		return () => {
			clearInterval(timer)
			document.removeEventListener('visibilitychange', onWake)
			window.removeEventListener('focus', onWake)
		}
	}, [check])

	// The page's own state changing — a run finishing, a failure clearing —
	// is worth one more look without waiting out the interval.
	useEffect(() => {
		void check()
	}, [check, busy, blocked, failed, record?.summary_markdown])
}
