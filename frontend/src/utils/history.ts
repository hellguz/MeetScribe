import { serverDateMs } from './datetime'
// ./frontend/src/utils/history.ts
/**
 * Browser-side storage for finished meetings.
 * Records are kept for up to 5 years.
 */

export interface MeetingMeta {
	id: string
	title: string
	started_at: string // ISO 8601
	status: 'pending' | 'complete'
}

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
		// Server is the source of truth for title and status
		localMetasMap.set(serverMeta.id, serverMeta)
	}

	const mergedList = Array.from(localMetasMap.values())
	writeRaw(mergedList)
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
