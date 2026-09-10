import { serverDateMs } from './datetime'
// ./frontend/src/utils/history.ts
/**
 * Browser-side storage for finished meetings.
 * Records are kept for up to 5 years.
 */

export type MeetingStorage = 'cloud' | 'local'

export interface MeetingMeta {
	id: string
	title: string
	started_at: string // ISO 8601
	status: 'pending' | 'complete' | 'gone'
	/**
	 * Where the meeting body actually lives. Absent on entries written before
	 * Local mode existed, which are all server meetings — hence the default in
	 * `storageOf` rather than a migration.
	 */
	storage?: MeetingStorage
	/**
	 * ISO expiry of the shared copy, for a local meeting that has been
	 * published. Mirrors `LocalMeeting.shared_until`, because the history list
	 * renders from this index alone and would otherwise stamp "On this device"
	 * on a meeting anyone with the link can read.
	 *
	 * `undefined` on rows written before sharing existed, and on cloud rows,
	 * where the server's `expires_at` is the authority.
	 */
	shared_until?: string | null
	/**
	 * Mirrors `LocalMeeting.published`: there is a copy on the server, whether
	 * or not it has an expiry. See that field for why `shared_until` alone
	 * cannot answer this.
	 */
	published?: boolean
	/**
	 * How long the recording ran. Shown in the list, which is the one place
	 * "was that the long one or the short one" gets asked.
	 *
	 * `undefined` on rows written before this existed, and on meetings still
	 * being processed; the list simply omits it then.
	 */
	duration_seconds?: number | null
}

/** Treat a missing `storage` as 'cloud': that is what every old entry is. */
export const storageOf = (meta: Pick<MeetingMeta, 'storage'>): MeetingStorage => meta.storage ?? 'cloud' 

const STORAGE_KEY = 'meetscribe_history'
const FIVE_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 5

function readRaw(): MeetingMeta[] {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
	} catch (e) {
		console.warn('Failed to parse meeting history:', e)
		return []
	}
}

function writeRaw(list: MeetingMeta[]) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

/** Syncs the local history with the server's version. */
export function syncHistory(serverMetas: MeetingMeta[]) {
	if (!serverMetas || serverMetas.length === 0) return

	const localMetas = readRaw()
	const localMetasMap = new Map(localMetas.map((m) => [m.id, m]))

	// Merge server data into the local map
	for (const serverMeta of serverMetas) {
		const existing = localMetasMap.get(serverMeta.id)
		// A local meeting has no server row, so anything coming back under its
		// id is not about it — leave the browser's copy alone. Without this a
		// stale id collision could relabel a private meeting as a cloud one.
		if (existing && storageOf(existing) === 'local') continue
		// Server is the source of truth for title and status. A duration it
		// does not know yet must not erase one already on the row.
		localMetasMap.set(serverMeta.id, {
			...serverMeta,
			storage: 'cloud',
			duration_seconds: serverMeta.duration_seconds ?? existing?.duration_seconds ?? null,
		})
	}

	const mergedList = Array.from(localMetasMap.values())
	writeRaw(mergedList)
}

/** Only the ids the server could know about — local meetings must never be sent. */
export function syncableIds(): string[] {
	return readRaw()
		.filter((m) => storageOf(m) !== 'local')
		.map((m) => m.id)
}

/** Return history sorted by date DESC and trimmed to 5 years. */
export function getHistory(): MeetingMeta[] {
	const now = Date.now()
	const recent = readRaw().filter((m) => now - serverDateMs(m.started_at) <= FIVE_YEARS_MS)
	// Cached entries mix naive-UTC (from the API) with Z-suffixed (written by
	// the client), so they must be parsed on one scale before comparing.
	recent.sort((a, b) => serverDateMs(b.started_at) - serverDateMs(a.started_at))
	return recent
}

/** Add or update a record in storage. */
export function saveMeeting(meta: MeetingMeta) {
	const list = readRaw()
	const idx = list.findIndex((m) => m.id === meta.id)
	if (idx >= 0) {
		list[idx] = meta
	} else {
		list.push(meta)
	}
	writeRaw(list)
}

/** Removes a meeting from local history. */
export function removeMeeting(id: string) {
	let list = readRaw()
	list = list.filter((m) => m.id !== id)
	writeRaw(list)
}
