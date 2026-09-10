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

export type StorageWarning = {
	/** 'not-persisted' — enabling still proceeds; the user is told, not blocked. */
	reason: 'no-indexeddb' | 'not-persisted'
	message: string
}

export type EnableResult = { ok: true; warning: StorageWarning | null }

/**
 * Ask the browser to stop treating this origin's storage as disposable.
 *
 * A refusal is reported, never enforced. Chrome grants persistence on its own
 * engagement heuristics, Firefox prompts, Safari has its own rules — so "no"
 * usually means "not yet", and blocking on it would put the whole feature
 * behind a permission the user cannot see or grant directly. Eviction only
 * happens under real storage pressure, and the export button exists for
 * exactly this. So: say plainly that it is not guaranteed, and continue.
 */
export async function requestPersistentStorage(): Promise<EnableResult> {
	if (typeof indexedDB === 'undefined') {
		return {
			ok: true,
			warning: {
				reason: 'no-indexeddb',
				message: 'This browser has no database to store meetings in — private windows usually block it. Local meetings may not survive a reload.',
			},
		}
	}
	if (!navigator.storage?.persist) {
		// No API to ask with (older Safari). Storage is durable enough there in
		// practice, and there is nothing to warn about that the user could act on.
		return { ok: true, warning: null }
	}
	try {
		const already = (await navigator.storage.persisted?.()) ?? false
		if (already || (await navigator.storage.persist())) return { ok: true, warning: null }
	} catch {
		/* fall through to the warning */
	}
	return {
		ok: true,
		warning: {
			reason: 'not-persisted',
			message:
				'Your browser will not promise to keep these meetings — it may delete them if disk space runs low. Visiting MeetScribe a few more times, or installing it, usually earns the permission. Export anything important.',
		},
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

	/**
	 * Turning on always succeeds. It may come back with a warning about how
	 * durable this browser's storage is, which the panel shows without getting
	 * in the way.
	 */
	const enable = useCallback(async (): Promise<EnableResult> => {
		const result = await requestPersistentStorage()
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
