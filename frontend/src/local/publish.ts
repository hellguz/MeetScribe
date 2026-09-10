/**
 * Publishing a local meeting, and taking it back.
 *
 * A published meeting is a *copy*, with a clock on it. The browser stays the
 * authority: when the window closes the server's copy is deleted and the
 * original is untouched. Everyone who opened the link in time kept their own
 * copy, which is the whole point — sharing hands out copies rather than
 * granting access to something that has to stay online.
 */
import { apiUrl } from '../utils/api'
import { patchLocalMeeting, type LocalMeeting } from './store'
import { getHistory, saveMeeting, storageOf } from '../utils/history'

/**
 * Keep the history index in step with the record.
 *
 * The list is rendered from the index and never opens IndexedDB, so a share
 * it does not know about is a share it labels "On this device".
 */
function noteShare(meetingId: string, published: boolean, sharedUntil: string | null): void {
	const meta = getHistory().find((m) => m.id === meetingId)
	if (!meta || storageOf(meta) !== 'local') return
	saveMeeting({ ...meta, published, shared_until: sharedUntil })
}

const TOKEN_PREFIX = 'meetscribe_owner_'

export interface PublishStatus {
	id: string
	published: boolean
	expires_at: string | null
	origin: string
}

/**
 * The secret that makes this browser the meeting's owner.
 *
 * There are no accounts, so ownership is "holds the token". Minted once per
 * meeting and never sent — only its hash goes to the server. Losing the
 * browser means losing the ability to unpublish early; the expiry still runs
 * on its own, which is the main reason not to default to "never".
 */
export function ownerToken(meetingId: string): string {
	const key = TOKEN_PREFIX + meetingId
	try {
		const existing = localStorage.getItem(key)
		if (existing) return existing
		const minted = crypto.randomUUID() + crypto.randomUUID()
		localStorage.setItem(key, minted)
		return minted
	} catch {
		// Private mode: a token that does not survive a reload is still a token
		// for this session, and reading never needs one.
		return crypto.randomUUID() + crypto.randomUUID()
	}
}

export const hasOwnerToken = (meetingId: string): boolean => {
	try {
		return localStorage.getItem(TOKEN_PREFIX + meetingId) !== null
	} catch {
		return false
	}
}

export const forgetOwnerToken = (meetingId: string): void => {
	try {
		localStorage.removeItem(TOKEN_PREFIX + meetingId)
	} catch {
		/* nothing to forget */
	}
}

/** Headers that prove this browser owns the meeting. */
export const ownerHeaders = (meetingId: string): Record<string, string> => ({ 'X-Owner-Token': ownerToken(meetingId) })

export const SHARE_DURATIONS: { label: string; seconds: number | null }[] = [
	{ label: '1 hour', seconds: 3600 },
	{ label: '1 day', seconds: 86_400 },
	{ label: '1 week', seconds: 604_800 },
	{ label: '1 month', seconds: 2_592_000 },
	// "Move to the cloud permanently", which is what every meeting recorded in
	// cloud mode already is — one chip rather than a second concept.
	{ label: 'Never', seconds: null },
]

export const DEFAULT_DURATION_SECONDS = 604_800

/** Create the shared copy, or move an existing one's expiry. */
export async function publishMeeting(meeting: LocalMeeting, expiresInSeconds: number | null): Promise<PublishStatus> {
	const res = await fetch(apiUrl(`/api/meetings/${meeting.id}/publish`), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...ownerHeaders(meeting.id) },
		body: JSON.stringify({
			owner_token: ownerToken(meeting.id),
			expires_in_seconds: expiresInSeconds,
			title: meeting.title,
			started_at: meeting.started_at,
			transcript: meeting.transcript,
			summary_markdown: meeting.summary_markdown,
			context: meeting.context,
			summary_length: meeting.summary_length,
			summary_language_mode: meeting.summary_language_mode,
			summary_custom_language: meeting.summary_custom_language,
			timezone: meeting.timezone,
			duration_seconds: meeting.duration_seconds,
			word_count: meeting.word_count,
			speaker_count: meeting.speaker_count,
		}),
	})
	if (!res.ok) {
		const body = await res.json().catch(() => ({}))
		throw new Error(typeof body.detail === 'string' ? body.detail : `Could not share this meeting (HTTP ${res.status}).`)
	}
	const status: PublishStatus = await res.json()
	// The record is the only place that knows this meeting is shared, so the
	// page never has to ask the server on load.
	await patchLocalMeeting(meeting.id, { published: true, shared_until: status.expires_at ?? null })
	noteShare(meeting.id, true, status.expires_at ?? null)
	return status
}

/** Take the shared copy down now. */
export async function unpublishMeeting(meetingId: string): Promise<void> {
	const res = await fetch(apiUrl(`/api/meetings/${meetingId}/publish`), {
		method: 'DELETE',
		headers: ownerHeaders(meetingId),
	})
	if (!res.ok && res.status !== 404 && res.status !== 410) {
		const body = await res.json().catch(() => ({}))
		throw new Error(typeof body.detail === 'string' ? body.detail : `Could not stop sharing (HTTP ${res.status}).`)
	}
	await patchLocalMeeting(meetingId, { published: false, shared_until: null })
	noteShare(meetingId, false, null)
}

/**
 * Push the current text to a meeting that is already shared.
 *
 * A published meeting is a snapshot, so editing the local original used to
 * leave the link serving the version it was shared at — someone fixing a
 * wrong name in their notes had no way to tell that the person reading the
 * link still saw the wrong one. Every write to a published local meeting
 * comes back through here.
 *
 * The window is preserved rather than reset: the server takes a duration, so
 * the remaining time is measured and handed back to it. A share that has
 * already run out is *not* silently recreated — the copy is gone by then and
 * the user let it go, so the flags are simply corrected locally.
 *
 * Never throws. A failed sync must not cost the user the edit they just made
 * to their own meeting; the local write has already happened, and the link
 * catches up on the next one.
 */
export async function syncSharedCopy(meeting: LocalMeeting): Promise<PublishStatus | null> {
	if (!meeting.published && !meeting.shared_until) return null
	if (meeting.shared_until) {
		const remainingMs = msUntil(meeting.shared_until)
		if (remainingMs <= 0) {
			await patchLocalMeeting(meeting.id, { published: false, shared_until: null }).catch(() => null)
			noteShare(meeting.id, false, null)
			return null
		}
		return publishMeeting(meeting, Math.max(1, Math.round(remainingMs / 1000))).catch((err) => {
			console.warn('Could not update the shared copy; the link still shows the previous version.', err)
			return null
		})
	}
	// Shared with no expiry — keep it that way.
	return publishMeeting(meeting, null).catch((err) => {
		console.warn('Could not update the shared copy; the link still shows the previous version.', err)
		return null
	})
}

export const shareUrl = (meetingId: string): string => `${window.location.origin}/summary/${meetingId}`

/**
 * A date, not a duration. "In 6 days" is ambiguous the moment you read it a
 * day later; "17 Sep, 14:32" is not.
 */
export function formatExpiry(iso: string): string {
	const when = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
	return when.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function msUntil(iso: string): number {
	const when = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
	return when.getTime() - Date.now()
}

/** "6d left", "4 minutes" — short enough for a badge. */
export function shortRemaining(iso: string): string {
	const ms = msUntil(iso)
	if (ms <= 0) return 'expired'
	const minutes = Math.round(ms / 60_000)
	if (minutes < 60) return `${minutes}m left`
	const hours = Math.round(minutes / 60)
	if (hours < 48) return `${hours}h left`
	return `${Math.round(hours / 24)}d left`
}
