// ./frontend/src/pages/Summary.tsx
import React, { useEffect, useState, useCallback, useContext } from 'react' // Add useContext
import { useParams, useNavigate } from 'react-router-dom' // <<< Add useNavigate
import ReactMarkdown from 'react-markdown'
import { saveMeeting, getHistory, MeetingMeta } from '../utils/history' // Added getHistory and MeetingMeta
import { getCached, saveCached } from '../utils/summaryCache'
import ThemeToggle from '../components/ThemeToggle'
import { ThemeContext } from '../contexts/ThemeContext' // Import ThemeContext
import { lightTheme, darkTheme, AppTheme } from '../styles/theme' // Import themes and AppTheme

export default function Summary() {
	const { mid } = useParams<{ mid: string }>()
	const navigate = useNavigate() // <<< Initialize navigate
	const themeContext = useContext(ThemeContext)
	if (!themeContext) throw new Error('ThemeContext not found')
	const { theme } = themeContext
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme
	const [summary, setSummary] = useState<string | null>(null)
	const [transcript, setTranscript] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [isProcessing, setIsProcessing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [meetingTitle, setMeetingTitle] = useState<string | null>(null) // Changed initial state to null
	const [meetingStartedAt, setMeetingStartedAt] = useState<string>('')
	const [loadedFromCache, setLoadedFromCache] = useState(false)

	// State for inline title editing
	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [editedTitle, setEditedTitle] = useState('')
	const [isTitleHovered, setIsTitleHovered] = useState(false)

	// State for feedback
	const [showFeatureSuggestionInput, setShowFeatureSuggestionInput] = useState(false)
	const [featureSuggestionText, setFeatureSuggestionText] = useState('')
	const [feedbackLoading, setFeedbackLoading] = useState(false)
	const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)


	const handleFeedback = async (feedbackType: string, suggestion?: string) => {
		if (!mid) return
		setFeedbackLoading(true)
		setFeedbackMessage(null)

		try {
			const payload: { meeting_id: string; feedback_type: string; feature_suggestion?: string } = {
				meeting_id: mid,
				feedback_type: feedbackType,
			}
			if (suggestion) {
				payload.feature_suggestion = suggestion
			}

			const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/feedback`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}))
				throw new Error(errorData.detail || 'Failed to submit feedback')
			}

			setFeedbackMessage(`Feedback "${feedbackType}" submitted successfully!`)
			if (feedbackType === 'feature_suggestion') {
				setFeatureSuggestionText('')
				setShowFeatureSuggestionInput(false)
			}
			// Clear message after a few seconds
			setTimeout(() => setFeedbackMessage(null), 3000);

		} catch (err) {
			console.error('Error submitting feedback:', err)
			const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred'
			setFeedbackMessage(`Error: ${errorMessage}`)
			// Clear error message after a few seconds
			setTimeout(() => setFeedbackMessage(null), 5000);
		} finally {
			setFeedbackLoading(false)
		}
	}

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

			// Update localStorage
			const history = getHistory()
			const currentMeetingInHistory = history.find((m) => m.id === mid)
			saveMeeting({
				id: mid,
				title: updatedMeetingFromServer.title,
				started_at: meetingStartedAt || updatedMeetingFromServer.started_at || new Date().toISOString(),
				status: currentMeetingInHistory?.status || 'complete', // Preserve status or default
			})

			// Also update the summaryCache with the new title
			if (mid) {
				// Ensure mid is defined
				saveCached({
					id: mid,
					title: updatedMeetingFromServer.title,
					summary: summary || '', // Use current summary state, fallback to empty string
					transcript: transcript, // Use current transcript state
					updatedAt: new Date().toISOString(),
				})
			}
		} catch (err) {
			console.error('Error updating meeting title:', err)
			alert(`Error updating title: ${err instanceof Error ? err.message : String(err)}`)
			// Optionally revert editedTitle or allow retry
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

				// Always update transcript to show partial text, even if not 'done'
				const trn = data.transcript_text || null
				setTranscript(trn)

				if (isInitialFetch) {
					// Store title and started_at from the first successful fetch
					// These might be needed if the meeting is not yet in local history
					// If title comes from cache, this might be overwritten later by fetch, which is fine.
					if (!meetingTitle && data.title) {
						// Only set if not already set (e.g., from cache) to avoid flicker if fetch is slower
						setMeetingTitle(data.title)
					} else if (!meetingTitle) {
						setMeetingTitle(`Meeting ${mid}`)
					}
					setMeetingStartedAt(data.started_at || new Date().toISOString())
				} else if (data.title && data.title !== meetingTitle) {
					// If title changes on a subsequent fetch (e.g. user edited it elsewhere)
					setMeetingTitle(data.title)
				}

				if (data.done && data.summary_markdown) {
					const sum = data.summary_markdown
					setSummary(sum)
					setIsProcessing(false)
					setIsLoading(false)

					saveCached({
						id: data.id,
						title: data.title || meetingTitle || `Meeting ${data.id}`, // Save title to cache
						summary: sum,
						transcript: trn,
						updatedAt: new Date().toISOString(), // saveCached itself should handle this, but explicit for clarity if needed
					})

					// Update history with status 'complete'
					const historyList = getHistory()
					const existingMeta = historyList.find((m) => m.id === data.id)

					saveMeeting({
						id: data.id,
						title: existingMeta?.title || data.title || `Meeting ${data.id}`,
						started_at: existingMeta?.started_at || data.started_at || new Date().toISOString(),
						status: 'complete',
					})
				} else {
					// Not done or no summary markdown yet
					setIsProcessing(true)
					setIsLoading(false) // No longer initial loading, now it's processing
				}
			} catch (err) {
				if (loadedFromCache) {
					console.error('Network fetch failed, displaying cached version. Error:', err)
					// Optionally set a state for a subtle offline/error indicator
					// e.g., setNetworkErrorOccurred(true);
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
		[mid, loadedFromCache, meetingTitle], // added meetingTitle to dep array
	)

	// Initial fetch
	useEffect(() => {
		if (mid) {
			const cachedData = getCached(mid)
			if (cachedData) {
				setSummary(cachedData.summary)
				setTranscript(cachedData.transcript || null)
				if (cachedData.title) {
					// Load title from cache
					setMeetingTitle(cachedData.title)
				}
				// setMeetingStartedAt(cachedData.updatedAt); // Or a specific 'cachedAt' field
				setLoadedFromCache(true)
				setIsLoading(false) // Show cached content quickly
			}
		}
		// Existing fetchMeetingData call will still run to get latest
		fetchMeetingData(true)
	}, [mid]) // fetchMeetingData is not needed here as it's stable due to useCallback and mid is the real trigger

	// Polling mechanism
	useEffect(() => {
		if (!mid || !isProcessing) return

		const pollInterval = setInterval(() => {
			fetchMeetingData(false) // Not an initial fetch
		}, 5000)

		return () => clearInterval(pollInterval)
	}, [mid, isProcessing, fetchMeetingData])

	/* ─── styling ───────────────────────────────────────────────────── */
	const pageTextStyles: React.CSSProperties = {
		// <<< FIX: Explicitly set fontFamily from the theme >>>
		fontFamily: currentThemeColors.fontFamily,
		fontSize: 15,
		lineHeight: 1.6,
	}

	return (
		<div style={{ ...pageTextStyles, maxWidth: 800, margin: '0 auto', padding: 24, color: currentThemeColors.text /* Main text color */ }}>
			<ThemeToggle />

			{/* <<< NEW: Back Button >>> */}
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
					fontFamily: 'inherit', // Ensure button inherits the page font
				}}
				onMouseOver={(e) => (e.currentTarget.style.color = currentThemeColors.text)}
				onMouseOut={(e) => (e.currentTarget.style.color = currentThemeColors.secondaryText)}>
				← Back to Recordings
			</button>

			{/* Title Display and Editing */}
			<div style={{ marginBottom: '24px' }}>
				{' '}
				{/* Outer div for margin only */}
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
								setEditedTitle(meetingTitle || '') // Reset to original
							}
						}}
						style={{
							fontSize: '1.3em', // Reduced from 1.75em (approx 26% reduction)
							fontWeight: 'bold',
							padding: '8px 12px',
							border: `1px solid ${currentThemeColors.input.border}`,
							borderRadius: '6px',
							backgroundColor: currentThemeColors.input.background,
							color: currentThemeColors.input.text,
							width: '100%', // Take full width
							fontFamily: 'inherit', // Ensure input inherits font
						}}
						autoFocus
					/>
				) : (
					<h1
						onMouseEnter={() => setIsTitleHovered(true)}
						onMouseLeave={() => setIsTitleHovered(false)}
						onClick={() => {
							if (meetingTitle) {
								// Only allow editing if title is loaded
								setIsEditingTitle(true)
								setEditedTitle(meetingTitle)
							}
						}}
						style={{
							color: currentThemeColors.text,
							margin: 0,
							display: 'inline-flex', // Keep text and icon on one line
							alignItems: 'center', // Vertically align text and icon
							cursor: meetingTitle && !isEditingTitle ? 'pointer' : 'default',
						}}>
						{(() => {
							if (meetingTitle) {
								return meetingTitle
							}
							if (isLoading && !loadedFromCache) {
								return ' ' // Non-breaking space or "Loading title..."
							}
							if (error) {
								return `Error loading title`
							}
							return `Summary for ${mid}` // Fallback
						})()}
						{isTitleHovered && !isEditingTitle && meetingTitle && (
							<span
								onClick={(e) => {
									e.stopPropagation() // Prevent H1's onClick from firing as well
									if (meetingTitle) {
										setIsEditingTitle(true)
										setEditedTitle(meetingTitle)
									}
								}}
								style={{
									fontSize: '12px', // Reduced from 16px (25% reduction)
									cursor: 'pointer',
									marginLeft: '8px', // Space between title text and icon
									color: currentThemeColors.secondaryText, // Or specific icon color
								}}
								role="button"
								aria-label="Edit title"
								title="Edit title">
								✏️ {/* Edit icon, can be replaced with an SVG or icon font */}
							</span>
						)}
					</h1>
				)}
			</div>

			{isLoading && <p>Loading summary...</p>}
			{error && <p style={{ color: currentThemeColors.button.danger /* Error text color */ }}>Error: {error}</p>}

			{!isLoading && !error && isProcessing && !summary && <p>⏳ Processing summary, please wait...</p>}

			{summary && (
				<ReactMarkdown
					components={{
						h1: ({ node, ...props }) => <h1 style={{ color: currentThemeColors.text }} {...props} />,
						h2: ({ node, ...props }) => <h2 style={{ color: currentThemeColors.text }} {...props} />,
						h3: ({ node, ...props }) => <h3 style={{ color: currentThemeColors.text }} {...props} />,
						p: ({ node, ...props }) => <p style={{ color: currentThemeColors.text }} {...props} />,
						li: ({ node, ...props }) => <li style={{ color: currentThemeColors.text }} {...props} />,
						// Add other elements as needed
					}}>
					{summary}
				</ReactMarkdown>
			)}

			{/* Feedback Section */}
			{summary && !isProcessing && !isLoading && !error && (
				<div style={{ marginTop: '24px', marginBottom: '24px', padding: '16px', border: `1px solid ${currentThemeColors.border}`, borderRadius: '8px', backgroundColor: currentThemeColors.backgroundSecondary }}>
					<h3 style={{ marginTop: 0, marginBottom: '12px', color: currentThemeColors.text }}>Provide Feedback:</h3>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
						{[
							{ label: 'Spot on!', type: 'spot_on', color: '#e6ffed', textColor: '#006400' },
							{ label: 'Too short', type: 'too_short', color: '#fff9e6', textColor: '#665200' },
							{ label: 'Too detailed', type: 'too_detailed', color: '#fff9e6', textColor: '#665200' },
							{ label: 'Too general', type: 'too_general', color: '#fff9e6', textColor: '#665200' },
							{ label: 'Not accurate', type: 'not_accurate', color: '#ffe6e6', textColor: '#a80000' },
						].map(fb => (
							<button
								key={fb.type}
								onClick={() => handleFeedback(fb.type)}
								disabled={feedbackLoading}
								style={{
									padding: '8px 12px',
									borderRadius: '16px',
									border: `1px solid ${currentThemeColors.border}`,
									backgroundColor: fb.color,
									color: fb.textColor,
									cursor: 'pointer',
									fontFamily: 'inherit',
									opacity: feedbackLoading ? 0.7 : 1,
								}}
							>
								{fb.label}
							</button>
						))}
						<button
							onClick={() => setShowFeatureSuggestionInput(!showFeatureSuggestionInput)}
							disabled={feedbackLoading}
							style={{
								padding: '8px 12px',
								borderRadius: '16px',
								border: `1px solid ${currentThemeColors.border}`,
								backgroundColor: '#e6f7ff',
								color: '#005f80',
								cursor: 'pointer',
								fontFamily: 'inherit',
								opacity: feedbackLoading ? 0.7 : 1,
							}}
						>
							Suggest a feature
						</button>
					</div>
					{showFeatureSuggestionInput && (
						<div style={{ marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
							<input
								type="text"
								value={featureSuggestionText}
								onChange={(e) => setFeatureSuggestionText(e.target.value)}
								placeholder="Your feature suggestion..."
								style={{
									flexGrow: 1,
									padding: '10px',
									borderRadius: '6px',
									border: `1px solid ${currentThemeColors.input.border}`,
									backgroundColor: currentThemeColors.input.background,
									color: currentThemeColors.input.text,
									fontFamily: 'inherit',
								}}
								disabled={feedbackLoading}
							/>
							<button
								onClick={() => handleFeedback('feature_suggestion', featureSuggestionText)}
								disabled={feedbackLoading || !featureSuggestionText.trim()}
								style={{
									padding: '10px 15px',
									borderRadius: '6px',
									border: 'none',
									backgroundColor: currentThemeColors.button.primaryBackground,
									color: currentThemeColors.button.primaryText,
									cursor: (feedbackLoading || !featureSuggestionText.trim()) ? 'not-allowed' : 'pointer',
									fontFamily: 'inherit',
									opacity: (feedbackLoading || !featureSuggestionText.trim()) ? 0.7 : 1,
								}}
							>
								{feedbackLoading && showFeatureSuggestionInput ? 'Sending...' : 'Send'}
							</button>
						</div>
					)}
					{feedbackMessage && (
						<p style={{ marginTop: '10px', color: feedbackMessage.startsWith('Error:') ? currentThemeColors.button.danger : currentThemeColors.text, fontSize: '14px' }}>
							{feedbackMessage}
						</p>
					)}
				</div>
			)}

			{/* Always show the transcript (even if no summary yet) */}
			{!isLoading && !error && transcript && (
				<>
					<h2 style={{ marginTop: 32, color: currentThemeColors.text }}>🎤 Transcript</h2>
					<pre
						style={{
							...pageTextStyles, // Use updated style object
							whiteSpace: 'pre-wrap',
							backgroundColor: currentThemeColors.backgroundSecondary, // Themed background
							color: currentThemeColors.text, // Themed text
							padding: 16,
							borderRadius: 4,
							overflowX: 'auto',
							border: `1px solid ${currentThemeColors.border}`, // Themed border
						}}>
						{transcript}
					</pre>
				</>
			)}
		</div>
	)
}
