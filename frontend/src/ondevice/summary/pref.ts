/**
 * The opt-in for on-device summarization, and the model/thinking choices
 * that go with it.
 *
 * Kept in localStorage rather than in a context because two separate pages
 * read it: the record page owns the checkbox, and the summary page decides
 * whether to offer the "generate here" card. Storage events keep other tabs
 * in step, matching how `useOnDevice` persists its own switch.
 */
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SUMMARY_MODEL, SUMMARY_MODELS } from './models'

const KEY_ENABLED = 'meetscribe_local_summary'
const KEY_MODEL = 'meetscribe_local_summary_model'
const KEY_THINKING = 'meetscribe_local_summary_thinking'

const read = (key: string): string | null => {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

const write = (key: string, value: string) => {
	try {
		localStorage.setItem(key, value)
	} catch {
		/* private mode; the choice just does not survive a reload */
	}
}

export const isLocalSummaryEnabled = (): boolean => read(KEY_ENABLED) === 'true'

export const getLocalSummaryModel = (): string => {
	const stored = read(KEY_MODEL)
	return SUMMARY_MODELS.some((m) => m.id === stored) ? (stored as string) : DEFAULT_SUMMARY_MODEL
}

/**
 * Qwen3.5 reasons by default, which for a summary means thousands of tokens
 * of deliberation before the first line of output. Off unless asked for.
 */
export const getLocalSummaryThinking = (): boolean => read(KEY_THINKING) === 'true'

/** Reactive view of the opt-in, in step across tabs. */
export function useLocalSummaryPrefs() {
	const [enabled, setEnabledState] = useState(isLocalSummaryEnabled)
	const [model, setModelState] = useState(getLocalSummaryModel)
	const [thinking, setThinkingState] = useState(getLocalSummaryThinking)

	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key === KEY_ENABLED) setEnabledState(isLocalSummaryEnabled())
			if (e.key === KEY_MODEL) setModelState(getLocalSummaryModel())
			if (e.key === KEY_THINKING) setThinkingState(getLocalSummaryThinking())
		}
		window.addEventListener('storage', onStorage)
		return () => window.removeEventListener('storage', onStorage)
	}, [])

	const setEnabled = useCallback((v: boolean) => {
		write(KEY_ENABLED, String(v))
		setEnabledState(v)
	}, [])
	const setModel = useCallback((id: string) => {
		write(KEY_MODEL, id)
		setModelState(id)
	}, [])
	const setThinking = useCallback((v: boolean) => {
		write(KEY_THINKING, String(v))
		setThinkingState(v)
	}, [])

	return { enabled, setEnabled, model, setModel, thinking, setThinking }
}
