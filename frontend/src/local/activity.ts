/**
 * What the device is doing right now, for the one-line indicator in the top bar.
 *
 * Local mode does its work in workers, on whichever page happens to be open,
 * and the two pipelines that drive it are owned by different hooks on
 * different pages (`useOnDevice` on the record page, `useLocalSummary` on the
 * summary page). Neither can see the other, and a user watching a 3 GB
 * download start during a recording has no way to tell whether anything is
 * happening at all.
 *
 * So the pipelines report here — a module-level slot with subscribers, in the
 * shape `history.ts` and `mode.ts` already use for cross-page state — and one
 * small component reads it. Deliberately a single slot rather than a queue:
 * only one thing runs on the GPU at a time, and the point is a glance, not a
 * log. `null` means idle, and the indicator disappears.
 */

export interface LocalActivity {
	/** Two or three words. It sits in a 12px pill beside the mode toggle. */
	label: string
	/** 0–1 for a determinate ring, or null for "running, length unknown". */
	progress: number | null
	/** Longer text for the tooltip, when there is something worth adding. */
	detail?: string
}

type Listener = (activity: LocalActivity | null) => void

let current: LocalActivity | null = null
const listeners = new Set<Listener>()

/** Report progress, or clear it with `null` when the work is done. */
export function setLocalActivity(next: LocalActivity | null): void {
	// Identical updates arrive every decoded token; re-rendering the whole top
	// bar for each of them is not worth it.
	if (
		next?.label === current?.label &&
		next?.detail === current?.detail &&
		roundedProgress(next?.progress) === roundedProgress(current?.progress)
	) {
		return
	}
	current = next
	for (const listener of listeners) listener(current)
}

/** A percent is all the ring can show, so that is the granularity that counts. */
const roundedProgress = (p: number | null | undefined): number | null => (typeof p === 'number' ? Math.round(p * 100) : null)

export const getLocalActivity = (): LocalActivity | null => current

export function subscribeLocalActivity(listener: Listener): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}
