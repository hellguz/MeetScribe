import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme, AppTheme } from '../styles/theme'
import FeedbackComponent from '../components/FeedbackComponent'
import SummaryLengthSelector from '../components/SummaryLengthSelector'
import LanguageSelector from '../components/LanguageSelector'
import { useMeetingSummary } from '../hooks/useMeetingSummary'
import { useSummaryLanguage, SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { SummaryLength } from '../contexts/SummaryLengthContext'

const formatMeetingDate = (isoString?: string, timeZone?: string | null): string | null => {
	if (!isoString) return null

	try {
		const date = new Date(isoString)
		const minutes = date.getMinutes()
		const roundedMinutes = Math.round(minutes)
		date.setMinutes(roundedMinutes, 0, 0)

		const options: Intl.DateTimeFormatOptions = {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: timeZone || undefined,
		}

		return new Intl.DateTimeFormat('en-GB', options).format(date)
	} catch (error) {
		console.error('Error formatting date:', error)
		return 'Invalid Date'
	}
}

export default function Summary() {
	const { mid } = useParams<{ mid: string }>()
	const navigate = useNavigate()
	const { theme } = useTheme()
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme
	const { languageState, setLanguageState } = useSummaryLanguage()

	const {
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
		handleFeedbackToggle,
		handleSuggestionSubmit,
		handleRegenerate,
		handleSummaryUpdate,
		handleTitleUpdate,
		loadedFromCache,
	} = useMeetingSummary({ mid, languageState, setLanguageState })

	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [editedTitle, setEditedTitle] = useState('')
	const [editedContext, setEditedContext] = useState<string | null>(null)
	const [isTranscriptVisible, setIsTranscriptVisible] = useState(false)
	const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copied_md'>('idle')
	const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	const [isEditingMarkdown, setIsEditingMarkdown] = useState(false)
	const [editedMarkdown, setEditedMarkdown] = useState('')
	const textareaRef = useRef<HTMLTextAreaElement | null>(null)
	const cancelClickedRef = useRef(false)

	useEffect(() => {
		if (context !== null && editedContext === null) {
			setEditedContext(context)
		}
	}, [context, editedContext])

	useEffect(() => {
		return () => {
			if (copyTimeoutRef.current) {
				clearTimeout(copyTimeoutRef.current)
			}
		}
	}, [])

	// Auto-resize textarea on open
	useEffect(() => {
		if (isEditingMarkdown && textareaRef.current) {
			const ta = textareaRef.current
			ta.style.height = 'auto'
			ta.style.height = ta.scrollHeight + 'px'
		}
	}, [isEditingMarkdown])

	const handleTitleUpdateConfirm = useCallback(async () => {
		if (editedTitle.trim() && editedTitle.trim() !== meetingTitle) {
			await handleTitleUpdate(editedTitle.trim())
		}
		setIsEditingTitle(false)
	}, [editedTitle, meetingTitle, handleTitleUpdate])

	const handleContextUpdateConfirm = () => {
		if (editedContext !== context) {
			handleRegenerate({ newContext: editedContext })
		}
	}

	const handleSaveMarkdown = useCallback(async () => {
		setIsEditingMarkdown(false)
		cancelClickedRef.current = false
		if (editedMarkdown !== summaryMarkdown) {
			await handleSummaryUpdate(editedMarkdown)
		}
	}, [editedMarkdown, summaryMarkdown, handleSummaryUpdate])

	const handleCancelEdit = useCallback(() => {
		cancelClickedRef.current = false
		setIsEditingMarkdown(false)
		setEditedMarkdown('')
	}, [])

	const handleTextareaBlur = useCallback(() => {
		if (cancelClickedRef.current) return
		handleSaveMarkdown()
	}, [handleSaveMarkdown])

	const handleMarkdownDoubleClick = useCallback(() => {
		const markdown = summaryMarkdown || ''
		const selectedText = window.getSelection()?.toString().trim() || ''
		setEditedMarkdown(markdown)
		setIsEditingMarkdown(true)
		setTimeout(() => {
			if (!textareaRef.current) return
			textareaRef.current.focus()
			if (selectedText) {
				const idx = markdown.indexOf(selectedText)
				if (idx >= 0) {
					textareaRef.current.setSelectionRange(idx, idx + selectedText.length)
					return
				}
			}
			const len = markdown.length
			textareaRef.current.setSelectionRange(len, len)
		}, 0)
	}, [summaryMarkdown])

	const handleEditClick = useCallback(() => {
		const markdown = summaryMarkdown || ''
		setEditedMarkdown(markdown)
		setIsEditingMarkdown(true)
	}, [summaryMarkdown])

	const handleCopy = async (format: 'text' | 'markdown') => {
		if (!meetingTitle || !summaryMarkdown) return

		const formattedDate = formatMeetingDate(meetingStartedAt, meetingTimezone) || ''
		let textToCopy = ''

		if (format === 'markdown') {
			textToCopy = `# ${meetingTitle}\n\n*${formattedDate}*\n\n---\n\n${summaryMarkdown}`
		} else {
			const plainSummary = summaryMarkdown
				.replace(/^---\s*$/gm, '')
				.replace(/####\s/g, '')
				.replace(/###\s/g, '')
				.replace(/\*\*(.*?)\*\*/g, '$1')
				.replace(/_(.*?)_/g, '$1')
				.replace(/-\s/g, '• ')
				.replace(/\[(.*?)\]\(.*?\)/g, '$1')
				.trim()
			textToCopy = `${meetingTitle}\n${formattedDate}\n\n${plainSummary}`
		}

		try {
			await navigator.clipboard.writeText(textToCopy)
			setCopyStatus(format === 'markdown' ? 'copied_md' : 'copied')

			if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
			copyTimeoutRef.current = setTimeout(() => setCopyStatus('idle'), 5000)
		} catch (err) {
			console.error('Failed to copy text: ', err)
			alert('Could not copy to clipboard.')
		}
	}

	const handleLanguageChange = async (update: Partial<SummaryLanguageState>) => {
		if (!mid) return
		const newState = { ...languageState, ...update }
		setLanguageState(newState)

		const targetLanguage = newState.mode === 'custom' ? newState.lastCustomLanguage : newState.mode

		try {
			const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}/translate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					target_language: targetLanguage,
					language_mode: newState.mode,
				}),
			})
			if (!response.ok) {
				throw new Error('Failed to start translation.')
			}
		} catch (err) {
			console.error('Translation error:', err)
			alert('Could not start translation.')
		}
	}

	const handleLengthChangeWithWarning = (newLength: SummaryLength) => {
		handleRegenerate({ newLength })
	}

	const formattedDate = formatMeetingDate(meetingStartedAt, meetingTimezone)
	const contextHasChanged = editedContext !== null && context !== null && editedContext !== context
	const hasSummary = !!summaryMarkdown && !isProcessing
	const displayLoading = (isLoading && !loadedFromCache)
	const displayError = error
	const showProcessingMessage = (isProcessing || isRegenerating) && !summaryMarkdown

	const copyButtonStyle: React.CSSProperties = {
		padding: '8px 16px',
		border: 'none',
		backgroundColor: 'transparent',
		color: currentThemeColors.text,
		cursor: 'pointer',
		fontSize: '14px',
		fontWeight: 500,
		transition: 'background-color 0.2s ease',
		fontFamily: 'inherit',
	}

	return (
		<div style={{ maxWidth: 800, margin: '0 auto', padding: 24, color: currentThemeColors.text }}>
			<ThemeToggle />

			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
				<button
					onClick={() => navigate('/record')}
					style={{
						background: 'none',
						border: 'none',
						cursor: 'pointer',
						color: currentThemeColors.secondaryText,
						fontSize: '15px',
						fontFamily: 'inherit',
					}}>
					← Back to Recordings
				</button>

				{hasSummary && !isProcessing && (
					<div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
						{copyStatus !== 'idle' && (
							<span
								style={{
									color: currentThemeColors.secondaryText,
									fontSize: '14px',
									transition: 'opacity 0.5s ease-in-out',
									opacity: 1,
								}}>
								Copied! ✨
							</span>
						)}

						<div
							style={{
								display: 'flex',
								borderRadius: '6px',
								overflow: 'hidden',
								border: `1px solid ${currentThemeColors.border}`,
								backgroundColor: currentThemeColors.backgroundSecondary,
							}}>
							<button
								onClick={() => handleCopy('text')}
								style={copyButtonStyle}
								onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
								onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
								Copy Text
							</button>
							<div style={{ width: '1px', backgroundColor: currentThemeColors.border }} />
							<button
								onClick={() => handleCopy('markdown')}
								style={copyButtonStyle}
								onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
								onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
								Copy Markdown
							</button>
						</div>
					</div>
				)}
			</div>

			<div
				style={{
					backgroundColor: currentThemeColors.background,
					padding: '16px',
					borderRadius: '12px',
					border: `1px solid ${currentThemeColors.border}`,
					marginBottom: '24px',
				}}>
				{isEditingTitle ? (
					<input
						type="text"
						value={editedTitle}
						onChange={(e) => setEditedTitle(e.target.value)}
						onBlur={handleTitleUpdateConfirm}
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleTitleUpdateConfirm()
							if (e.key === 'Escape') setIsEditingTitle(false)
						}}
						style={{
							fontSize: '1.7em',
							fontWeight: '600',
							width: '100%',
							border: `1px solid ${currentThemeColors.input.border}`,
							borderRadius: '6px',
							backgroundColor: currentThemeColors.input.background,
							color: currentThemeColors.input.text,
							fontFamily: 'inherit',
						}}
						autoFocus
					/>
				) : (
					<h1
						onClick={() => {
							setEditedTitle(meetingTitle || '')
							setIsEditingTitle(true)
						}}
						style={{
							cursor: 'pointer',
							fontSize: '1.7em',
							margin: 0,
							fontFamily: 'inherit',
							fontWeight: 600,
							lineHeight: 1.2,
						}}>
						{meetingTitle || (isLoading ? ' ' : `Summary for ${mid}`)}
					</h1>
				)}

				{formattedDate && (
					<p style={{ margin: '8px 0 0 0', fontSize: '14px', color: currentThemeColors.secondaryText, fontFamily: 'inherit' }}>{formattedDate}</p>
				)}

				{(hasSummary || isProcessing) && (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
						<div
							style={{
								display: 'flex',
								flexDirection: 'row',
								gap: '10px',
								justifyContent: 'space-between',
								alignItems: 'center',
							}}>
							<SummaryLengthSelector value={currentMeetingLength} disabled={isRegenerating || isProcessing} onSelect={handleLengthChangeWithWarning} />
							<LanguageSelector disabled={isRegenerating || isProcessing} onSelectionChange={handleLanguageChange} />
						</div>

						<div>
							<label htmlFor="context-editor" style={{ display: 'block', fontWeight: 500, marginBottom: '8px', fontSize: '14px' }}>
								Context
							</label>
							<textarea
								id="context-editor"
								value={editedContext ?? ''}
								onChange={(e) => setEditedContext(e.target.value)}
								placeholder="Add participant names, project codes, or key terms here to improve summary accuracy. Changes will trigger a regeneration."
								disabled={isRegenerating || isProcessing}
								style={{
									width: '100%',
									minHeight: '60px',
									padding: '10px 12px',
									borderRadius: '8px',
									border: `1px solid ${currentThemeColors.input.border}`,
									backgroundColor: currentThemeColors.input.background,
									color: currentThemeColors.input.text,
									fontSize: '14px',
									resize: 'vertical',
									boxSizing: 'border-box',
									opacity: (isRegenerating || isProcessing) ? 0.7 : 1,
								}}
							/>
							{contextHasChanged && (
								<button
									onClick={handleContextUpdateConfirm}
									disabled={isRegenerating || isProcessing}
									style={{
										marginTop: '12px',
										padding: '8px 16px',
										border: 'none',
										borderRadius: '8px',
										backgroundColor: currentThemeColors.button.primary,
										color: currentThemeColors.button.primaryText,
										fontSize: '14px',
										fontWeight: '500',
										cursor: (isRegenerating || isProcessing) ? 'not-allowed' : 'pointer',
										opacity: (isRegenerating || isProcessing) ? 0.6 : 1,
										transition: 'all 0.2s ease',
									}}>
									Apply & Regenerate Summary
								</button>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Main Content Area */}
			{displayLoading ? (
				<p>Loading summary...</p>
			) : displayError ? (
				<p style={{ color: currentThemeColors.button.danger }}>Error: {displayError}</p>
			) : hasSummary ? (
				<div
					style={{
						backgroundColor: currentThemeColors.background,
						borderRadius: '12px',
						border: `1px solid ${currentThemeColors.border}`,
						overflow: 'hidden',
						position: 'relative',
					}}>
					{/* Edit / Save+Cancel buttons — always top right */}
					<div style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', gap: '6px', zIndex: 1 }}>
						{isEditingMarkdown ? (
							<>
								<button
									onMouseDown={(e) => e.preventDefault()}
									onClick={handleSaveMarkdown}
									style={{
										padding: '6px 12px',
										border: 'none',
										borderRadius: '6px',
										backgroundColor: currentThemeColors.button.primary,
										color: currentThemeColors.button.primaryText,
										fontSize: '13px',
										fontWeight: 500,
										cursor: 'pointer',
										fontFamily: 'inherit',
									}}>
									Save
								</button>
								<button
									onMouseDown={() => { cancelClickedRef.current = true }}
									onClick={handleCancelEdit}
									style={{
										padding: '6px 12px',
										border: `1px solid ${currentThemeColors.border}`,
										borderRadius: '6px',
										backgroundColor: currentThemeColors.background,
										color: currentThemeColors.text,
										fontSize: '13px',
										cursor: 'pointer',
										fontFamily: 'inherit',
									}}>
									Cancel
								</button>
							</>
						) : (
							<button
								onClick={handleEditClick}
								style={{
									padding: '6px 12px',
									border: `1px solid ${currentThemeColors.border}`,
									borderRadius: '6px',
									backgroundColor: currentThemeColors.backgroundSecondary,
									color: currentThemeColors.secondaryText,
									fontSize: '13px',
									cursor: 'pointer',
									fontFamily: 'inherit',
								}}>
								Edit
							</button>
						)}
					</div>

					{isEditingMarkdown ? (
						<div style={{ padding: '20px 24px' }}>
							<textarea
								ref={textareaRef}
								value={editedMarkdown}
								onChange={(e) => {
									setEditedMarkdown(e.target.value)
									e.target.style.height = 'auto'
									e.target.style.height = e.target.scrollHeight + 'px'
								}}
								onBlur={handleTextareaBlur}
								onKeyDown={(e) => {
									if (e.key === 'Escape') {
										cancelClickedRef.current = true
										handleCancelEdit()
									}
								}}
								style={{
									width: '100%',
									minHeight: '300px',
									padding: '36px 0 0 0',
									border: 'none',
									outline: 'none',
									backgroundColor: 'transparent',
									color: currentThemeColors.text,
									fontSize: '15px',
									lineHeight: '1.7',
									resize: 'none',
									fontFamily: 'monospace',
									boxSizing: 'border-box',
								}}
								autoFocus
							/>
						</div>
					) : (
						<div
							onDoubleClick={handleMarkdownDoubleClick}
							style={{
								padding: '20px 24px',
								lineHeight: '1.7',
								fontSize: '15px',
								cursor: 'text',
							}}
							className="markdown-content">
							<ReactMarkdown>{summaryMarkdown}</ReactMarkdown>
						</div>
					)}
				</div>
			) : showProcessingMessage ? (
				<p>⏳ Processing summary, please wait...</p>
			) : (
				<p>No summary is available for this meeting.</p>
			)}

			{hasSummary && !isLoading && (
				<FeedbackComponent
					submittedTypes={submittedFeedback}
					onFeedbackToggle={handleFeedbackToggle}
					onSuggestionSubmit={handleSuggestionSubmit}
					theme={theme}
				/>
			)}

			{transcript && (
				<div
					style={{
						marginTop: '32px',
						backgroundColor: currentThemeColors.background,
						padding: '16px 24px',
						borderRadius: '12px',
						border: `1px solid ${currentThemeColors.border}`,
					}}>
					<h4
						onClick={() => setIsTranscriptVisible(!isTranscriptVisible)}
						style={{ cursor: 'pointer', userSelect: 'none', margin: 0, display: 'flex', alignItems: 'center' }}>
						<span
							style={{
								display: 'inline-block',
								transform: isTranscriptVisible ? 'rotate(90deg)' : 'rotate(0deg)',
								transition: 'transform 0.2s',
								marginRight: '8px',
							}}>
							▶
						</span>{' '}
						🎤 Transcript
					</h4>
					{isTranscriptVisible && (
						<pre
							style={{
								marginTop: '16px',
								whiteSpace: 'pre-wrap',
								color: currentThemeColors.text,
								fontSize: '14px',
								lineHeight: '1.6',
							}}>
							{transcript}
						</pre>
					)}
				</div>
			)}
		</div>
	)
}
