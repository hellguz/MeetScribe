import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { marked } from 'marked'
import { apiUrl } from '../utils/api'
import TurndownService from 'turndown'
import ThemeToggle from '../components/ThemeToggle'
import Spinner from '../components/Spinner'
import { stageText } from '../utils/processingStage'
import { formatMeetingDateTime } from '../utils/datetime'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme, AppTheme } from '../styles/theme'
import FeedbackComponent from '../components/FeedbackComponent'
import { CopyTextIcon, CopyMarkdownIcon, EditIcon, TrashIcon, SpeakersIcon, CloseIcon } from '../components/Icons'
import { removeMeeting } from '../utils/history'
import FavoriteButton from '../components/FavoriteButton'
import TagsManager from '../components/TagsManager'
import { isFavorite as checkFavorite, toggleFavorite, getMeetingTagIds, toggleMeetingTag } from '../utils/tags'
import SummaryLengthSelector from '../components/SummaryLengthSelector'
import LanguageSelector from '../components/LanguageSelector'
import { useMeetingSummary } from '../hooks/useMeetingSummary'
import OnDeviceStats from '../components/OnDeviceStats'
import LocalSummaryPanel from '../components/LocalSummaryPanel'
import { SummaryVersionTabs, SummaryComparison, MarkdownView, type SummaryView } from '../components/SummaryVersions'
import { useLocalSummary } from '../ondevice/summary/useLocalSummary'
import { useLocalSummaryPrefs } from '../ondevice/summary/pref'
import { useSummaryLanguage, SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { SummaryLength } from '../contexts/SummaryLengthContext'

marked.setOptions({ breaks: false })

const turndown = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-' })
// Strip span tags (browsers add them while editing) but keep their text content
turndown.addRule('spans', { filter: 'span', replacement: (content) => content })

export default function Summary() {
	const { mid } = useParams<{ mid: string }>()
	const navigate = useNavigate()
	const { theme } = useTheme()
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme
	const isDark = theme !== 'light'
	const { languageState, setLanguageState } = useSummaryLanguage()

	const {
		transcript,
		summaryMarkdown,
		isLoading,
		isProcessing,
		error,
		meetingTitle,
		meetingStartedAt,
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
	} = useMeetingSummary({ mid, languageState, setLanguageState })

	// Experimental: the same transcript summarised in this browser, kept
	// next to the Claude summary rather than replacing it.
	const { enabled: localSummaryEnabled } = useLocalSummaryPrefs()
	const localSummary = useLocalSummary(mid)
	const [view, setView] = useState<SummaryView>('cloud')
	// Which run the side-by-side view puts opposite Claude. Tracked apart
	// from `view` so switching to compare and back keeps the same run.
	const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
	const [editedContext, setEditedContext] = useState<string | null>(null)
	const [isTranscriptVisible, setIsTranscriptVisible] = useState(false)
	const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copied_md'>('idle')
	const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const [transcriptCopied, setTranscriptCopied] = useState(false)
	// Component state only: dismissing hides the hint for this visit and it
	// reappears next time the meeting is opened, as requested.
	const [speakerHintDismissed, setSpeakerHintDismissed] = useState(false)
	const transcriptCopyTimerRef = useRef<NodeJS.Timeout | null>(null)
	const [, setFavTagTick] = useState(0)
	const refreshFavTags = useCallback(() => setFavTagTick((t) => t + 1), [])

	// Rich-text inline editor state
	const titleRef = useRef<HTMLHeadingElement>(null)
	const editorRef = useRef<HTMLDivElement>(null)
	const [isEditing, setIsEditing] = useState(false)
	const isEditingRef = useRef(false) // sync ref for effects/callbacks
	const cancelClickedRef = useRef(false)

	useEffect(() => {
		if (context !== null && editedContext === null) setEditedContext(context)
	}, [context, editedContext])

	useEffect(() => {
		return () => {
			if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
		}
	}, [])

	// Set editor innerHTML and strip the first element's top margin so it aligns with the buttons
	const setEditorHtml = useCallback((md: string) => {
		if (!editorRef.current) return
		editorRef.current.innerHTML = marked.parse(md || '') as string
		const first = editorRef.current.firstElementChild as HTMLElement | null
		if (first) first.style.marginTop = '0'
	}, [])

	// Sync markdown → HTML into the editor div whenever it changes, but never while the user is editing.
	// `view` is a dependency because the editor is unmounted while an on-device
	// version is on screen: coming back to the Claude tab remounts an empty div,
	// and without a re-run the summary would simply not be there.
	useEffect(() => {
		if (!editorRef.current || isEditingRef.current) return
		setEditorHtml(summaryMarkdown || '')
	}, [summaryMarkdown, setEditorHtml, view])

	// Sync title text into the h1 whenever meetingTitle changes, but never while editing
	useEffect(() => {
		if (!titleRef.current || isEditingRef.current) return
		titleRef.current.innerText = meetingTitle || ''
	}, [meetingTitle, view])

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
				} else if ('caretPositionFromPoint' in document) {
					// Firefox-only API not yet in TypeScript's DOM types
					type DocWithCaret = Document & { caretPositionFromPoint(x: number, y: number): { offsetNode: Node; offset: number } | null }
					const pos = (document as DocWithCaret).caretPositionFromPoint(clickX, clickY)
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
	const handleContainerBlur = useCallback(
		(e: React.FocusEvent) => {
			if (cancelClickedRef.current) return
			if (e.currentTarget.contains(e.relatedTarget as Node)) return
			doSave()
		},
		[doSave],
	)

	const handleContextUpdateConfirm = () => {
		if (editedContext !== context) handleRegenerate({ newContext: editedContext })
	}

	const handleCopy = async (format: 'text' | 'markdown') => {
		if (!meetingTitle || !summaryMarkdown) return
		const formattedDate = formatMeetingDateTime(meetingStartedAt) || ''
		let textToCopy = ''
		if (format === 'markdown') {
			textToCopy = `# ${meetingTitle}\n\n*${formattedDate}*\n\n---\n\n${summaryMarkdown}`
		} else {
			const plain = summaryMarkdown
				.replace(/^---\s*$/gm, '')
				.replace(/#{1,6}\s/g, '')
				.replace(/\*\*(.*?)\*\*/g, '$1')
				.replace(/_(.*?)_/g, '$1')
				.replace(/-\s/g, '• ')
				.replace(/\[(.*?)\]\(.*?\)/g, '$1')
				.trim()
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
		await handleTranslate(targetLanguage, newState.mode)
	}

	const handleDelete = async () => {
		if (!mid) return
		if (!window.confirm('Are you sure you want to permanently delete this meeting and its summary? This cannot be undone.')) return
		removeMeeting(mid)
		try {
			await fetch(apiUrl(`/api/meetings/${mid}`), { method: 'DELETE' })
		} catch {
			// best-effort server delete
		}
		navigate('/record')
	}

	const formattedDate = formatMeetingDateTime(meetingStartedAt)
	const contextHasChanged = editedContext !== null && context !== null && editedContext !== context
	const hasSummary = !!summaryMarkdown
	const displayLoading = isLoading && !loadedFromCache
	// `isRegenerating` only covers the request itself; the work continues while
	// `isProcessing` polls, so the indicator has to key off both.
	const busy = isProcessing || isRegenerating
	// Regenerating with a summary already on screen used to show nothing at all,
	// so changing the language looked like a no-op. Announce it over the stale text.
	const showRegeneratingBanner = busy && !!summaryMarkdown
	const showProcessingMessage = busy && !summaryMarkdown
	// Whether this meeting already carries speaker labels.
	const isDiarized = /^Speaker \d+:/m.test(transcript || '')
	// Offer the re-run only for meetings that predate the feature. Inferring
	// this from "the transcript has no Speaker labels" was wrong: a silent
	// recording has an empty transcript and no labels either, so brand-new
	// meetings were being offered a pointless re-run.
	const offerSpeakerHint = canRediarize && !diarizationAttempted && !isDiarized
	// Names the stage and its position, e.g. "Step 2 of 3 · Identifying speakers".
	const stageLabel = stageText(processingStage, processingTotal, 'Processing summary')

	// The run the non-cloud views show: the explicit pick, else the newest.
	const localRuns = localSummary.runs
	const activeRun = localRuns.find((r) => r.id === selectedRunId) ?? localRuns[localRuns.length - 1] ?? null
	// A finished run is only interesting next to the cloud one, so land the
	// user in the side-by-side view rather than making them find it.
	//
	// Once per run, tracked by id: the phase stays 'done' afterwards and the
	// run list changes again whenever a verdict is saved, so a plain
	// dependency check would keep dragging the view back to compare while
	// the user was reading a single version.
	const autoComparedRunRef = useRef<number | null>(null)
	useEffect(() => {
		if (localSummary.state.phase !== 'done' || localRuns.length === 0) return
		const newest = localRuns[localRuns.length - 1]
		if (autoComparedRunRef.current === newest.id) return
		autoComparedRunRef.current = newest.id
		setSelectedRunId(newest.id)
		setView('compare')
	}, [localSummary.state.phase, localRuns])
	// Deleting the last run, or opening a meeting that has none, must not
	// leave the page stuck on a version that no longer exists.
	useEffect(() => {
		if (localRuns.length === 0 && view !== 'cloud') setView('cloud')
	}, [localRuns.length, view])

	const selectView = useCallback((next: SummaryView) => {
		if (typeof next === 'number') setSelectedRunId(next)
		setView(next)
	}, [])

	const handleVerdict = useCallback(
		async (verdict: string | null, note: string | null) => {
			if (activeRun) await localSummary.setVerdict(activeRun.id, verdict, note)
		},
		[activeRun, localSummary],
	)

	// The panel only makes sense once there is a transcript to summarise.
	const showLocalPanel = localSummaryEnabled && !!transcript && !busy
	// Streaming output has nowhere to live until the run is saved, so it gets
	// its own card while it arrives.
	const showStreaming = localSummary.state.streaming.length > 0 && localSummary.state.phase !== 'done'

	const copyButtonStyle: React.CSSProperties = {
		padding: '7px 9px',
		border: 'none',
		backgroundColor: 'transparent',
		color: currentThemeColors.secondaryText,
		cursor: 'pointer',
		lineHeight: 1,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		transition: 'background-color 0.2s ease',
	}

	// 800px is a comfortable reading column for one summary, but two of them
	// side by side do not fit in it — the comparison grid would silently
	// collapse back to a single column, making that view indistinguishable
	// from the single-run one. So the page widens for that view alone, and
	// only as far as the viewport allows.
	return (
		<div
			className="page-container"
			style={{
				maxWidth: view === 'compare' ? 1400 : 800,
				margin: '0 auto',
				padding: '12px 24px 24px',
				color: currentThemeColors.text,
				transition: 'max-width 0.2s ease',
			}}>
			{/* Top nav */}
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
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
					← Back
				</button>
				<div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
					{/* Copy, edit, delete, tags and favourites all act on the real
					    summary, so they only belong on the Claude tab — offering
					    "edit" while an on-device run is on screen would imply the
					    run is editable, and "copy" would quietly copy the other one. */}
					{hasSummary && !isProcessing && view === 'cloud' && (
						<>
							{copyStatus !== 'idle' && <span style={{ color: currentThemeColors.secondaryText, fontSize: '13px', opacity: 0.7 }}>Copied!</span>}
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
									title="Copy as plain text"
									onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
									onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
									<CopyTextIcon />
								</button>
								<div style={{ width: '1px', backgroundColor: currentThemeColors.border }} />
								<button
									onClick={() => handleCopy('markdown')}
									style={copyButtonStyle}
									title="Copy as Markdown"
									onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
									onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
									<CopyMarkdownIcon />
								</button>
							</div>
							<div
								style={{
									display: 'flex',
									borderRadius: '6px',
									overflow: 'hidden',
									border: `1px solid ${currentThemeColors.border}`,
									backgroundColor: currentThemeColors.backgroundSecondary,
								}}>
								<button
									onClick={() => enterEditMode()}
									title="Edit summary"
									style={copyButtonStyle}
									onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
									onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
									<EditIcon />
								</button>
								<div style={{ width: '1px', backgroundColor: currentThemeColors.border }} />
								<button
									onClick={handleDelete}
									title="Delete meeting"
									style={copyButtonStyle}
									onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
									onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
									<TrashIcon />
								</button>
							</div>
							{mid && (
								<>
									<TagsManager
										selectedTagIds={getMeetingTagIds(mid)}
										onToggleTag={(tagId) => {
											toggleMeetingTag(mid, tagId)
											refreshFavTags()
										}}
										onTagsChanged={refreshFavTags}
										theme={currentThemeColors}
									/>
									<FavoriteButton
										isFavorite={checkFavorite(mid)}
										onToggle={() => {
											toggleFavorite(mid)
											refreshFavTags()
										}}
										theme={currentThemeColors}
									/>
								</>
							)}
						</>
					)}
					<ThemeToggle />
				</div>
			</div>

			{/* Settings card */}
			{(hasSummary || isProcessing) && (
				<div
					style={{
						padding: '10px 12px',
						borderRadius: '12px',
						border: `1px solid ${currentThemeColors.border}`,
						marginBottom: '12px',
					}}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
						<div style={{ display: 'flex', flexDirection: 'row', gap: '10px', justifyContent: 'space-between', alignItems: 'center' }}>
							<SummaryLengthSelector
								value={currentMeetingLength}
								disabled={isRegenerating || isProcessing}
								onSelect={(l: SummaryLength) => handleRegenerate({ newLength: l })}
							/>
							<LanguageSelector disabled={isRegenerating || isProcessing} onSelectionChange={handleLanguageChange} />
						</div>
						<div>
							<textarea
								id="context-editor"
								value={editedContext ?? ''}
								onChange={(e) => setEditedContext(e.target.value)}
								placeholder="Context: participant names, project codes, key terms..."
								disabled={isRegenerating || isProcessing}
								style={{
									width: '100%',
									minHeight: '36px',
									padding: '7px 10px',
									borderRadius: '6px',
									border: `1px solid ${currentThemeColors.input.border}`,
									backgroundColor: currentThemeColors.input.background,
									color: currentThemeColors.input.text,
									fontSize: '15px',
									fontFamily: 'inherit',
									resize: 'vertical',
									boxSizing: 'border-box',
									opacity: isRegenerating || isProcessing ? 0.7 : 1,
								}}
							/>
							{contextHasChanged && (
								<button
									onClick={handleContextUpdateConfirm}
									disabled={isRegenerating || isProcessing}
									style={{
										marginTop: '6px',
										padding: '8px 14px',
										border: 'none',
										borderRadius: '6px',
										backgroundColor: currentThemeColors.button.primary,
										color: currentThemeColors.button.primaryText,
										fontSize: '15px',
										fontWeight: '500',
										cursor: isRegenerating || isProcessing ? 'not-allowed' : 'pointer',
										opacity: isRegenerating || isProcessing ? 0.6 : 1,
										transition: 'all 0.2s ease',
									}}>
									Apply & Regenerate
								</button>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Offer diarization only where it can actually run: audio still on
			    disk, and no speaker labels yet (i.e. recorded before the feature). */}
			{offerSpeakerHint && !speakerHintDismissed && !busy && (
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '12px',
						margin: '0 0 12px',
						padding: '10px 12px',
						borderRadius: '10px',
						backgroundColor: isDark ? 'rgba(245, 158, 11, 0.10)' : '#fffbeb',
						border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.35)' : '#fde68a'}`,
						color: currentThemeColors.text,
						fontSize: '13px',
						lineHeight: 1.45,
					}}>
					<span aria-hidden style={{ display: 'flex', color: '#f59e0b', flexShrink: 0 }}>
						<SpeakersIcon size={18} />
					</span>
					<span style={{ flex: 1, minWidth: 0 }}>
						<strong>New:</strong> MeetScribe can now tell speakers apart. Re-run this older
						recording to label who said what — summaries then attribute decisions and action
						items to the right person.
					</span>
					<button
						onClick={handleRediarize}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '5px',
							padding: '5px 10px',
							border: 'none',
							borderRadius: '6px',
							// Amber, matching the banner rather than the app's green primary.
							backgroundColor: '#f59e0b',
							color: '#ffffff',
							fontSize: '13px',
							fontWeight: '500',
							fontFamily: 'inherit',
							cursor: 'pointer',
							whiteSpace: 'nowrap',
							transition: 'all 0.2s ease',
						}}>
						<SpeakersIcon size={13} />
						Find speakers
					</button>
					<button
						onClick={() => setSpeakerHintDismissed(true)}
						aria-label="Dismiss"
						title="Dismiss"
						style={{
							display: 'flex',
							alignItems: 'center',
							padding: '4px',
							border: 'none',
							backgroundColor: 'transparent',
							color: currentThemeColors.secondaryText,
							lineHeight: 1,
							cursor: 'pointer',
							fontFamily: 'inherit',
						}}>
						<CloseIcon size={15} />
					</button>
				</div>
			)}

			{showRegeneratingBanner && (
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
						margin: '0 0 10px',
						padding: '8px 12px',
						borderRadius: '8px',
						backgroundColor: currentThemeColors.backgroundSecondary,
						border: `1px solid ${currentThemeColors.border}`,
						color: currentThemeColors.secondaryText,
						fontSize: '14px',
					}}>
					<Spinner label={stageLabel} />
					{stageLabel}
				</div>
			)}

			{showLocalPanel && (
				<LocalSummaryPanel
					theme={currentThemeColors}
					state={localSummary.state}
					busy={localSummary.busy}
					webgpuAvailable={localSummary.webgpuAvailable}
					summaryLength={currentMeetingLength}
					onGenerate={() => localSummary.generate(currentMeetingLength)}
					onCancel={localSummary.cancel}
					runs={localRuns}
				/>
			)}

			{showStreaming && (
				<div
					style={{
						marginBottom: '12px',
						padding: '16px 20px',
						borderRadius: '12px',
						border: `1px dashed ${currentThemeColors.border}`,
						backgroundColor: currentThemeColors.background,
					}}>
					<div style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: currentThemeColors.secondaryText, letterSpacing: '0.04em' }}>
						🧠 WRITING ON THIS DEVICE…
					</div>
					<MarkdownView markdown={localSummary.state.streaming} theme={currentThemeColors} />
				</div>
			)}

			{localRuns.length > 0 && hasSummary && (
				<SummaryVersionTabs theme={currentThemeColors} runs={localRuns} view={view} onSelect={selectView} />
			)}

			{/* Summary */}
			{displayLoading ? (
				<p style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<Spinner label="Loading summary" />
					Loading summary…
				</p>
			) : error ? (
				<p style={{ color: currentThemeColors.button.danger }}>Error: {error}</p>
			) : hasSummary && view !== 'cloud' && activeRun ? (
				/* Read-only on purpose: an on-device run is evidence, not the
				   meeting's summary, and editing it would imply otherwise. */
				<SummaryComparison
					theme={currentThemeColors}
					cloudMarkdown={summaryMarkdown || ''}
					run={activeRun}
					compare={view === 'compare'}
					onVerdict={handleVerdict}
				/>
			) : hasSummary ? (
				<div
					style={{
						backgroundColor: currentThemeColors.background,
						borderRadius: '12px',
						border: `1px solid ${currentThemeColors.border}`,
						boxShadow: isEditing ? `0 0 0 2px ${currentThemeColors.input.border}` : 'none',
						opacity: showRegeneratingBanner ? 0.5 : 1,
						transition: 'box-shadow 0.15s ease, opacity 0.2s ease',
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
									onKeyDown={(e) => {
										if (e.key === 'Escape') {
											cancelClickedRef.current = true
											doCancel()
										}
									}}
									className="summary-title"
									style={{ margin: 0, outline: 'none', cursor: isEditing ? 'text' : 'default' }}>
									{meetingTitle || (isLoading ? '\u00a0' : `Summary for ${mid}`)}
								</h1>
								{formattedDate && (
									<p style={{ margin: '6px 0 0 0', fontSize: '15px', color: currentThemeColors.secondaryText, fontFamily: 'inherit' }}>{formattedDate}</p>
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
												padding: '8px 14px',
												border: 'none',
												borderRadius: '6px',
												backgroundColor: currentThemeColors.button.primary,
												color: currentThemeColors.button.primaryText,
												fontSize: '15px',
												fontWeight: 500,
												cursor: 'pointer',
												fontFamily: 'inherit',
											}}>
											Save
										</button>
										<button
											onMouseDown={() => {
												cancelClickedRef.current = true
											}}
											onClick={doCancel}
											style={{
												padding: '8px 14px',
												border: `1px solid ${currentThemeColors.border}`,
												borderRadius: '6px',
												backgroundColor: currentThemeColors.background,
												color: currentThemeColors.text,
												fontSize: '15px',
												cursor: 'pointer',
												fontFamily: 'inherit',
											}}>
											Cancel
										</button>
									</>
								) : null}
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
								fontSize: '16px',
								outline: 'none',
								cursor: isEditing ? 'text' : 'default',
								minHeight: '100px',
							}}
							className="markdown-content"
						/>
					</div>
				</div>
			) : showProcessingMessage ? (
				<p style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<Spinner label={stageLabel} />
					{stageLabel}
				</p>
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
						marginTop: '12px',
						backgroundColor: currentThemeColors.background,
						padding: '10px 14px',
						borderRadius: '12px',
						border: `1px solid ${currentThemeColors.border}`,
					}}>
					<h5
						onClick={() => setIsTranscriptVisible(!isTranscriptVisible)}
						style={{ cursor: 'pointer', userSelect: 'none', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
						<span style={{ display: 'flex', alignItems: 'center' }}>
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
							{speakerCount ? (
								<span style={{ marginLeft: '8px', fontWeight: 400, fontSize: '13px', color: currentThemeColors.secondaryText }}>
									{speakerCount} {speakerCount === 1 ? 'speaker' : 'speakers'}
								</span>
							) : null}
							{clientStats ? <span style={{ marginLeft: '8px', fontSize: '12px' }} title="Transcribed on the recording device">⚡</span> : null}
						</span>
						<button
							onClick={(e) => {
								e.stopPropagation()
								navigator.clipboard.writeText(transcript || '').then(() => {
									setTranscriptCopied(true)
									if (transcriptCopyTimerRef.current) clearTimeout(transcriptCopyTimerRef.current)
									transcriptCopyTimerRef.current = setTimeout(() => setTranscriptCopied(false), 3000)
								})
							}}
							title="Copy transcript"
							style={{
								padding: '5px 9px',
								border: `1px solid ${currentThemeColors.border}`,
								borderRadius: '6px',
								backgroundColor: currentThemeColors.backgroundSecondary,
								color: currentThemeColors.secondaryText,
								cursor: 'pointer',
								display: 'flex',
								alignItems: 'center',
								gap: '4px',
								fontSize: '13px',
								lineHeight: 1,
								fontFamily: 'inherit',
							}}>
							{transcriptCopied ? <span>Copied!</span> : <CopyTextIcon size={13} />}
						</button>
					</h5>
					{clientStats && <OnDeviceStats stats={clientStats} theme={currentThemeColors} />}
					{isTranscriptVisible && (
						<pre style={{ marginTop: '8px', whiteSpace: 'pre-wrap', color: currentThemeColors.text, fontSize: '15px', lineHeight: '1.6' }}>{transcript}</pre>
					)}
				</div>
			)}
		</div>
	)
}
