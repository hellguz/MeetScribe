/**
 * Where local meetings actually live.
 *
 * IndexedDB, not localStorage: `history.ts` and `summaryCache.ts` share a
 * ~5 MB origin quota between them, and a two-hour transcript with word-level
 * timings will not fit alongside everything else. A local meeting is also the
 * *only* copy of itself, so it does not belong in a store that silently
 * throws QuotaExceededError halfway through a write.
 *
 * The meeting index stays in `history.ts` (see its `storage` field) so the
 * history list keeps working unchanged; this holds the bodies.
 */
import type { SummaryLength } from '../contexts/SummaryLengthContext'
import type { ClientStats } from '../components/OnDeviceStats'
import type { TranscriptSegment } from '../ondevice/diarization/label'

const DB_NAME = 'meetscribe-local'
const DB_VERSION = 1
const STORE = 'meetings'

/**
 * How far the on-device summariser has got with a meeting, on disk.
 *
 * The summary run used to exist only in the memory of the page that started
 * it. Close the tab mid-run and every trace of it went with the tab: the
 * record still said `unfinished`, but nothing read that field, so reopening
 * the meeting showed "No summary is available" and waited for the reader to
 * work out that they were supposed to press a button.
 *
 * Stored here instead, so any tab that opens the meeting can see that a
 * summary is owed and start one.
 */
export type SummaryRunStatus =
	/** A transcript exists and no run has been started for it yet. */
	| 'pending'
	/** A run is on the GPU right now — see `heartbeat_at` for whether it still is. */
	| 'running'
	/** A summary was produced and stored. */
	| 'done'
	/** The last attempt failed; `error` says how. */
	| 'failed'
	/**
	 * The reader pressed Stop.
	 *
	 * Distinct from 'failed' because it must not be retried. Automatic resume
	 * exists for a run the tab took away from the user, not for one the user
	 * took away from the tab — restarting a 20-minute generate they had just
	 * cancelled would be the rudest possible reading of Stop.
	 */
	| 'stopped'

export interface SummaryRun {
	status: SummaryRunStatus
	/**
	 * Runs started for this meeting, ever. Caps automatic retries: a
	 * transcript the model chokes on deterministically must not have a fresh
	 * tab restart it forever.
	 */
	attempts: number
	/**
	 * Touched every few seconds while a run is generating.
	 *
	 * This is what tells a dead tab's `running` from a live one's. Without it
	 * a second tab either refuses to help (and the summary never resumes) or
	 * starts its own run over the top of a working one — and there is one
	 * model on one graphics card.
	 */
	heartbeat_at: string | null
	/** Why the last attempt stopped, for the panel to show. */
	error: string | null
}

/**
 * How long a `running` record can go untouched before it is assumed dead.
 *
 * Generously longer than the heartbeat interval: a browser throttles timers
 * in a background tab, and declaring a live run dead would start a second one
 * beside it.
 */
export const SUMMARY_RUN_STALE_MS = 90_000

/** Automatic attempts before the meeting waits for the reader to ask. */
export const MAX_SUMMARY_ATTEMPTS = 3

export interface LocalMeeting {
	id: string
	title: string
	started_at: string
	/** The labelled transcript, exactly as the summariser will see it. */
	transcript: string
	/** Per-chunk timings, kept so a summary can be regenerated without the audio. */
	segments: TranscriptSegment[]
	summary_markdown: string | null
	context: string | null
	summary_length: SummaryLength
	summary_language_mode: string
	summary_custom_language: string | null
	timezone: string | null
	duration_seconds: number | null
	word_count: number | null
	speaker_count: number | null
	client_stats: ClientStats | null
	updated_at: string
	/**
	 * ISO expiry of the shared copy on the server, or null when this meeting
	 * has never been shared. Kept here rather than discovered by asking the
	 * server, so opening a meeting that was never published makes no request
	 * at all — probing for it produced a 404/410 in the console every time.
	 *
	 * `undefined` on records written before sharing existed.
	 */
	shared_until?: string | null
	/**
	 * There is a copy on the server right now.
	 *
	 * Not derivable from `shared_until`, which is null for two opposite
	 * states: never shared, and shared with no expiry. Sharing with no expiry
	 * is what "keep it in the cloud" means, so the two must be told apart —
	 * without this a meeting shared forever showed a padlock.
	 *
	 * `undefined` on records written before sharing existed; a record with an
	 * expiry is published whatever this says.
	 */
	published?: boolean
	/**
	 * The id of the shared meeting this one was saved from.
	 *
	 * Set only on a copy taken through somebody else's link. The two are not
	 * connected afterwards and never sync in either direction — this exists
	 * so the page can say so, and so a copy is distinguishable from an
	 * original when reading the database by hand.
	 */
	copied_from?: string | null
	/**
	 * What the summariser has done about this meeting so far.
	 *
	 * `undefined` on records written before this existed. Those are read as
	 * `pending` with no attempts — which is what they are, and it means a
	 * meeting left summary-less by an older build resumes the first time it
	 * is opened rather than staying stuck.
	 */
	summary_run?: SummaryRun | null
	/**
	 * The transcript exists but no summary was ever produced — the tab was
	 * closed mid-run, or the user declined to fall back to the cloud. A real,
	 * supported end state, not an error: the transcript is still worth having.
	 */
	unfinished: boolean
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error('Could not open the local meeting database'))
	})
	// A failed open must not be cached, or every later call fails with it.
	dbPromise.catch(() => {
		dbPromise = null
	})
	return dbPromise
}

