import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { marked } from 'marked'
import TurndownService from 'turndown'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme, AppTheme } from '../styles/theme'
import FeedbackComponent from '../components/FeedbackComponent'
import SummaryLengthSelector from '../components/SummaryLengthSelector'
import LanguageSelector from '../components/LanguageSelector'
import { useMeetingSummary } from '../hooks/useMeetingSummary'
import { useSummaryLanguage, SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { SummaryLength } from '../contexts/SummaryLengthContext'

marked.setOptions({ breaks: false })

const turndown = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-' })
// Strip span tags (browsers add them while editing) but keep their text content
turndown.addRule('spans', { filter: 'span', replacement: (content) => content })

const formatMeetingDate = (isoString?: string, timeZone?: string | null): string | null => {
	if (!isoString) return null
	try {
		const date = new Date(isoString)
		date.setMinutes(Math.round(date.getMinutes()), 0, 0)
		return new Intl.DateTimeFormat('en-GB', {
			day: 'numeric', month: 'long', year: 'numeric',
			hour: '2-digit', minute: '2-digit', hour12: false,
			timeZone: timeZone || undefined,
		}).format(date)
	} catch {
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

	const [editedContext, setEditedContext] = useState<string | null>(null)
	const [isTranscriptVisible, setIsTranscriptVisible] = useState(false)
	const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copied_md'>('idle')
	const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	// Rich-text inline editor state
	const titleRef = useRef<HTMLHeadingElement>(null)
	const editorRef = useRef<HTMLDivElement>(null)
	const [isEditing, setIsEditing] = useState(false)
	const isEditingRef = useRef(false)        // sync ref for effects/callbacks
	const cancelClickedRef = useRef(false)

	useEffect(() => {
		if (context !== null && editedContext === null) setEditedContext(context)
	}, [context, editedContext])

	useEffect(() => {
		return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current) }
	}, [])

	// Set editor innerHTML and strip the first element's top margin so it aligns with the buttons
	const setEditorHtml = useCallback((md: string) => {
		if (!editorRef.current) return
		editorRef.current.innerHTML = marked.parse(md || '') as string
		const first = editorRef.current.firstElementChild as HTMLElement | null
		if (first) first.style.marginTop = '0'
	}, [])

	// Sync markdown → HTML into the editor div whenever it changes, but never while the user is editing
	useEffect(() => {
		if (!editorRef.current || isEditingRef.current) return
		setEditorHtml(summaryMarkdown || '')
	}, [summaryMarkdown, setEditorHtml])

	// Sync title text into the h1 whenever meetingTitle changes, but never while editing
	useEffect(() => {
		if (!titleRef.current || isEditingRef.current) return
		titleRef.current.innerText = meetingTitle || ''
	}, [meetingTitle])

	const enterEditMode = useCallback((e?: React.MouseEvent) => {
		if (isEditingRef.current) return

		// Capture exact click coordinates before React re-renders (double-click selects a word — we don't want that)
		const clickX = e?.clientX
		const clickY = e?.clientY

		isEditingRef.current = true
		setIsEditing(true)

		setTimeout(() => {
			if (!editorRef.current) return
			editorRef.current.focus({ preventScroll: true })

			// Place cursor at the exact pixel position of the click, not at a word boundary
			const sel = window.getSelection()
			sel?.removeAllRanges()
			if (clickX !== undefined && clickY !== undefined) {
				let range: Range | null = null
				if (document.caretRangeFromPoint) {
					range = document.caretRangeFromPoint(clickX, clickY)
				} else if ((document as any).caretPositionFromPoint) {
					const pos = (document as any).caretPositionFromPoint(clickX, clickY)
					if (pos) {
						range = document.createRange()
						range.setStart(pos.offsetNode, pos.offset)
						range.collapse(true)
					}
				}
				if (range) sel?.addRange(range)
			}
		}, 0)
	}, [])

	const doSave = useCallback(async () => {
		if (!editorRef.current) return
		isEditingRef.current = false
		cancelClickedRef.current = false
		setIsEditing(false)

		const html = editorRef.current.innerHTML
		const md = turndown.turndown(html).trim()
		if (md !== (summaryMarkdown || '').trim()) {
			await handleSummaryUpdate(md)
		}

		const newTitle = titleRef.current?.innerText?.trim() || ''
		if (newTitle && newTitle !== meetingTitle) {
			await handleTitleUpdate(newTitle)
		}
	}, [summaryMarkdown, handleSummaryUpdate, meetingTitle, handleTitleUpdate])

	const doCancel = useCallback(() => {
		if (!editorRef.current) return
		isEditingRef.current = false
		cancelClickedRef.current = false
		setIsEditing(false)
		setEditorHtml(summaryMarkdown || '')
		editorRef.current.blur()
		if (titleRef.current) titleRef.current.innerText = meetingTitle || ''
	}, [summaryMarkdown, setEditorHtml, meetingTitle])

	// Save when focus leaves the entire editable area (title + body)
	const handleContainerBlur = useCallback((e: React.FocusEvent) => {
		if (cancelClickedRef.current) return
		if (e.currentTarget.contains(e.relatedTarget as Node)) return
		doSave()
	}, [doSave])

	const handleContextUpdateConfirm = () => {
		if (editedContext !== context) handleRegenerate({ newContext: editedContext })
	}

	const handleCopy = async (format: 'text' | 'markdown') => {
		if (!meetingTitle || !summaryMarkdown) return
		const formattedDate = formatMeetingDate(meetingStartedAt, meetingTimezone) || ''
		let textToCopy = ''
		if (format === 'markdown') {
			textToCopy = `# ${meetingTitle}\n\n*${formattedDate}*\n\n---\n\n${summaryMarkdown}`
		} else {
			const plain = summaryMarkdown
				.replace(/^---\s*$/gm, '').replace(/#{1,6}\s/g, '')
				.replace(/\*\*(.*?)\*\*/g, '$1').replace(/_(.*?)_/g, '$1')
				.replace(/-\s/g, '• ').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim()
			textToCopy = `${meetingTitle}\n${formattedDate}\n\n${plain}`
		}
		try {
			await navigator.clipboard.writeText(textToCopy)
			setCopyStatus(format === 'markdown' ? 'copied_md' : 'copied')
			if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
			copyTimeoutRef.current = setTimeout(() => setCopyStatus('idle'), 5000)
		} catch {
			alert('Could not copy to clipboard.')
		}
	}

	const handleLanguageChange = async (update: Partial<SummaryLanguageState>) => {
		if (!mid) return
		const newState = { ...languageState, ...update }
		setLanguageState(newState)
		const targetLanguage = newState.mode === 'custom' ? newState.lastCustomLanguage : newState.mode
		try {
			const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}/translate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ target_language: targetLanguage, language_mode: newState.mode }),
			})
			if (!res.ok) throw new Error()
		} catch {
			alert('Could not start translation.')
		}
	}

	const formattedDate = formatMeetingDate(meetingStartedAt, meetingTimezone)
	const contextHasChanged = editedContext !== null && context !== null && editedContext !== context
	const hasSummary = !!summaryMarkdown && !isProcessing
	const displayLoading = isLoading && !loadedFromCache
	const showProcessingMessage = (isProcessing || isRegenerating) && !summaryMarkdown

	const copyButtonStyle: React.CSSProperties = {
		padding: '5px 12px', border: 'none', backgroundColor: 'transparent',
		color: currentThemeColors.text, cursor: 'pointer', fontSize: '13px',
		fontWeight: 500, transition: 'background-color 0.2s ease', fontFamily: 'inherit',
	}

	return (
		<div style={{ maxWidth: 800, margin: '0 auto', padding: '12px 24px 24px', color: currentThemeColors.text }}>
			<ThemeToggle />

			{/* Top nav */}
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
				<button onClick={() => navigate('/record')} style={{
					background: 'none', border: 'none', cursor: 'pointer',
					color: currentThemeColors.secondaryText, fontSize: '13px', fontFamily: 'inherit',
				}}>
					← Back to Recordings
				</button>

				{hasSummary && !isProcessing && (
					<div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
						{copyStatus !== 'idle' && (
							<span style={{ color: currentThemeColors.secondaryText, fontSize: '14px' }}>Copied! ✨</span>
						)}
						<div style={{
							display: 'flex', borderRadius: '6px', overflow: 'hidden',
							border: `1px solid ${currentThemeColors.border}`,
							backgroundColor: currentThemeColors.backgroundSecondary,
						}}>
							<button onClick={() => handleCopy('text')} style={copyButtonStyle}
								onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
								onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
								Copy Text
							</button>
							<div style={{ width: '1px', backgroundColor: currentThemeColors.border }} />
							<button onClick={() => handleCopy('markdown')} style={copyButtonStyle}
								onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
								onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
								Copy Markdown
							</button>
						</div>
					</div>
				)}
			</div>

			{/* Settings card */}
			{(hasSummary || isProcessing) && (
				<div style={{
					backgroundColor: currentThemeColors.background, padding: '10px 12px',
					borderRadius: '12px', border: `1px solid ${currentThemeColors.border}`, marginBottom: '12px',
				}}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
						<div style={{ display: 'flex', flexDirection: 'row', gap: '10px', justifyContent: 'space-between', alignItems: 'center' }}>
							<SummaryLengthSelector value={currentMeetingLength} disabled={isRegenerating || isProcessing} onSelect={(l: SummaryLength) => handleRegenerate({ newLength: l })} />
							<LanguageSelector disabled={isRegenerating || isProcessing} onSelectionChange={handleLanguageChange} />
						</div>
						<div>
							<textarea id="context-editor" value={editedContext ?? ''} onChange={(e) => setEditedContext(e.target.value)}
								placeholder="Context: participant names, project codes, key terms..."
								disabled={isRegenerating || isProcessing}
								style={{
									width: '100%', minHeight: '32px', padding: '5px 8px', borderRadius: '6px',
									border: `1px solid ${currentThemeColors.input.border}`,
									backgroundColor: currentThemeColors.input.background,
									color: currentThemeColors.input.text, fontSize: '13px', fontFamily: 'inherit',
									resize: 'vertical', boxSizing: 'border-box',
									opacity: (isRegenerating || isProcessing) ? 0.7 : 1,
								}}
							/>
							{contextHasChanged && (
								<button onClick={handleContextUpdateConfirm} disabled={isRegenerating || isProcessing}
									style={{
										marginTop: '6px', padding: '5px 12px', border: 'none', borderRadius: '6px',
										backgroundColor: currentThemeColors.button.primary,
										color: currentThemeColors.button.primaryText,
										fontSize: '13px', fontWeight: '500',
										cursor: (isRegenerating || isProcessing) ? 'not-allowed' : 'pointer',
										opacity: (isRegenerating || isProcessing) ? 0.6 : 1, transition: 'all 0.2s ease',
									}}>
									Apply & Regenerate
								</button>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Summary */}
			{displayLoading ? (
				<p>Loading summary...</p>
			) : error ? (
				<p style={{ color: currentThemeColors.button.danger }}>Error: {error}</p>
			) : hasSummary ? (
				<div style={{
					backgroundColor: currentThemeColors.background,
					borderRadius: '12px',
					border: `1px solid ${currentThemeColors.border}`,
					boxShadow: isEditing ? `0 0 0 2px ${currentThemeColors.input.border}` : 'none',
					transition: 'box-shadow 0.15s ease',
				}}>
					{/* Editable area: title + body share onBlur so focus can move between them freely */}
					<div onBlur={handleContainerBlur}>
						{/* Title row */}
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 24px 0 24px' }}>
							<div style={{ flex: 1, marginRight: '12px' }}>
								<h1
									ref={titleRef}
									contentEditable={isEditing}
									suppressContentEditableWarning
									onDoubleClick={!isEditing ? enterEditMode : undefined}
									onKeyDown={(e) => { if (e.key === 'Escape') { cancelClickedRef.current = true; doCancel() } }}
									style={{ fontSize: '1.7em', margin: 0, fontFamily: 'inherit', fontWeight: 600, lineHeight: 1.2, outline: 'none', cursor: isEditing ? 'text' : 'default' }}
								>
									{meetingTitle || (isLoading ? '\u00a0' : `Summary for ${mid}`)}
								</h1>
								{formattedDate && (
									<p style={{ margin: '6px 0 0 0', fontSize: '14px', color: currentThemeColors.secondaryText, fontFamily: 'inherit' }}>
										{formattedDate}
									</p>
								)}
							</div>
							{/* Edit / Save+Cancel */}
							<div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
								{isEditing ? (
									<>
										<button
											onMouseDown={(e) => e.preventDefault()}
											onClick={doSave}
											style={{
												padding: '6px 12px', border: 'none', borderRadius: '6px',
												backgroundColor: currentThemeColors.button.primary,
												color: currentThemeColors.button.primaryText,
												fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
											}}>
											Save
										</button>
										<button
											onMouseDown={() => { cancelClickedRef.current = true }}
											onClick={doCancel}
											style={{
												padding: '6px 12px',
												border: `1px solid ${currentThemeColors.border}`,
												borderRadius: '6px',
												backgroundColor: currentThemeColors.background,
												color: currentThemeColors.text,
												fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
											}}>
											Cancel
										</button>
									</>
								) : (
									<button
										onClick={() => enterEditMode()}
										style={{
											padding: '6px 12px',
											border: `1px solid ${currentThemeColors.border}`,
											borderRadius: '6px',
											backgroundColor: currentThemeColors.backgroundSecondary,
											color: currentThemeColors.secondaryText,
											fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
										}}>
										Edit
									</button>
								)}
							</div>
						</div>

						{/*
					  * The actual editable content.
					  * innerHTML is controlled via ref (not React), so React's reconciliation
					  * never overwrites the user's edits. contentEditable is toggled on double-click.
					  */}
						<div
							ref={editorRef}
							contentEditable={isEditing}
							suppressContentEditableWarning
							onDoubleClick={!isEditing ? (e) => enterEditMode(e) : undefined}
							onKeyDown={(e) => {
								if (e.key === 'Escape') {
									cancelClickedRef.current = true
									doCancel()
								}
							}}
							style={{
								padding: '6px 24px 20px',
								lineHeight: '1.5',
								fontSize: '14px',
								outline: 'none',
								cursor: isEditing ? 'text' : 'default',
								minHeight: '100px',
							}}
							className="markdown-content"
						/>
					</div>
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
				<div style={{
					marginTop: '32px', backgroundColor: currentThemeColors.background,
					padding: '16px 24px', borderRadius: '12px',
					border: `1px solid ${currentThemeColors.border}`,
				}}>
					<h4 onClick={() => setIsTranscriptVisible(!isTranscriptVisible)}
						style={{ cursor: 'pointer', userSelect: 'none', margin: 0, display: 'flex', alignItems: 'center' }}>
						<span style={{
							display: 'inline-block',
							transform: isTranscriptVisible ? 'rotate(90deg)' : 'rotate(0deg)',
							transition: 'transform 0.2s', marginRight: '8px',
						}}>▶</span>{' '}
						🎤 Transcript
					</h4>
					{isTranscriptVisible && (
						<pre style={{ marginTop: '16px', whiteSpace: 'pre-wrap', color: currentThemeColors.text, fontSize: '14px', lineHeight: '1.6' }}>
							{transcript}
						</pre>
					)}
				</div>
			)}
		</div>
	)
}
