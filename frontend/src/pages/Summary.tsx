// ./frontend/src/pages/Summary.tsx
import React, { useEffect, useState, useCallback, useContext } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { saveMeeting, getHistory } from '../utils/history'
import { getCached, saveCached } from '../utils/summaryCache'
import ThemeToggle from '../components/ThemeToggle'
import { ThemeContext } from '../contexts/ThemeContext'
import { lightTheme, darkTheme, AppTheme } from '../styles/theme'
import FeedbackComponent from '../components/FeedbackComponent' // Import the new component

export default function Summary() {
	const { mid } = useParams<{ mid: string }>()
	const navigate = useNavigate()
	const themeContext = useContext(ThemeContext)
	if (!themeContext) throw new Error('ThemeContext not found')
	const { theme } = themeContext
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme
	const [summary, setSummary] = useState<string | null>(null)
	const [transcript, setTranscript] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [isProcessing, setIsProcessing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [meetingTitle, setMeetingTitle] = useState<string | null>(null)
	const [meetingStartedAt, setMeetingStartedAt] = useState<string>('')
	const [loadedFromCache, setLoadedFromCache] = useState(false)

	// State for inline title editing
	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [editedTitle, setEditedTitle] = useState('')
	const [isTitleHovered, setIsTitleHovered] = useState(false)

	const handleTitleUpdateConfirm = useCallback(async () => {
		if (!mid) return

		const trimmedEditedTitle = editedTitle.trim()

		if (trimmedEditedTitle === '' || trimmedEditedTitle === meetingTitle) {
			setIsEditingTitle(false)
			return
		}

		try {
			const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}/title`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: trimmedEditedTitle }),
			})

			if (!response.ok) {
				const errorData = await response.json()
				throw new Error(errorData.detail || 'Failed to update title')
			}

			const updatedMeetingFromServer = await response.json()
			setMeetingTitle(updatedMeetingFromServer.title) // Update title with server response

			const history = getHistory()
			const currentMeetingInHistory = history.find((m) => m.id === mid)
			saveMeeting({
				id: mid,
				title: updatedMeetingFromServer.title,
				started_at: meetingStartedAt || updatedMeetingFromServer.started_at || new Date().toISOString(),
				status: currentMeetingInHistory?.status || 'complete',
			})

			if (mid) {
				saveCached({
					id: mid,
					title: updatedMeetingFromServer.title,
					summary: summary || '',
					transcript: transcript,
					updatedAt: new Date().toISOString(),
				})
			}
		} catch (err) {
			console.error('Error updating meeting title:', err)
			alert(`Error updating title: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			setIsEditingTitle(false)
		}
	}, [mid, editedTitle, meetingTitle, meetingStartedAt, setMeetingTitle, summary, transcript])

	const fetchMeetingData = useCallback(
		async (isInitialFetch: boolean = false) => {
			if (!mid) return

			if (isInitialFetch) {
				if (!loadedFromCache) {
					setIsLoading(true)
				}
				setError(null)
			}

			try {
				const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}`)

				if (!res.ok) {
					const errorData = await res.json().catch(() => ({ message: 'Failed to fetch meeting data' }))
					throw new Error(errorData.message || `HTTP error! status: ${res.status}`)
				}

				const data = await res.json()
				const trn = data.transcript_text || null
				setTranscript(trn)

				if (isInitialFetch) {
					if (!meetingTitle && data.title) {
						setMeetingTitle(data.title)
					} else if (!meetingTitle) {
						setMeetingTitle(`Meeting ${mid}`)
					}
					setMeetingStartedAt(data.started_at || new Date().toISOString())
				} else if (data.title && data.title !== meetingTitle) {
					setMeetingTitle(data.title)
				}

				if (data.done && data.summary_markdown) {
					const sum = data.summary_markdown
					setSummary(sum)
					setIsProcessing(false)
					setIsLoading(false)

					saveCached({
						id: data.id,
						title: data.title || meetingTitle || `Meeting ${data.id}`,
						summary: sum,
						transcript: trn,
						updatedAt: new Date().toISOString(),
					})

					const historyList = getHistory()
					const existingMeta = historyList.find((m) => m.id === data.id)

					saveMeeting({
						id: data.id,
						title: existingMeta?.title || data.title || `Meeting ${data.id}`,
						started_at: existingMeta?.started_at || data.started_at || new Date().toISOString(),
						status: 'complete',
					})
				} else {
					setIsProcessing(true)
					setIsLoading(false)
				}
			} catch (err) {
				if (loadedFromCache) {
					console.error('Network fetch failed, displaying cached version. Error:', err)
				} else {
					if (err instanceof Error) {
						setError(err.message)
					} else {
						setError('An unknown error occurred.')
					}
				}
				setIsLoading(false)
				setIsProcessing(false)
			}
		},
		[mid, loadedFromCache, meetingTitle],
	)

	const handleFeedbackSubmit = async (feedbackTypes: string[], suggestionText?: string) => {
		if (!mid) return
		try {
			await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/feedback`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					meeting_id: mid,
					feedback_types: feedbackTypes,
					suggestion_text: suggestionText,
				}),
			})
			// The component will show its own "thank you" message
		} catch (error) {
			console.error('Failed to submit feedback:', error)
			alert("Sorry, we couldn't submit your feedback right now.")
		}
	}

	// Initial fetch
	useEffect(() => {
		if (mid) {
			const cachedData = getCached(mid)
			if (cachedData) {
				setSummary(cachedData.summary)
				setTranscript(cachedData.transcript || null)
				if (cachedData.title) {
					setMeetingTitle(cachedData.title)
				}
				setLoadedFromCache(true)
				setIsLoading(false)
			}
		}
		fetchMeetingData(true)
	}, [mid, fetchMeetingData])

	// Polling mechanism
	useEffect(() => {
		if (!mid || !isProcessing) return

		const pollInterval = setInterval(() => {
			fetchMeetingData(false)
		}, 5000)

		return () => clearInterval(pollInterval)
	}, [mid, isProcessing, fetchMeetingData])

	const pageTextStyles: React.CSSProperties = {
		fontFamily: currentThemeColors.fontFamily,
		fontSize: 15,
		lineHeight: 1.6,
	}

	return (
		<div style={{ ...pageTextStyles, maxWidth: 800, margin: '0 auto', padding: 24, color: currentThemeColors.text }}>
			<ThemeToggle />

			<button
				onClick={() => navigate('/record')}
				style={{
					background: 'none',
					border: 'none',
					cursor: 'pointer',
					color: currentThemeColors.secondaryText,
					fontSize: '15px',
					display: 'inline-flex',
					alignItems: 'center',
					gap: '8px',
					padding: '0',
					marginBottom: '24px',
					transition: 'color 0.2s',
					fontFamily: 'inherit',
				}}
				onMouseOver={(e) => (e.currentTarget.style.color = currentThemeColors.text)}
				onMouseOut={(e) => (e.currentTarget.style.color = currentThemeColors.secondaryText)}>
				← Back to Recordings
			</button>

			<div style={{ marginBottom: '24px' }}>
				{isEditingTitle ? (
					<input
						type="text"
						value={editedTitle}
						onChange={(e) => setEditedTitle(e.target.value)}
						onBlur={handleTitleUpdateConfirm}
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleTitleUpdateConfirm()
							if (e.key === 'Escape') {
								setIsEditingTitle(false)
								setEditedTitle(meetingTitle || '')
							}
						}}
						style={{
							fontSize: '1.3em',
							fontWeight: 'bold',
							padding: '8px 12px',
							border: `1px solid ${currentThemeColors.input.border}`,
							borderRadius: '6px',
							backgroundColor: currentThemeColors.input.background,
							color: currentThemeColors.input.text,
							width: '100%',
							fontFamily: 'inherit',
						}}
						autoFocus
					/>
				) : (
					<h1
						onMouseEnter={() => setIsTitleHovered(true)}
						onMouseLeave={() => setIsTitleHovered(false)}
						onClick={() => {
							if (meetingTitle) {
								setIsEditingTitle(true)
								setEditedTitle(meetingTitle)
							}
						}}
						style={{
							color: currentThemeColors.text,
							margin: 0,
							display: 'inline-flex',
							alignItems: 'center',
							cursor: meetingTitle && !isEditingTitle ? 'pointer' : 'default',
						}}>
						{(() => {
							if (meetingTitle) {
								return meetingTitle
							}
							if (isLoading && !loadedFromCache) {
								return ' '
							}
							if (error) {
								return `Error loading title`
							}
							return `Summary for ${mid}`
						})()}
						{isTitleHovered && !isEditingTitle && meetingTitle && (
							<span
								onClick={(e) => {
									e.stopPropagation()
									if (meetingTitle) {
										setIsEditingTitle(true)
										setEditedTitle(meetingTitle)
									}
								}}
								style={{
									fontSize: '12px',
									cursor: 'pointer',
									marginLeft: '8px',
									color: currentThemeColors.secondaryText,
								}}
								role="button"
								aria-label="Edit title"
								title="Edit title">
								✏️
							</span>
						)}
					</h1>
				)}
			</div>

			{isLoading && <p>Loading summary...</p>}
			{error && <p style={{ color: currentThemeColors.button.danger }}>Error: {error}</p>}

			{!isLoading && !error && isProcessing && !summary && <p>⏳ Processing summary, please wait...</p>}

			{summary && (
				<ReactMarkdown
					components={{
						h1: ({ node, ...props }) => <h1 style={{ color: currentThemeColors.text }} {...props} />,
						h2: ({ node, ...props }) => <h2 style={{ color: currentThemeColors.text }} {...props} />,
						h3: ({ node, ...props }) => <h3 style={{ color: currentThemeColors.text }} {...props} />,
						p: ({ node, ...props }) => <p style={{ color: currentThemeColors.text }} {...props} />,
						li: ({ node, ...props }) => <li style={{ color: currentThemeColors.text }} {...props} />,
					}}>
					{summary}
				</ReactMarkdown>
			)}

			{!isLoading && !error && summary && <FeedbackComponent onSubmit={handleFeedbackSubmit} theme={theme} />}

			{!isLoading && !error && transcript && (
				<>
					<h2 style={{ marginTop: 32, color: currentThemeColors.text }}>🎤 Transcript</h2>
					<pre
						style={{
							...pageTextStyles,
							whiteSpace: 'pre-wrap',
							backgroundColor: currentThemeColors.backgroundSecondary,
							color: currentThemeColors.text,
							padding: 16,
							borderRadius: 4,
							overflowX: 'auto',
							border: `1px solid ${currentThemeColors.border}`,
						}}>
						{transcript}
					</pre>
				</>
			)}
		</div>
	)
}