/**
 * One request in one transaction, resolved when the data is actually safe.
 *
 * A readwrite waits for `tx.oncomplete`, not `req.onsuccess`. The two are not
 * the same moment: a request succeeds while its transaction is still open, and
 * a tab closed in between loses the write. That window is exactly where a
 * local meeting was being lost — the chunk or summary write reported success,
 * the user closed the tab, and nothing had been committed.
 */
function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return open().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE, mode)
				const req = fn(tx.objectStore(STORE))
				let result: T
				req.onsuccess = () => {
					result = req.result
					// A read is done the moment it has its answer; a write is
					// not done until the transaction commits.
					if (mode === 'readonly') resolve(result)
				}
				req.onerror = () => reject(req.error ?? new Error('Local meeting store request failed'))
				tx.oncomplete = () => resolve(result)
				tx.onabort = () => reject(tx.error ?? new Error('Local meeting store transaction aborted'))
			}),
	)
}

/**
 * Read-modify-write inside a single transaction.
 *
 * `patchLocalMeeting` used to be a `get` followed by a separate `put`, which
 * is two transactions with a gap in the middle: a summary write and a title
 * write landing together could each read the pre-patch record and the second
 * would drop the first's field. IndexedDB serialises writers on one store, so
 * doing both halves here makes the merge atomic.
 */
function mergeInTransaction(id: string, merge: (existing: LocalMeeting) => LocalMeeting | null): Promise<LocalMeeting | null> {
	return open().then(
		(db) =>
			new Promise<LocalMeeting | null>((resolve, reject) => {
				const tx = db.transaction(STORE, 'readwrite')
				const store = tx.objectStore(STORE)
				const getReq = store.get(id) as IDBRequest<LocalMeeting | undefined>
				let merged: LocalMeeting | null = null
				getReq.onsuccess = () => {
					const existing = getReq.result
					if (!existing) return
					merged = merge(existing)
					if (merged) store.put(merged)
				}
				getReq.onerror = () => reject(getReq.error ?? new Error('Local meeting store read failed'))
				tx.oncomplete = () => resolve(merged)
				tx.onabort = () => reject(tx.error ?? new Error('Local meeting store transaction aborted'))
			}),
	)
}

export const getLocalMeeting = (id: string): Promise<LocalMeeting | undefined> =>
	run<LocalMeeting | undefined>('readonly', (s) => s.get(id) as IDBRequest<LocalMeeting | undefined>)

export const listLocalMeetings = (): Promise<LocalMeeting[]> =>
	run<LocalMeeting[]>('readonly', (s) => s.getAll() as IDBRequest<LocalMeeting[]>)

export const putLocalMeeting = (meeting: LocalMeeting): Promise<unknown> =>
	run('readwrite', (s) => s.put({ ...meeting, updated_at: new Date().toISOString() }))

export const deleteLocalMeeting = (id: string): Promise<unknown> => run('readwrite', (s) => s.delete(id))

/** Merge a few fields into an existing record. No-op if it is not there. */
export const patchLocalMeeting = (id: string, patch: Partial<LocalMeeting>): Promise<LocalMeeting | null> =>
	mergeInTransaction(id, (existing) => ({ ...existing, ...patch, id: existing.id, updated_at: new Date().toISOString() }))

/**
 * Merge fields *without* overwriting anything already on the record.
 *
 * For the recording sink, whose writes are the ones most likely to arrive out
 * of order — a 30-second chunk write is queued before `finalize` and can be
 * applied after it. A plain patch would then put a partial transcript back
 * over the finished one and null the duration out again.
 *
 * `prefer` wins over the stored value; `fallback` is only used where the
 * record has nothing yet.
 */
export const mergeLocalMeeting = (
	id: string,
	prefer: Partial<LocalMeeting>,
	fallback: Partial<LocalMeeting> = {},
): Promise<LocalMeeting | null> =>
	mergeInTransaction(id, (existing) => ({
		...fallback,
		...existing,
		...prefer,
		id: existing.id,
		updated_at: new Date().toISOString(),
	}))

/** The run state of a record, with the default that old records imply. */
export const summaryRunOf = (m: Pick<LocalMeeting, 'summary_run' | 'summary_markdown'>): SummaryRun =>
	m.summary_run ?? { status: m.summary_markdown ? 'done' : 'pending', attempts: 0, heartbeat_at: null, error: null }

