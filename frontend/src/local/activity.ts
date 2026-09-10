/**
 * What the device is doing right now, for the one-line indicator in the top bar.
 *
 * Local mode does its work in workers, on whichever page happens to be open,
 * and the pipelines that drive it are owned by different hooks on different
 * pages (`useOnDevice` on the record page, `useLocalSummary` on the summary
 * page, plus the summariser preload that runs headless during a recording).
 * Neither can see the others, and a user watching a 3 GB download start
 * during a recording has no way to tell whether anything is happening at all.
 *
 * So the pipelines report here — a module-level slot with subscribers, in the
 * shape `history.ts` and `mode.ts` already use for cross-page state — and one
 * small component reads it.
 *
 * Each reporter owns its own slot, keyed by source, and the indicator shows
 * the highest-priority one. That keying is not decoration: starting a local
 * recording loads the speech model *and* preloads the summariser at the same
 * time, and when both wrote to one shared slot the pill flipped between
 * "Reading model" and "Fetching summary model" on every progress message.
 * Still one line on screen, though — the point is a glance, not a log. When
 * every slot is empty the indicator disappears.
 */

export interface LocalActivity {
	/** Two or three words. It sits in a 12px pill beside the mode toggle. */
	label: string
	/** 0–1 for a determinate ring, or null for "running, length unknown". */
	progress: number | null
	/** Longer text for the tooltip, when there is something worth adding. */
	detail?: string
}

/**
 * Who is reporting. Ordered by what the user most needs to know about:
 * the speech pipeline gates the recording in front of them, a summary run is
 * something they just asked for, and the preload is background work that
 * happens to be noisy.
 */
export type LocalActivitySource = 'speech' | 'summary' | 'summary-preload'

const PRIORITY: readonly LocalActivitySource[] = ['speech', 'summary', 'summary-preload']

type Listener = (activity: LocalActivity | null) => void

const slots = new Map<LocalActivitySource, LocalActivity>()
let current: LocalActivity | null = null
const listeners = new Set<Listener>()

/** Report progress for one source, or clear that source with `null`. */
export function setLocalActivity(source: LocalActivitySource, next: LocalActivity | null): void {
	if (next) slots.set(source, next)
	else slots.delete(source)

	const resolved = PRIORITY.reduce<LocalActivity | null>((found, key) => found ?? slots.get(key) ?? null, null)

	// Identical updates arrive every decoded token; re-rendering the whole top
	// bar for each of them is not worth it.
	if (
		resolved?.label === current?.label &&
		resolved?.detail === current?.detail &&
		roundedProgress(resolved?.progress) === roundedProgress(current?.progress)
	) {
		return
	}
	current = resolved
	for (const listener of listeners) listener(current)
}

/** A percent is all the ring can show, so that is the granularity that counts. */
const roundedProgress = (p: number | null | undefined): number | null => (typeof p === 'number' ? Math.round(p * 100) : null)

export const getLocalActivity = (): LocalActivity | null => current

export function subscribeLocalActivity(listener: Listener): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}
