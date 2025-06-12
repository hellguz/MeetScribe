// ./frontend/src/pages/Summary.tsx
import React, { useEffect, useState, useCallback, useContext } from 'react' // Add useContext
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { saveMeeting, getHistory, MeetingMeta } from '../utils/history' // Added getHistory and MeetingMeta
import { getCached, saveCached } from '../utils/summaryCache'
import ThemeToggle from '../components/ThemeToggle';
import { ThemeContext } from '../contexts/ThemeContext'; // Import ThemeContext
import { lightTheme, darkTheme, AppTheme } from '../styles/theme'; // Import themes and AppTheme

export default function Summary() {
	const { mid } = useParams<{ mid: string }>()
	const themeContext = useContext(ThemeContext);
	if (!themeContext) throw new Error("ThemeContext not found");
	const { theme } = themeContext;
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;
	const [summary, setSummary] = useState<string | null>(null)
	const [transcript, setTranscript] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [isProcessing, setIsProcessing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [meetingTitle, setMeetingTitle] = useState<string>('')
	const [meetingStartedAt, setMeetingStartedAt] = useState<string>('')
	const [loadedFromCache, setLoadedFromCache] = useState(false)

	// State for inline title editing
	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [editedTitle, setEditedTitle] = useState('')
	const [isTitleHovered, setIsTitleHovered] = useState(false)


	const handleTitleUpdateConfirm = useCallback(async () => {
		if (!mid) return;

		const trimmedEditedTitle = editedTitle.trim();

		if (trimmedEditedTitle === '' || trimmedEditedTitle === meetingTitle) {
			setIsEditingTitle(false);
			return;
		}

		try {
			const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}/title`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: trimmedEditedTitle }),
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.detail || 'Failed to update title');
			}

			const updatedMeetingFromServer = await response.json();
			setMeetingTitle(updatedMeetingFromServer.title); // Update title with server response

			// Update localStorage
			const history = getHistory();
			const currentMeetingInHistory = history.find(m => m.id === mid);
			saveMeeting({
				id: mid,
				title: updatedMeetingFromServer.title,
				started_at: meetingStartedAt || updatedMeetingFromServer.started_at || new Date().toISOString(),
				status: currentMeetingInHistory?.status || 'complete', // Preserve status or default
			});

		} catch (err) {
			console.error('Error updating meeting title:', err);
			alert(`Error updating title: ${err instanceof Error ? err.message : String(err)}`);
			// Optionally revert editedTitle or allow retry
		} finally {
			setIsEditingTitle(false);
		}
	}, [mid, editedTitle, meetingTitle, meetingStartedAt, setMeetingTitle]);


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
					setMeetingTitle(data.title || `Meeting ${mid}`)
					setMeetingStartedAt(data.started_at || new Date().toISOString())
				}

				if (data.done && data.summary_markdown) {
					const sum = data.summary_markdown
					setSummary(sum)
					setIsProcessing(false)
					setIsLoading(false)

					saveCached({
						id: data.id,
						summary: sum,
						transcript: trn,
						updatedAt: new Date().toISOString(),
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
		[mid, loadedFromCache],
	) // Added loadedFromCache to dependencies

	// Initial fetch
	useEffect(() => {
		if (mid) {
			const cachedData = getCached(mid)
			if (cachedData) {
				setSummary(cachedData.summary)
				setTranscript(cachedData.transcript || null) // Ensure null if undefined
				// Optional: If you cache title/date, set them here too
				// setMeetingTitle(cachedData.title);
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
	const font: React.CSSProperties = {
		fontFamily: '"Inter", sans-serif',
		fontSize: 18,
		lineHeight: 1.6,
	}

	return (
		<div style={{ ...font, maxWidth: 800, margin: '0 auto', padding: 24, color: currentThemeColors.text /* Main text color */ }}>
			<ThemeToggle />

			{/* Title Display and Editing */}
			<div
				onMouseEnter={() => setIsTitleHovered(true)}
				onMouseLeave={() => setIsTitleHovered(false)}
				style={{
					position: 'relative',
					display: 'flex', // Use flex to align title and icon
					alignItems: 'center', // Vertically center icon with text/input
					marginBottom: '24px', // Add some space below the title
				}}
			>
				{isEditingTitle ? (
					<input
						type="text"
						value={editedTitle}
						onChange={(e) => setEditedTitle(e.target.value)}
						onBlur={handleTitleUpdateConfirm}
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleTitleUpdateConfirm();
							if (e.key === 'Escape') {
								setIsEditingTitle(false);
								setEditedTitle(meetingTitle); // Reset to original
							}
						}}
						style={{
							fontSize: '2em', // Match h1 style
							fontWeight: 'bold',
							padding: '8px 12px',
							border: `1px solid ${currentThemeColors.input.border}`,
							borderRadius: '6px',
							backgroundColor: currentThemeColors.input.background,
							color: currentThemeColors.input.text,
							flexGrow: 1, // Allow input to take available space
						}}
						autoFocus
					/>
				) : (
					<h1 style={{ color: currentThemeColors.text, margin: 0, flexGrow: 1 /* Allow h1 to take space */ }}>
						{meetingTitle || `Summary for ${mid}`}
					</h1>
				)}
				{isTitleHovered && !isEditingTitle && (
					<span
						onClick={(e) => {
							e.stopPropagation();
							setIsEditingTitle(true);
							setEditedTitle(meetingTitle);
						}}
						style={{
							cursor: 'pointer',
							marginLeft: '10px', // Space between title and icon
							fontSize: '0.8em', // Relative to h1, adjust as needed
							color: currentThemeColors.secondaryText,
						}}
						title="Edit title"
					>
						✏️
					</span>
				)}
			</div>

			{isLoading && <p>Loading summary...</p>}
			{error && <p style={{ color: currentThemeColors.button.danger /* Error text color */ }}>Error: {error}</p>}

			{!isLoading && !error && isProcessing && !summary && <p>⏳ Processing summary, please wait...</p>}

			{summary && <ReactMarkdown
				components={{
					h1: ({node, ...props}) => <h1 style={{color: currentThemeColors.text}} {...props} />,
					h2: ({node, ...props}) => <h2 style={{color: currentThemeColors.text}} {...props} />,
					h3: ({node, ...props}) => <h3 style={{color: currentThemeColors.text}} {...props} />,
					p: ({node, ...props}) => <p style={{color: currentThemeColors.text}} {...props} />,
					li: ({node, ...props}) => <li style={{color: currentThemeColors.text}} {...props} />,
					// Add other elements as needed
				}}
			>{summary}</ReactMarkdown>}

			{/* Always show the transcript (even if no summary yet) */}
			{!isLoading && !error && transcript && (
				<>
					<h2 style={{ marginTop: 32, color: currentThemeColors.text }}>Full Transcript (raw)</h2>
					<pre
						style={{
							...font,
							whiteSpace: 'pre-wrap',
							backgroundColor: currentThemeColors.backgroundSecondary, // Themed background
							color: currentThemeColors.text, // Themed text
							padding: 16,
							borderRadius: 4,
							overflowX: 'auto',
							border: `1px solid ${currentThemeColors.border}` // Themed border
						}}>
						{transcript}
					</pre>
				</>
			)}
		</div>
	)
}
