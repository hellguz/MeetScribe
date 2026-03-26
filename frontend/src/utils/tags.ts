/**
 * Browser-side storage for meeting tags and favorites.
 */

export interface Tag {
	id: string
	name: string
	color: string // hex color
}

const TAGS_KEY = 'meetscribe_tags'
const MEETING_TAGS_KEY = 'meetscribe_meeting_tags'
const FAVORITES_KEY = 'meetscribe_favorites'

const DEFAULT_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280']

export function getDefaultColors(): string[] {
	return DEFAULT_COLORS
}

// --- Tags CRUD ---

function readTags(): Tag[] {
	try {
		return JSON.parse(localStorage.getItem(TAGS_KEY) ?? '[]')
	} catch {
		return []
	}
}

function writeTags(tags: Tag[]) {
	localStorage.setItem(TAGS_KEY, JSON.stringify(tags))
}

export function getTags(): Tag[] {
	return readTags()
}

export function createTag(name: string, color: string): Tag {
	const tags = readTags()
	const tag: Tag = { id: crypto.randomUUID(), name, color }
	tags.push(tag)
	writeTags(tags)
	return tag
}

export function updateTag(id: string, name: string, color: string): Tag | null {
	const tags = readTags()
	const idx = tags.findIndex((t) => t.id === id)
	if (idx < 0) return null
	tags[idx] = { ...tags[idx], name, color }
	writeTags(tags)
	return tags[idx]
}

export function deleteTag(id: string) {
	writeTags(readTags().filter((t) => t.id !== id))
	// Also remove from all meeting associations
	const map = readMeetingTags()
	for (const mid of Object.keys(map)) {
		map[mid] = map[mid].filter((tid) => tid !== id)
		if (map[mid].length === 0) delete map[mid]
	}
	writeMeetingTags(map)
}

// --- Meeting-Tag associations ---

function readMeetingTags(): Record<string, string[]> {
	try {
		return JSON.parse(localStorage.getItem(MEETING_TAGS_KEY) ?? '{}')
	} catch {
		return {}
	}
}

function writeMeetingTags(map: Record<string, string[]>) {
	localStorage.setItem(MEETING_TAGS_KEY, JSON.stringify(map))
}

export function getMeetingTagIds(meetingId: string): string[] {
	return readMeetingTags()[meetingId] ?? []
}

export function toggleMeetingTag(meetingId: string, tagId: string): string[] {
	const map = readMeetingTags()
	const current = map[meetingId] ?? []
	if (current.includes(tagId)) {
		map[meetingId] = current.filter((id) => id !== tagId)
	} else {
		map[meetingId] = [...current, tagId]
	}
	if (map[meetingId].length === 0) delete map[meetingId]
	writeMeetingTags(map)
	return map[meetingId] ?? []
}

// --- Favorites ---

function readFavorites(): string[] {
	try {
		return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')
	} catch {
		return []
	}
}

function writeFavorites(ids: string[]) {
	localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids))
}

export function isFavorite(meetingId: string): boolean {
	return readFavorites().includes(meetingId)
}

export function toggleFavorite(meetingId: string): boolean {
	const favs = readFavorites()
	const idx = favs.indexOf(meetingId)
	if (idx >= 0) {
		favs.splice(idx, 1)
		writeFavorites(favs)
		return false
	}
	favs.push(meetingId)
	writeFavorites(favs)
	return true
}
