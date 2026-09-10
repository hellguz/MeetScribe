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

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return open().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE, mode)
				const req = fn(tx.objectStore(STORE))
				req.onsuccess = () => resolve(req.result)
				req.onerror = () => reject(req.error ?? new Error('Local meeting store request failed'))
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
export async function patchLocalMeeting(id: string, patch: Partial<LocalMeeting>): Promise<LocalMeeting | null> {
	const existing = await getLocalMeeting(id)
	if (!existing) return null
	const merged = { ...existing, ...patch, id: existing.id }
	await putLocalMeeting(merged)
	return merged
}

/** True when this browser holds a local copy — cheaper than fetching one. */
export async function hasLocalMeeting(id: string): Promise<boolean> {
	try {
		return (await getLocalMeeting(id)) !== undefined
	} catch {
		return false
	}
}
