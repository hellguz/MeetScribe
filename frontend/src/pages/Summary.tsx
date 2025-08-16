import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
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
import { SectionTemplate } from '../types'

/**
 * Formats an ISO date string into a readable format, optionally for a specific timezone.
 * @param {string} isoString - The ISO date string to format.
 * @param {string | null} timeZone - The IANA timezone string.
 * @returns {string | null} The formatted date string or null on error.
 */
const formatMeetingDate = (isoString?: string, timeZone?: string | null): string | null => {
	if (!isoString) return null

	try {
		const date = new Date(isoString)

		// Round minutes
		const minutes = date.getMinutes()
		const roundedMinutes = Math.round(minutes)
		date.setMinutes(roundedMinutes, 0, 0) // Also reset seconds and milliseconds

		const options: Intl.DateTimeFormatOptions = {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: timeZone || undefined, // Use system default if null/undefined
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
		summary,
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

	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [editedTitle, setEditedTitle] = useState('')
	const [editedContext, setEditedContext] = useState('')
	const [isTranscriptVisible, setIsTranscriptVisible] = useState(false)
	const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copied_md'>('idle')
	const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false)
	const [addSectionPosition, setAddSectionPosition] = useState<number>(0)
	const [showSectionsWarning, setShowSectionsWarning] = useState(false)
	const [pickerPosition, setPickerPosition] = useState<{x: number, y: number} | null>(null)

	const {
		sections,
		isLoading: sectionsLoading,
		error: sectionsError,
		createSection,
		updateSection,
		deleteSection,
		reorderSections,
		regenerateSection
	} = useSections({ meetingId: mid })

	useEffect(() => {
		if (context !== null) {
			setEditedContext(context)
		}
	}, [context])

	useEffect(() => {
		// Clear timeout on component unmount
		return () => {
			if (copyTimeoutRef.current) {
				clearTimeout(copyTimeoutRef.current)
			}
		}
	}, [])

	const handleTitleUpdateConfirm = useCallback(async () => {
		if (editedTitle.trim() && editedTitle.trim() !== meetingTitle) {
			await handleTitleUpdate(editedTitle.trim())
		}
		setIsEditingTitle(false)
	}, [editedTitle, meetingTitle, handleTitleUpdate])

	// Check if we have custom sections when regenerating
	useEffect(() => {
		const hasCustomSections = sections.some(s => s.section_type !== 'default_summary')
		setShowSectionsWarning(hasCustomSections)
	}, [sections])

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
		try {
			await createSection(template, addSectionPosition)
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

	const handleResetToDefaultSummary = useCallback(async () => {
		if (!confirm('Reset to default summary? This will delete all custom sections and regenerate the original summary.')) return
		
		try {
			// Delete all sections to return to default summary mode
			for (const section of sections) {
				await deleteSection(section.id)
			}
			// Trigger summary regeneration
			handleRegenerate({})
		} catch (error) {
			console.error('Error resetting to default:', error)
		}
	}, [sections, deleteSection, handleRegenerate])

	/**
	 * Copies the meeting summary to the clipboard in the specified format.
	 * @param {'text' | 'markdown'} format - The desired format for the clipboard content.
	 */
	const handleCopy = async (format: 'text' | 'markdown') => {
		if (!meetingTitle || !summary) return

		const formattedDate = formatMeetingDate(meetingStartedAt, meetingTimezone) || ''
		let textToCopy = ''

		if (format === 'markdown') {
			textToCopy = `# ${meetingTitle}\n\n*${formattedDate}*\n\n---\n\n${summary}`
		} else {
			const plainSummary = summary
				.replace(/^---\s*$/gm, '') // Remove horizontal rules
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

	const onLanguageChange = (update: Partial<SummaryLanguageState>) => {
		const newState = { ...languageState, ...update }
		setLanguageState(newState)
		handleRegenerate({ newLanguageState: newState })
	}

	const formattedDate = formatMeetingDate(meetingStartedAt, meetingTimezone)
	const contextHasChanged = editedContext !== context && context !== null && editedContext !== null
	const showControls = summary && !isProcessing
	const useSectionsView = sections.length > 0
	const hasSections = !sectionsLoading && sections.length > 0

	const copyButtonStyle: React.CSSProperties = {
		padding: '8px 16px',
		border: 'none',
		backgroundColor: 'transparent',
		color: currentThemeColors.text,
		cursor: 'pointer',
		fontSize: '14px',
		fontWeight: 500,
		transition: 'background-color 0.2s ease',
		fontFamily: 'Jost, serif',
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
						fontFamily: 'Jost, serif',
					}}>
					← Back to Recordings
				</button>

				{summary && !isProcessing && (
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
						
						{/* Reset button - only show if we have custom sections */}
						{hasSections && (
							<button
								onClick={handleResetToDefaultSummary}
								style={{
									padding: '8px 12px',
									border: `1px solid ${currentThemeColors.border}`,
									borderRadius: '6px',
									backgroundColor: currentThemeColors.backgroundSecondary,
									color: currentThemeColors.secondaryText,
									cursor: 'pointer',
									fontSize: '14px',
									fontWeight: 500,
									transition: 'all 0.2s ease',
									fontFamily: 'Jost, serif',
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.backgroundColor = currentThemeColors.background
									e.currentTarget.style.borderColor = currentThemeColors.button.primary
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.backgroundColor = currentThemeColors.backgroundSecondary
									e.currentTarget.style.borderColor = currentThemeColors.border
								}}
								title="Reset to default summary"
							>
								Reset
							</button>
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
							fontFamily: "'Jost', serif",
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
							fontFamily: "'Jost', serif",
							fontWeight: 600,
							lineHeight: 1.2,
						}}>
						{meetingTitle || (isLoading ? ' ' : `Summary for ${mid}`)}
					</h1>
				)}

				{formattedDate && (
					<p style={{ margin: '8px 0 0 0', fontSize: '14px', color: currentThemeColors.secondaryText, fontFamily: "'Jost', serif" }}>{formattedDate}</p>
				)}

				{showControls && (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
						<div
							style={{
								display: 'flex',
								flexDirection: 'row',
								gap: '10px',
								justifyContent: 'space-between',
								alignItems: 'center',
							}}>
							<SummaryLengthSelector value={currentMeetingLength} disabled={isRegenerating} onSelect={(len) => handleRegenerate({ newLength: len })} />
							<LanguageSelector disabled={isRegenerating} onSelectionChange={onLanguageChange} />
						</div>

						<div>
							<label htmlFor="context-editor" style={{ display: 'block', fontWeight: 500, marginBottom: '8px', fontSize: '14px' }}>
								Context
							</label>
							<textarea
								id="context-editor"
								value={editedContext}
								onChange={(e) => setEditedContext(e.target.value)}
								placeholder="Add participant names, project codes, or key terms here to improve summary accuracy. Changes will trigger a regeneration."
								disabled={isRegenerating}
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
									opacity: isRegenerating ? 0.7 : 1,
								}}
							/>
							{contextHasChanged && (
								<button
									onClick={handleContextUpdateConfirm}
									disabled={isRegenerating}
									style={{
										marginTop: '12px',
										padding: '8px 16px',
										border: 'none',
										borderRadius: '8px',
										backgroundColor: currentThemeColors.button.primary,
										color: currentThemeColors.button.primaryText,
										fontSize: '14px',
										fontWeight: '500',
										cursor: isRegenerating ? 'not-allowed' : 'pointer',
										opacity: isRegenerating ? 0.6 : 1,
										transition: 'all 0.2s ease',
									}}>
									Apply & Regenerate Summary
								</button>
							)}
						</div>
						
						{showSectionsWarning && hasSections && (
							<div style={{
								marginTop: '16px',
								padding: '12px',
								backgroundColor: 'rgba(255, 165, 0, 0.1)',
								border: '1px solid rgba(255, 165, 0, 0.3)',
								borderRadius: '8px',
								fontSize: '14px',
								color: currentThemeColors.text,
							}}>
								⚠️ You have custom sections. Regenerating the summary will preserve your custom sections but may affect the default summary content.
							</div>
						)}
					</div>
				)}
			</div>

			{/* Sections View or Traditional Summary */}
			{hasSections ? (
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
			) : summary ? (
				<div style={{ position: 'relative' }}>
					{/* Add section button for traditional summary */}
					{showControls && (
						<div style={{
							position: 'absolute',
							left: '-40px',
							top: '0',
							opacity: 0.7,
							transition: 'opacity 0.2s ease'
						}}
						onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
						onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}>
							<button
								onClick={(e) => handleAddSection(0, e)}
								style={{
									width: '32px',
									height: '32px',
									border: `1px solid ${currentThemeColors.border}`,
									borderRadius: '4px',
									backgroundColor: currentThemeColors.background,
									color: currentThemeColors.secondaryText,
									fontSize: '14px',
									cursor: 'pointer',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									transition: 'all 0.2s ease',
									boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.backgroundColor = currentThemeColors.backgroundSecondary
									e.currentTarget.style.borderColor = currentThemeColors.button.primary
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.backgroundColor = currentThemeColors.background
									e.currentTarget.style.borderColor = currentThemeColors.border
								}}
								title="Add section"
							>
								+
							</button>
						</div>
					)}
					<ReactMarkdown
						children={summary}
						components={{
							h1: ({ ...props }) => <h1 style={{ color: currentThemeColors.text }} {...props} />,
							h2: ({ ...props }) => <h2 style={{ color: currentThemeColors.text }} {...props} />,
							p: ({ ...props }) => <p style={{ lineHeight: 1.6 }} {...props} />,
						}}
					/>
				</div>
			) : (
				<>
					{isLoading && !loadedFromCache && <p>Loading summary...</p>}
					{error && <p style={{ color: currentThemeColors.button.danger }}>Error: {error}</p>}
					{sectionsError && <p style={{ color: currentThemeColors.button.danger }}>Sections Error: {sectionsError}</p>}
					{(isProcessing || isRegenerating) && <p>⏳ Processing summary, please wait...</p>}
				</>
			)}

			{summary && !isLoading && (
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

			{/* Section Template Picker Modal */}
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
