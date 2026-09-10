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
	// `storage` only fires in *other* tabs, and the on-device pipeline lives in
	// this one. Announce it here too so the model starts loading immediately.
	window.dispatchEvent(new Event('meetscribe:localmode'))
}

export const isLocalMode = (): boolean => read()

export type StorageWarning = {
	/** Enabling still proceeds; the user is told, not blocked. */
	reason: 'no-indexeddb'
	message: string
}

export type EnableResult = { ok: true; warning: StorageWarning | null }

/**
 * Ask the browser to stop treating this origin's storage as disposable.
 *
 * Still asked for on every enable, because being granted it is what makes
 * these meetings durable. A refusal is no longer *reported*, though, and that
 * is deliberate: Chrome grants persistence on its own engagement heuristics,
 * so "no" from a browser that has seen this origin twice means "not yet", and
 * the warning fired for very nearly everybody the first time they turned
 * Local mode on. A caution that is wrong most of the time teaches people to
 * dismiss the ones that are not.
 *
 * The residual risk is real but small and unactionable in the moment
 * — eviction needs genuine disk pressure — and the panel says plainly, where
 * it belongs, that clearing site data deletes local meetings. The download
 * button is the answer for anything precious.
 *
 * A browser with no IndexedDB at all is a different matter and still warns:
 * there, the meeting will not survive the next reload, which is worth
 * knowing before recording one.
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
		if (!already) await navigator.storage.persist()
	} catch {
		/* asked and refused, or not askable; either way, carry on */
	}
	return { ok: true, warning: null }
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
		const onLocal = () => setEnabledState(read())
		window.addEventListener('storage', onStorage)
		window.addEventListener('meetscribe:localmode', onLocal)
		return () => {
			window.removeEventListener('storage', onStorage)
			window.removeEventListener('meetscribe:localmode', onLocal)
		}
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
