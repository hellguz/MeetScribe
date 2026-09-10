/**
 * The Local mode switch.
 *
 * One preference, deliberately: it replaces the two separate experimental
 * opt-ins (on-device transcription, on-device summarization), because a
 * meeting is either private or it is not — offering half of it was a way to
 * send your transcript to the cloud while believing you had not.
 *
 * Turning it on affects new meetings only. Meetings already recorded keep
 * whatever storage they were created with, forever.
 */
import { useCallback, useEffect, useState } from 'react'

const KEY = 'meetscribe_local_mode'

const read = (): boolean => {
	try {
		return localStorage.getItem(KEY) === 'true'
	} catch {
		return false
	}
}

const write = (value: boolean) => {
	try {
		localStorage.setItem(KEY, String(value))
	} catch {
		/* private mode; the choice just does not survive a reload */
	}
}

export const isLocalMode = (): boolean => read()

export type EnableFailure =
	| { ok: false; reason: 'no-indexeddb'; message: string }
	| { ok: false; reason: 'not-persisted'; message: string }

export type EnableResult = { ok: true } | EnableFailure

/**
 * Ask the browser to stop treating this origin's storage as disposable, and
 * refuse to turn local mode on if it says no.
 *
 * This looks pedantic and is not. Without persistence, a local meeting lives
 * in a bucket the browser may evict whenever the disk gets tight — silently,
 * with no event and no recovery. Storing the only copy of someone's meeting
 * there while telling them it is safe would be worse than not offering the
 * feature. Chrome grants it based on engagement, Firefox prompts, Safari
 * grants it on user gesture; a refusal is rare and recoverable (install the
 * app, or visit it a few more times), so the message says so.
 */
export async function requestPersistentStorage(): Promise<EnableResult> {
	if (typeof indexedDB === 'undefined') {
		return {
			ok: false,
			reason: 'no-indexeddb',
			message: 'This browser has no database to store meetings in. Private windows usually block it.',
		}
	}
	if (!navigator.storage?.persist) {
		// No API to ask with (older Safari). Storage is still durable in
		// practice there; refusing would block the feature on a guess.
		return { ok: true }
	}
	try {
		const already = (await navigator.storage.persisted?.()) ?? false
		if (already || (await navigator.storage.persist())) return { ok: true }
	} catch {
		/* fall through to the refusal */
	}
	return {
		ok: false,
		reason: 'not-persisted',
		message:
			'Your browser will not guarantee that meetings stored here survive. It may delete them without warning when disk space runs low, so Local mode stays off. Visiting MeetScribe a few more times, or installing it, usually earns the permission.',
	}
}

/** How much room the browser will give this origin, if it will say. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
	try {
		const est = await navigator.storage?.estimate?.()
		if (!est || typeof est.quota !== 'number') return null
		return { usage: est.usage ?? 0, quota: est.quota }
	} catch {
		return null
	}
}

/** Reactive view of the switch, in step across tabs. */
export function useLocalMode() {
	const [enabled, setEnabledState] = useState(read)

	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key === KEY) setEnabledState(read())
		}
		window.addEventListener('storage', onStorage)
		return () => window.removeEventListener('storage', onStorage)
	}, [])

	/** Turning on is async and can be refused; turning off never is. */
	const enable = useCallback(async (): Promise<EnableResult> => {
		const result = await requestPersistentStorage()
		if (!result.ok) return result
		write(true)
		setEnabledState(true)
		return result
	}, [])

	const disable = useCallback(() => {
		write(false)
		setEnabledState(false)
	}, [])

	return { enabled, enable, disable }
}
