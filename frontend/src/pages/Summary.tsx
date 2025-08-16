import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme, AppTheme } from '../styles/theme'
import FeedbackComponent from '../components/FeedbackComponent'
import SummaryLengthSelector from '../components/SummaryLengthSelector'
import LanguageSelector from '../components/LanguageSelector'
import SectionTemplatePicker from '../components/SectionTemplatePicker'
import DraggableSectionList from '../components/DraggableSectionList'
import { useMeetingSummary } from '../hooks/useMeetingSummary'
import { useSections } from '../hooks/useSections'
import { useSummaryLanguage, SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { SummaryLength } from '../contexts/SummaryLengthContext'
import { SectionTemplate } from '../types'

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
		handleTitleUpdate,
		loadedFromCache,
	} = useMeetingSummary({ mid, languageState, setLanguageState })

	const {
		sections,
		isLoading: sectionsLoading,
		error: sectionsError,
		fetchSections,
		createSection,
		updateSection,
		deleteSection,
		reorderSections,
		regenerateSection
	} = useSections({ meetingId: mid, isProcessing })

	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [editedTitle, setEditedTitle] = useState('')
	const [editedContext, setEditedContext] = useState<string | null>(null)
	const [isTranscriptVisible, setIsTranscriptVisible] = useState(false)
	const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copied_md'>('idle')
	const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false)
	const [addSectionPosition, setAddSectionPosition] = useState<number>(0)
	const [pickerPosition, setPickerPosition] = useState<{x: number, y: number} | null>(null)

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

	const fullSummaryText = useMemo(() => {
		if (!sections || sections.length === 0) return '';
		return sections
			.map(s => `### ${s.title}\n\n${s.content || ''}`)
			.join('\n\n---\n\n');
	}, [sections]);

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

	const handleAddSection = useCallback((position: number, event?: React.MouseEvent) => {
		setAddSectionPosition(position)
		if (event) {
			const rect = event.currentTarget.getBoundingClientRect()
			setPickerPosition({
				x: rect.right + 8,
				y: rect.top
			})
		}
		setIsTemplatePickerOpen(true)
	}, [])

	const handleAddSectionAbove = useCallback((position: number, event?: React.MouseEvent) => {
		handleAddSection(position, event)
	}, [handleAddSection])

	const handleAddSectionBelow = useCallback((position: number, event?: React.MouseEvent) => {
		handleAddSection(position + 1, event)
	}, [handleAddSection])

	const handleTemplateSelect = useCallback(async (template: SectionTemplate) => {
		// Preserve scroll position
		const scrollPosition = window.scrollY
		
		try {
			await createSection(template, addSectionPosition)
			
			// Restore scroll position after a brief delay to allow re-render
			setTimeout(() => {
				window.scrollTo(0, scrollPosition)
			}, 0)
		} catch (error) {
			console.error('Error adding section:', error)
		}
	}, [createSection, addSectionPosition])

	const handleUpdateTitle = useCallback(async (sectionId: number, title: string) => {
		try {
			await updateSection(sectionId, { title })
		} catch (error) {
			console.error('Error updating title:', error)
		}
	}, [updateSection])

	const handleUpdateContent = useCallback(async (sectionId: number, content: string) => {
		try {
			await updateSection(sectionId, { content })
		} catch (error) {
			console.error('Error updating content:', error)
		}
	}, [updateSection])

	const handleDeleteSection = useCallback(async (sectionId: number) => {
		if (!confirm('Are you sure you want to delete this section?')) return
		
		try {
			await deleteSection(sectionId)
		} catch (error) {
			console.error('Error deleting section:', error)
		}
	}, [deleteSection])

	const handleRegenerateSection = useCallback(async (sectionId: number) => {
		try {
			await regenerateSection(sectionId)
		} catch (error) {
			console.error('Error regenerating section:', error)
		}
	}, [regenerateSection])


	const handleCopy = async (format: 'text' | 'markdown') => {
		if (!meetingTitle || !fullSummaryText) return

		const formattedDate = formatMeetingDate(meetingStartedAt, meetingTimezone) || ''
		let textToCopy = ''

		if (format === 'markdown') {
			textToCopy = `# ${meetingTitle}\n\n*${formattedDate}*\n\n---\n\n${fullSummaryText}`
		} else {
			const plainSummary = fullSummaryText
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
			// Fetch sections once to get the `is_generating` flags, which will trigger polling in useSections
			fetchSections()
		} catch (err) {
			console.error('Translation error:', err)
			alert('Could not start translation.')
		}
	}

	const handleLengthChangeWithWarning = (newLength: SummaryLength) => {
		const hasCustomizations = sections && sections.length > 0
		if (hasCustomizations) {
			if (
				!window.confirm(
					'Changing the summary length will discard all current sections, including custom content and edits, and generate a new summary from the original transcript. Are you sure?'
				)
			) {
				return // Abort if user cancels
			}
		}
		handleRegenerate({ newLength })
	}

	const formattedDate = formatMeetingDate(meetingStartedAt, meetingTimezone)
	const contextHasChanged = editedContext !== null && context !== null && editedContext !== context
	const hasSections = !sectionsLoading && sections.length > 0
	const showControls = hasSections && !isProcessing && !sectionsLoading
	
	const displayLoading = (isLoading && !loadedFromCache) || sectionsLoading;
    const displayError = error || sectionsError;
    const showProcessingMessage = (isProcessing || isRegenerating) && !hasSections;

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

				{hasSections && !isProcessing && (
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

				{(hasSections || isProcessing) && (
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
			) : hasSections ? (
				<DraggableSectionList
					sections={sections}
					onReorder={reorderSections}
					onUpdateTitle={handleUpdateTitle}
					onUpdateContent={handleUpdateContent}
					onDeleteSection={handleDeleteSection}
					onRegenerateSection={handleRegenerateSection}
					onAddSectionAbove={handleAddSectionAbove}
					onAddSectionBelow={handleAddSectionBelow}
					showControls={showControls}
					enableDragAndDrop={true}
				/>
			) : showProcessingMessage ? (
                <p>⏳ Processing summary, please wait...</p>
            ) : (
				<p>No summary is available for this meeting.</p>
			)}

			{hasSections && !isLoading && (
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

			<SectionTemplatePicker
				isOpen={isTemplatePickerOpen}
				onClose={() => {
					setIsTemplatePickerOpen(false)
					setPickerPosition(null)
				}}
				onSelectTemplate={handleTemplateSelect}
				meetingId={mid}
				position={pickerPosition}
			/>
		</div>
	)
}