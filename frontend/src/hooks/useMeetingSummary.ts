import { useState, useEffect, useCallback } from 'react'
import { getCached, saveCached } from '../utils/summaryCache'
import { getHistory, saveMeeting } from '../utils/history'
import { SummaryLength } from '../contexts/SummaryLengthContext'
import { SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { apiUrl } from '../utils/api'
import { getLocalMeeting, patchLocalMeeting, deleteLocalMeeting, putLocalMeeting, type LocalMeeting } from '../local/store'
import { ownerHeaders, syncSharedCopy } from '../local/publish'
import type { Tombstone } from '../components/TombstoneNotice'
import { saveMeeting as saveMeetingMeta } from '../utils/history'
import type { ClientStats } from '../components/OnDeviceStats'

interface UseMeetingSummaryProps {
	mid: string | undefined
	languageState: SummaryLanguageState
	setLanguageState: (update: Partial<SummaryLanguageState>) => void
}

export const useMeetingSummary = ({ mid, languageState, setLanguageState }: UseMeetingSummaryProps) => {
	const [transcript, setTranscript] = useState<string | null>(null)
	const [summaryMarkdown, setSummaryMarkdown] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [isProcessing, setIsProcessing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [meetingTitle, setMeetingTitle] = useState<string | null>(null)
	const [meetingStartedAt, setMeetingStartedAt] = useState<string>('')
	const [meetingTimezone, setMeetingTimezone] = useState<string | null>(null)
	const [context, setContext] = useState<string | null>(null)
	const [loadedFromCache, setLoadedFromCache] = useState(false)
	const [currentMeetingLength, setCurrentMeetingLength] = useState<SummaryLength>('narrative')
	const [submittedFeedback, setSubmittedFeedback] = useState<string[]>([])
	const [isRegenerating, setIsRegenerating] = useState(false)
	// Whether the original audio survives, so speakers can still be identified.
	const [canRediarize, setCanRediarize] = useState(false)
	const [diarizationAttempted, setDiarizationAttempted] = useState(true)
	const [speakerCount, setSpeakerCount] = useState<number | null>(null)
	const [clientStats, setClientStats] = useState<ClientStats | null>(null)
	const [processingStage, setProcessingStage] = useState<string | null>(null)
	const [processingTotal, setProcessingTotal] = useState<number | null>(null)
	/**
	 * The local record, when this meeting lives in the browser. `undefined`
	 * means "not looked up yet" and `null` means "looked up, it is a server
	 * meeting" — the difference decides whether to fetch from the API at all.
	 */
	const [localMeeting, setLocalMeeting] = useState<LocalMeeting | null | undefined>(undefined)
	/** Set when the server says 410: the meeting existed and no longer does. */
	const [tombstone, setTombstone] = useState<Tombstone | null>(null)
	/** True when a cached copy was found and promoted to a real local meeting. */
	const [recoveredCopy, setRecoveredCopy] = useState(false)
	/** Expiry of the shared copy, straight off the status the page already polls. */
	const [expiresAt, setExpiresAt] = useState<string | null>(null)
	/**
	 * A local meeting with a copy on the server. Tracked separately from
	 * `expiresAt` because a share with no expiry has none, and that is the
	 * share that means "keep it in the cloud".
	 */
	const [publishedLocally, setPublishedLocally] = useState(false)

	/** Populate every piece of page state from a stored local meeting. */
	const applyLocalMeeting = useCallback((m: LocalMeeting) => {
		setLocalMeeting(m)
		setTranscript(m.transcript || null)
		setSummaryMarkdown(m.summary_markdown)
		setMeetingTitle(m.title)
		setMeetingStartedAt(m.started_at)
		setMeetingTimezone(m.timezone)
		setContext(m.context ?? '')
		setSpeakerCount(m.speaker_count)
		setClientStats(m.client_stats)
		setCurrentMeetingLength(m.summary_length)
		setSubmittedFeedback([])
		// The audio was never kept, so speakers can never be re-identified.
		setCanRediarize(false)
		setDiarizationAttempted(true)
		setExpiresAt(m.shared_until ?? null)
		// A record written before `published` existed is published if it has an
		// expiry — the only kind of share that existed then.
		setPublishedLocally(m.published ?? !!m.shared_until)
		setProcessingStage(null)
		setProcessingTotal(null)
		setIsLoading(false)
		// Nothing is running server-side, so nothing is ever polled: the
		// summariser hook owns progress for a local meeting.
		setIsProcessing(false)
	}, [])

	const fetchMeetingData = useCallback(
		async (isInitialFetch: boolean = false) => {
			if (!mid) return

			// A local meeting has no server row; asking for one would 404.
			try {
				const local = await getLocalMeeting(mid)
				if (local) {
					applyLocalMeeting(local)
					return
				}
				setLocalMeeting(null)
			} catch {
				setLocalMeeting(null)
			}

			if (isInitialFetch) {
				if (!loadedFromCache) setIsLoading(true)
				setError(null)
			}

			try {
				const res = await fetch(apiUrl(`/api/meetings/${mid}?_=${Date.now()}`))

				if (res.status === 410) {
					// Removed from the server, but not forgotten: the body says
					// what happened and when, so the page can explain rather
					// than showing a bare error.
					const body = await res.json().catch(() => ({}))
					const stone = (body.detail ?? body) as Tombstone
					setTombstone(stone)
					setIsLoading(false)
					setIsProcessing(false)
					// `summaryCache` has been quietly keeping the summary and
					// transcript of every meeting this browser opened. That copy
					// is now the only one left, so it becomes a local meeting.
					const cached = getCached(mid)
					if (cached?.summary) {
						const recovered: LocalMeeting = {
							id: mid,
							title: cached.title || stone.title,
							started_at: new Date().toISOString(),
							transcript: cached.transcript ?? '',
							segments: [],
							summary_markdown: cached.summary,
							context: null,
							summary_length: 'narrative',
							summary_language_mode: 'auto',
							summary_custom_language: null,
							timezone: null,
							duration_seconds: null,
							word_count: null,
							speaker_count: null,
							client_stats: null,
							updated_at: new Date().toISOString(),
							unfinished: false,
						}
						await putLocalMeeting(recovered)
						saveMeetingMeta({ id: mid, title: recovered.title, started_at: recovered.started_at, status: 'complete', storage: 'local' })
						setRecoveredCopy(true)
					}
					return
				}
				if (!res.ok) {
					const errorData = await res.json().catch(() => ({ message: 'Failed to fetch meeting data' }))
					throw new Error(errorData.detail || `HTTP error! status: ${res.status}`)
				}

				const data = await res.json()

				// --- Sync language state with the meeting's settings ---
				if (data.summary_language_mode) {
					setLanguageState({
						mode: data.summary_language_mode,
						lastCustomLanguage: data.summary_custom_language || languageState.lastCustomLanguage,
					})
				}

				setContext(data.context || '')
				setCanRediarize(!!data.can_rediarize)
				setDiarizationAttempted(!!data.diarization_attempted)
				setSpeakerCount(typeof data.speaker_count === 'number' ? data.speaker_count : null)
				try {
					setClientStats(data.client_stats ? (JSON.parse(data.client_stats) as ClientStats) : null)
				} catch {
					setClientStats(null)
				}
				setExpiresAt(data.expires_at ?? null)
				setProcessingStage(data.processing_stage ?? null)
				setProcessingTotal(typeof data.processing_total === 'number' ? data.processing_total : null)
				const trn = data.transcript_text || null
				setTranscript(trn)
				setSummaryMarkdown(data.summary_markdown || null)
				setSubmittedFeedback(data.feedback || [])
				setMeetingTimezone(data.timezone || null)

				const lengthValue = data.summary_length || 'auto'
				if (['briefing', 'essence', 'narrative', 'minutes'].includes(lengthValue)) {
					setCurrentMeetingLength(lengthValue as SummaryLength)
				}

				if (data.title && data.title !== meetingTitle) {
					setMeetingTitle(data.title)
				}
				if (!meetingTitle) {
					setMeetingTitle(data.title || `Meeting ${mid}`)
				}
				if (!meetingStartedAt) {
					setMeetingStartedAt(data.started_at || new Date().toISOString())
				}

				if (data.done) {
					setIsProcessing(false)
					setIsLoading(false)
					// Caching the raw summary is less important now, but we can cache the transcript
					const cachedData = getCached(mid)
					saveCached({
						id: data.id,
						title: data.title,
						summary: cachedData?.summary || '', // Keep old summary in cache for now
						transcript: trn,
						updatedAt: new Date().toISOString(),
					})
					const historyList = getHistory()
					const existingMeta = historyList.find((m) => m.id === data.id)
					saveMeeting({
						id: data.id,
						title: data.title,
						started_at: existingMeta?.started_at || data.started_at,
						status: 'complete',
						duration_seconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : existingMeta?.duration_seconds,
					})
				} else {
					setIsProcessing(true)
					setIsLoading(false)
				}
			} catch (err) {
				if (!loadedFromCache) {
					setError(err instanceof Error ? err.message : 'An unknown error occurred.')
				}
				setIsLoading(false)
				setIsProcessing(false)
			}
		},
		[mid, loadedFromCache, meetingTitle, meetingStartedAt, languageState.lastCustomLanguage, setLanguageState, applyLocalMeeting],
	)

	/**
	 * Re-run timings, diarization and the summary for this meeting. Used for
	 * recordings made before speaker labels existed. The backend clears `done`,
	 * which puts this hook into its polling path.
	 */
	const handleRediarize = useCallback(async () => {
		if (!mid) return
		setIsProcessing(true)
		try {
			const res = await fetch(apiUrl(`/api/meetings/${mid}/rediarize`), { method: 'POST' })
			if (!res.ok) {
				const body = await res.json().catch(() => ({}))
				throw new Error(body.detail || 'Could not start speaker identification.')
			}
			fetchMeetingData(false)
		} catch (err) {
			setIsProcessing(false)
			setError(err instanceof Error ? err.message : 'Could not start speaker identification.')
		}
	}, [mid, fetchMeetingData])

	/**
	 * Switch the summary language. The backend clears `done` so progress can be
	 * polled, but polling only starts once a fetch observes that — without the
	 * re-fetch below the page sat on a stale summary until a manual refresh.
	 */
	const handleTranslate = useCallback(
		async (targetLanguage: string, languageMode: string) => {
			if (!mid) return
			setIsRegenerating(true)
			setError(null)
			try {
				const res = await fetch(apiUrl(`/api/meetings/${mid}/translate`), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ target_language: targetLanguage, language_mode: languageMode }),
				})
				if (!res.ok) throw new Error('Could not start translation.')
				setIsProcessing(true)
				fetchMeetingData(false)
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Could not start translation.')
			} finally {
				setIsRegenerating(false)
			}
		},
		[mid, fetchMeetingData],
	)

	const handleFeedbackToggle = async (type: string, isSelected: boolean) => {
		if (!mid) return
		setSubmittedFeedback((prev) => (isSelected ? [...prev, type] : prev.filter((t) => t !== type)))
		try {
			await fetch(apiUrl(`/api/feedback`), {
				method: isSelected ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ meeting_id: mid, feedback_type: type }),
			})
		} catch (error) {
			console.error('Failed to update feedback:', error)
			fetchMeetingData(false) // Re-fetch to revert
		}
	}

	const handleSuggestionSubmit = async (suggestionText: string) => {
		if (!mid || !suggestionText) return
		try {
			await fetch(apiUrl(`/api/feedback`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ meeting_id: mid, feedback_type: 'feature_suggestion', suggestion_text: suggestionText }),
			})
		} catch (error) {
			console.error('Failed to submit suggestion:', error)
			alert("Sorry, we couldn't submit your suggestion right now.")
		}
	}

	const handleRegenerate = useCallback(
		async (settings: { newLength?: SummaryLength; newLanguageState?: SummaryLanguageState; newContext?: string | null }) => {
			if (!mid) return

			if (settings.newLength) setCurrentMeetingLength(settings.newLength)
			if (settings.newContext !== undefined) setContext(settings.newContext)

			setIsRegenerating(true)
			setError(null)
			try {
				const payload = {
					summary_length: settings.newLength ?? currentMeetingLength,
					summary_language_mode: settings.newLanguageState?.mode ?? languageState.mode,
					summary_custom_language: settings.newLanguageState?.lastCustomLanguage ?? languageState.lastCustomLanguage,
					context: settings.newContext ?? context,
				}
				const res = await fetch(apiUrl(`/api/meetings/${mid}/regenerate`), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				})
				if (!res.ok) throw new Error('Failed to start summary regeneration.')

				// Immediately start the processing state to update the UI
				setIsProcessing(true)
			} catch (err) {
				setError(err instanceof Error ? err.message : 'An unknown error occurred.')
			} finally {
				setIsRegenerating(false)
			}
		},
		[mid, context, currentMeetingLength, languageState],
	)

	const handleSummaryUpdate = useCallback(
		async (content: string) => {
			if (!mid) return
			setSummaryMarkdown(content) // Optimistic update
			// A local meeting has no server row, and PUTting its summary to
			// /api/meetings/{id}/summary would upload the very text the user
			// chose to keep off the server.
			if (localMeeting) {
				const updated = await patchLocalMeeting(mid, { summary_markdown: content })
				if (updated) {
					applyLocalMeeting(updated)
					// If this meeting is shared, the link should show the edit
					// rather than the version it was shared at. No-ops and never
					// throws when it is not; see `syncSharedCopy`.
					void syncSharedCopy(updated)
				}
				return
			}
			try {
				const res = await fetch(apiUrl(`/api/meetings/${mid}/summary`), {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content }),
				})
				if (!res.ok) throw new Error('Failed to update summary')
			} catch (err) {
				console.error(err)
				fetchMeetingData(false) // Revert on error
			}
		},
		[mid, fetchMeetingData, localMeeting, applyLocalMeeting],
	)

	const handleTitleUpdate = useCallback(
		async (newTitle: string) => {
			if (!mid || !newTitle || newTitle === meetingTitle) return
			// Same reasoning as `handleSummaryUpdate`: local stays local.
			if (localMeeting) {
				const updated = await patchLocalMeeting(mid, { title: newTitle })
				if (updated) {
					applyLocalMeeting(updated)
					saveMeeting({
						id: mid,
						title: updated.title,
						started_at: updated.started_at,
						status: 'complete',
						storage: 'local',
						shared_until: updated.shared_until ?? null,
						published: updated.published ?? !!updated.shared_until,
						duration_seconds: updated.duration_seconds,
					})
					void syncSharedCopy(updated)
				}
				return
			}
			try {
				const res = await fetch(apiUrl(`/api/meetings/${mid}/title`), {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: newTitle }),
				})
				if (!res.ok) throw new Error('Failed to update title')
				const updatedMeeting = await res.json()
				setMeetingTitle(updatedMeeting.title)
				saveMeeting({ id: mid, title: updatedMeeting.title, started_at: meetingStartedAt, status: 'complete' })

				const cachedData = getCached(mid)
				if (cachedData) {
					saveCached({ ...cachedData, title: updatedMeeting.title, updatedAt: new Date().toISOString() })
				}
			} catch (err) {
				console.error(err)
				alert('Failed to update title')
			}
		},
		[mid, meetingTitle, meetingStartedAt, localMeeting, applyLocalMeeting],
	)

	useEffect(() => {
		if (mid) {
			const cachedData = getCached(mid)
			if (cachedData) {
				setTranscript(cachedData.transcript || null)
				setMeetingTitle(cachedData.title)
				setLoadedFromCache(true)
				setIsLoading(false)
			}
			fetchMeetingData(true)
		}
	}, [mid])

	useEffect(() => {
		if (!isProcessing) return
		const pollInterval = setInterval(() => fetchMeetingData(false), 5000)
		return () => clearInterval(pollInterval)
	}, [isProcessing, fetchMeetingData])

	/** Write an edited summary or title straight to the local record. */
	const updateLocalMeeting = useCallback(
		async (patch: Partial<LocalMeeting>) => {
			if (!mid) return
			const updated = await patchLocalMeeting(mid, patch)
			if (updated) applyLocalMeeting(updated)
		},
		[mid, applyLocalMeeting],
	)

	const removeLocalMeeting = useCallback(async () => {
		if (!mid) return
		await deleteLocalMeeting(mid)
	}, [mid])

	/**
	 * Pull a cloud meeting into this browser and delete the server's copy.
	 *
	 * Order matters and is not negotiable: write locally, verify it landed,
	 * *then* delete. A failure before the verification leaves the cloud meeting
	 * untouched, which is the only safe way to fail here.
	 */
	const makePrivate = useCallback(async () => {
		if (!mid) throw new Error('No meeting to convert.')
		const res = await fetch(apiUrl(`/api/meetings/${mid}/export`))
		if (!res.ok) {
			const body = await res.json().catch(() => ({}))
			throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not download this meeting.')
		}
		const data = await res.json()
		const record: LocalMeeting = {
			id: mid,
			title: data.title,
			started_at: data.started_at,
			transcript: data.transcript ?? '',
			segments: [],
			summary_markdown: data.summary_markdown ?? null,
			context: data.context ?? null,
			summary_length: data.summary_length ?? 'narrative',
			summary_language_mode: data.summary_language_mode ?? 'auto',
			summary_custom_language: data.summary_custom_language ?? null,
			timezone: data.timezone ?? null,
			duration_seconds: data.duration_seconds ?? null,
			word_count: data.word_count ?? null,
			speaker_count: data.speaker_count ?? null,
			client_stats: data.client_stats ? JSON.parse(data.client_stats) : null,
			updated_at: new Date().toISOString(),
			unfinished: false,
		}
		await putLocalMeeting(record)
		// Verify before destroying anything.
		const stored = await getLocalMeeting(mid)
		if (!stored?.summary_markdown && !stored?.transcript) throw new Error('The copy did not save; nothing was deleted from the server.')

		const del = await fetch(apiUrl(`/api/meetings/${mid}/make-private`), { method: 'POST', headers: ownerHeaders(mid) })
		if (!del.ok) {
			const body = await del.json().catch(() => ({}))
			throw new Error(typeof body.detail === 'string' ? body.detail : 'Copied to this device, but the server copy could not be removed.')
		}
		saveMeetingMeta({
			id: mid,
			title: record.title,
			started_at: record.started_at,
			status: 'complete',
			storage: 'local',
			duration_seconds: record.duration_seconds,
		})
		applyLocalMeeting(record)
	}, [mid, applyLocalMeeting])

	return {
		expiresAt,
		publishedLocally,
		tombstone,
		recoveredCopy,
		makePrivate,
		isLocal: localMeeting != null,
		localMeeting,
		applyLocalMeeting,
		updateLocalMeeting,
		removeLocalMeeting,
		transcript,
		summaryMarkdown,
		isLoading,
		isProcessing,
		error,
		meetingTitle,
		meetingStartedAt,
		meetingTimezone,
		context,
		currentMeetingLength,
		submittedFeedback,
		isRegenerating,
		canRediarize,
		diarizationAttempted,
		speakerCount,
		clientStats,
		processingStage,
		processingTotal,
		handleRediarize,
		handleTranslate,
		handleFeedbackToggle,
		handleSuggestionSubmit,
		handleRegenerate,
		handleSummaryUpdate,
		handleTitleUpdate,
		loadedFromCache,
	}
}
