import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme } from '../styles/theme'
import FeedbackComponent from '../components/FeedbackComponent'
import SectionTemplatePicker from '../components/SectionTemplatePicker'
import DraggableSectionList from '../components/DraggableSectionList'
import CopyControls from '../components/CopyControls'
import MeetingTitleCard from '../components/MeetingTitleCard'
import MeetingControls from '../components/MeetingControls'
import TranscriptViewer from '../components/TranscriptViewer'
import { useMeetingSummary } from '../hooks/useMeetingSummary'
import { useSections } from '../hooks/useSections'
import { useSummaryLanguage, SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { SummaryLength } from '../contexts/SummaryLengthContext'
import { SectionTemplate } from '../types'
import { formatMeetingDate } from '../utils/dateFormatting'
import { generateFullSummaryText } from '../utils/textProcessing'
import { createSummaryStyles } from '../styles/summaryStyles'


export default function Summary() {
	const { mid } = useParams<{ mid: string }>()
	const navigate = useNavigate()
	const { theme } = useTheme()
	const currentTheme = theme === 'light' ? lightTheme : darkTheme
	const styles = createSummaryStyles(currentTheme)
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

	const [editedContext, setEditedContext] = useState<string | null>(null)
	const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false)
	const [addSectionPosition, setAddSectionPosition] = useState<number>(0)
	const [pickerPosition, setPickerPosition] = useState<{x: number, y: number} | null>(null)

	useEffect(() => {
		if (context !== null && editedContext === null) {
			setEditedContext(context)
		}
	}, [context, editedContext])


	const fullSummaryText = useMemo(() => generateFullSummaryText(sections), [sections]);



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
	const displayLoading = (isLoading && !loadedFromCache) || sectionsLoading
	const displayError = error || sectionsError
	const showProcessingMessage = (isProcessing || isRegenerating) && !hasSections


	return (
		<div style={styles.container}>
			<ThemeToggle />

			<div style={styles.header}>
				<button
					onClick={() => navigate('/record')}
					style={styles.backButton}>
					← Back to Recordings
				</button>

				{hasSections && !isProcessing && (
					<CopyControls
						meetingTitle={meetingTitle || ''}
						fullSummaryText={fullSummaryText}
						formattedDate={formattedDate || ''}
						theme={currentTheme}
					/>
				)}
			</div>

			<MeetingTitleCard
				meetingTitle={meetingTitle}
				formattedDate={formattedDate}
				mid={mid}
				isLoading={isLoading}
				theme={currentTheme}
				onTitleUpdate={handleTitleUpdate}
			/>

			{(hasSections || isProcessing) && (
				<MeetingControls
					currentMeetingLength={currentMeetingLength}
					editedContext={editedContext}
					contextHasChanged={contextHasChanged}
					isRegenerating={isRegenerating}
					isProcessing={isProcessing}
					theme={currentTheme}
					onLengthChange={handleLengthChangeWithWarning}
					onLanguageChange={handleLanguageChange}
					onContextChange={setEditedContext}
					onContextUpdate={handleContextUpdateConfirm}
				/>
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
				<TranscriptViewer
					transcript={transcript}
					theme={currentTheme}
				/>
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