/** A run whose tab is still alive: `running`, and its heartbeat is recent. */
export function summaryRunIsLive(run: SummaryRun, now: number = Date.now()): boolean {
	if (run.status !== 'running') return false
	// A `running` record with no heartbeat at all was written by a tab that
	// died before its first beat. Nothing is going to touch it again.
	if (!run.heartbeat_at) return false
	const beat = Date.parse(run.heartbeat_at)
	return Number.isFinite(beat) && now - beat < SUMMARY_RUN_STALE_MS
}

/**
 * Does this meeting still owe the reader a summary that a tab should start?
 *
 * True for a transcript with no summary whose last run is not currently
 * alive and has not used up its automatic attempts. A stale `running` counts:
 * that is precisely the closed-tab case this exists for.
 */
export function needsSummaryRun(m: LocalMeeting, now: number = Date.now()): boolean {
	if (!m.transcript.trim()) return false
	if (m.summary_markdown) return false
	const run = summaryRunOf(m)
	if (summaryRunIsLive(run, now)) return false
	// Stop means stop, however many attempts are left.
	if (run.status === 'stopped') return false
	return run.attempts < MAX_SUMMARY_ATTEMPTS
}

/**
 * Is some *other* meeting being summarized in this browser right now?
 *
 * There is one summariser worker and one graphics card, so two runs cannot
 * overlap — and the failure when they do is not just slowness. The worker's
 * replies carry no meeting id; the page pairs each `done` with whichever run
 * it believes is in flight. A second run started over the first therefore
 * files the first one's summary against the second one's meeting, which is
 * how a meeting ends up holding a summary of a completely different
 * conversation, under a transcript that does not match it.
 *
 * `runMeetingIdRef` inside the hook cannot answer this: it is per-page-instance
 * and reads null on a fresh mount even while a run started by an earlier
 * mount is still going. The records can answer it, because they beat.
 */
export async function liveSummaryRunElsewhere(exceptId: string, now: number = Date.now()): Promise<string | null> {
	try {
		const all = await listLocalMeetings()
		const busy = all.find((m) => m.id !== exceptId && m.summary_run && summaryRunIsLive(m.summary_run, now))
		return busy ? busy.title || busy.id : null
	} catch {
		// If the question cannot be answered, do not block the run: a summary
		// that might collide is better than one that never starts.
		return null
	}
}

/**
 * Record that a run is starting, counting the attempt.
 *
 * Returns the stored run state, so the caller can see the attempt number it
 * was actually given — two tabs racing to resume the same meeting both call
 * this, and IndexedDB serialises them, so the numbers come back different.
 */
export async function beginSummaryRun(id: string, resetAttempts = false): Promise<SummaryRun | null> {
	const updated = await mergeInTransaction(id, (existing) => {
		const run = summaryRunOf(existing)
		return {
			...existing,
			summary_run: {
				status: 'running',
				// A run the reader asked for starts the count again: the
				// attempt cap is there to stop a tab retrying by itself, and
				// it should never be the reason a button does nothing.
				attempts: resetAttempts ? 1 : run.attempts + 1,
				heartbeat_at: new Date().toISOString(),
				error: null,
			},
			updated_at: new Date().toISOString(),
		}
	})
	return updated?.summary_run ?? null
}

/** Keep a run's claim alive. Cheap enough to call every few seconds. */
export const touchSummaryRun = (id: string): Promise<LocalMeeting | null> =>
	mergeInTransaction(id, (existing) => {
		const run = summaryRunOf(existing)
		// Only a run that still believes it is running should be beating. A
		// heartbeat arriving after the user pressed Stop would otherwise keep
		// the meeting looking busy to every other tab for a minute and a half.
		if (run.status !== 'running') return null
		return { ...existing, summary_run: { ...run, heartbeat_at: new Date().toISOString() }, updated_at: new Date().toISOString() }
	})

/** Close a run out, successfully or not. */
export const endSummaryRun = (id: string, status: 'done' | 'failed' | 'stopped' | 'pending', error: string | null = null): Promise<LocalMeeting | null> =>
	mergeInTransaction(id, (existing) => {
		const run = summaryRunOf(existing)
		return {
			...existing,
			summary_run: { ...run, status, heartbeat_at: null, error },
			// `unfinished` is the same fact in the older, coarser field. Kept
			// in step so the history list and anything reading the record by
			// hand cannot disagree with `summary_run`.
			unfinished: status !== 'done',
			updated_at: new Date().toISOString(),
		}
	})

/** True when this browser holds a local copy — cheaper than fetching one. */
export async function hasLocalMeeting(id: string): Promise<boolean> {
	try {
		return (await getLocalMeeting(id)) !== undefined
	} catch {
		return false
	}
}
