import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
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
import { CopyTextIcon, CopyMarkdownIcon, EditIcon, TrashIcon, SpeakersIcon, CloseIcon, ShareIcon, LockIcon, DownloadIcon } from '../components/Icons'
import SegmentedToggle from '../components/SegmentedToggle'
import { removeMeeting } from '../utils/history'
import FavoriteButton from '../components/FavoriteButton'
import TagsManager from '../components/TagsManager'
import { isFavorite as checkFavorite, toggleFavorite, getMeetingTagIds, toggleMeetingTag } from '../utils/tags'
import SummaryLengthSelector from '../components/SummaryLengthSelector'
import LanguageSelector from '../components/LanguageSelector'
import { useMeetingSummary } from '../hooks/useMeetingSummary'
import OnDeviceStats from '../components/OnDeviceStats'
import { MarkdownView } from '../components/MarkdownView'
import StorageBadge from '../components/StorageBadge'
import LocalActivityBadge from '../components/LocalActivityBadge'
import LocalSummaryProgress from '../components/LocalSummaryProgress'
import { useLocalSummary } from '../ondevice/summary/useLocalSummary'
import { isLocalMode } from '../local/mode'
import { storageOf, getHistory, saveMeeting as saveMeetingMeta } from '../utils/history'
import { downloadMeetingMarkdown } from '../local/export'
import SharePopover from '../components/SharePopover'
import SaveCopyBanner from '../components/SaveCopyBanner'
import TombstoneNotice from '../components/TombstoneNotice'
import { hasOwnerToken, type PublishStatus } from '../local/publish'
import { putLocalMeeting, type LocalMeeting } from '../local/store'
import { useSummaryLanguage, SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { SummaryLength } from '../contexts/SummaryLengthContext'

marked.setOptions({ breaks: false })

const turndown = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-' })
// Strip span tags (browsers add them while editing) but keep their text content
turndown.addRule('spans', { filter: 'span', replacement: (content) => content })

export default function Summary() {
	const { mid } = useParams<{ mid: string }>()
	const navigate = useNavigate()
	const location = useLocation()
	const { theme } = useTheme()
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme
	const isDark = theme !== 'light'
	const { languageState, setLanguageState } = useSummaryLanguage()

	const meeting = useMeetingSummary({ mid, languageState, setLanguageState })
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
	} = meeting

	// For a local meeting this *is* the summary; there is no other one.
	//
	// `onSaved` is what puts it on screen. The run writes to IndexedDB, and
	// the hook that reads IndexedDB had no reason to read it again — so a
	// finished run left the page saying "No summary is available for this
	// meeting" until it was reloaded.
	const localSummary = useLocalSummary(mid, { onSaved: meeting.applyLocalMeeting })

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
	// version is on screen: coming back to the Claude tab remounts an empty div,
	// and without a re-run the summary would simply not be there.
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

	/**
	 * Summarize this meeting again with something changed.
	 *
	 * Length, language and context are one operation, not three: each is a
	 * field on the record the prompt is built from, so writing the new value
	 * and running the summariser again is all any of them is. `buildSummaryPrompt`
	 * reads the language straight off the stored meeting, which is why
	 * translating is nothing more than this.
	 *
	 * It exists because a local meeting has no server row: `/regenerate` and
	 * `/translate` both need one, so the length selector silently 404'd on a
	 * local meeting and the language selector was replaced by the words
	 * "Translation is cloud-only" — which was only ever true of the *route*,
	 * never of the model, and the model is sitting in this tab.
	 */
	const rerunLocally = useCallback(
		async (patch: Partial<LocalMeeting>, nextLength?: SummaryLength) => {
			if (!mid) return
			await meeting.updateLocalMeeting(patch)
			localSummary.generate(nextLength ?? currentMeetingLength)
		},
		[mid, meeting, localSummary, currentMeetingLength],
	)

	const handleContextUpdateConfirm = () => {
		if (editedContext === context) return
		if (isLocal) {
			void rerunLocally({ context: editedContext ?? null })
			return
		}
		handleRegenerate({ newContext: editedContext })
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
		if (isLocal) {
			// Not a translation of the summary but a fresh one written in the
			// target language — which is also exactly what the server does.
			await rerunLocally({
				summary_language_mode: newState.mode,
				summary_custom_language: newState.mode === 'custom' ? newState.lastCustomLanguage : null,
			})
			return
		}
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
	/**
	 * A local re-run is a regeneration; it just happens on the GPU in this tab
	 * instead of on the server. Folded in here so the stale summary dims, the
	 * selectors lock, and the banner appears exactly as they do for a cloud
	 * meeting — rather than the only sign being the dial in the top bar.
	 */
	const regenerating = isRegenerating || (meeting.isLocal && localSummary.busy)
	const busy = isProcessing || regenerating
	// Regenerating with a summary already on screen used to show nothing at all,
	// so changing the language looked like a no-op. Announce it over the stale text.
	const showRegeneratingBanner = busy && !!summaryMarkdown
	// A local first run reports itself through `LocalSummaryProgress` and the
	// streaming card, which say what is actually happening; this generic line
	// would sit above them saying "Processing summary" and nothing more.
	const showProcessingMessage = busy && !summaryMarkdown && !meeting.isLocal
	// Whether this meeting already carries speaker labels.
	const isDiarized = /^Speaker \d+:/m.test(transcript || '')
	// Offer the re-run only for meetings that predate the feature. Inferring
	// this from "the transcript has no Speaker labels" was wrong: a silent
	// recording has an empty transcript and no labels either, so brand-new
	// meetings were being offered a pointless re-run.
	const offerSpeakerHint = canRediarize && !diarizationAttempted && !isDiarized
	// Names the stage and its position, e.g. "Step 2 of 3 · Identifying speakers".
	// On the device there are no server stages to count; the summariser's own
	// status line is both more specific and more current.
	const stageLabel = meeting.isLocal
		? (localSummary.state.statusText ?? 'Summarizing on this device')
		: stageText(processingStage, processingTotal, 'Processing summary')

	// Where this meeting is stored, for the badge and for the actions that
	// only make sense on one side (translate, find speakers, feedback).
	const isLocal = meeting.isLocal
	const storage = isLocal ? 'local' : storageOf(getHistory().find((m) => m.id === mid) ?? {})
	// Cloud badges stay quiet until the user has met Local mode at all.
	const badgeLoud = isLocalMode() || isLocal

	// A local meeting that has a transcript but no summary is waiting for the
	// model. Run it without being asked: the user already chose Local mode,
	// and a page that just sits there looks broken.
	const needsLocalSummary = isLocal && !!transcript && !summaryMarkdown
	const autoStartedRef = useRef(false)
	useEffect(() => {
		if (!needsLocalSummary || autoStartedRef.current) return
		if (localSummary.busy || localSummary.state.phase === 'error') return
		autoStartedRef.current = true
		localSummary.generate(currentMeetingLength)
	}, [needsLocalSummary, localSummary, currentMeetingLength])

	// ── Sharing ──────────────────────────────────────────────────────────
	const [shareOpen, setShareOpen] = useState(false)
	const [share, setShare] = useState<PublishStatus | null>(null)
	const [savedCopy, setSavedCopy] = useState(false)
	const [convertError, setConvertError] = useState<string | null>(null)

	// Whether this meeting is shared comes from what the page already loaded —
	// the local record for a local meeting, the status payload for a cloud one.
	// It used to be discovered by probing /export, which meant a 404 in the
	// console every time someone opened a meeting they had never shared.
	useEffect(() => {
		if (!mid) return
		const online = !!meeting.expiresAt || meeting.publishedLocally
		setShare(online ? { id: mid, published: true, expires_at: meeting.expiresAt, origin: 'published' } : null)
	}, [mid, meeting.expiresAt, meeting.publishedLocally])

	/**
	 * Is there a copy of this meeting anyone else could reach?
	 *
	 * Not the same question as "where does it live". A local meeting with a
	 * live share link is shared — the server is holding a copy so the link
	 * works — and a cloud meeting is shared with no expiry, which is all
	 * "in the cloud" has ever meant. So this, and not the storage backend, is
	 * what the one control in the toolbar shows and changes.
	 *
	 * `published` rather than only `expires_at`, because the share that means
	 * "keep it in the cloud" is precisely the one with no expiry.
	 */
	const isShared = !isLocal || !!share?.published || !!share?.expires_at

	/**
	 * Set for one render after `saveSharedCopy` moved the page onto the new
	 * id, so the banner can explain why the URL changed. Router state and not
	 * component state, because the component is a different instance by then.
	 */
	const justSavedFrom = (location.state as { savedFrom?: string } | null)?.savedFrom ?? null

	// A cloud meeting with an expiry is somebody else's shared copy: it is
	// going away, and after that there is nothing to come back to.
	const viewingSharedCopy = !isLocal && !!meeting.expiresAt && !hasOwnerToken(mid ?? '')

	/** The meeting as a portable record, for saving or exporting. */
	const asRecord = useCallback(
		(): LocalMeeting => ({
			id: mid ?? 'meeting',
			title: meetingTitle ?? 'Meeting',
			started_at: meetingStartedAt || new Date().toISOString(),
			transcript: transcript ?? '',
			segments: [],
			summary_markdown: summaryMarkdown,
			context: context ?? null,
			summary_length: currentMeetingLength,
			summary_language_mode: 'auto',
			summary_custom_language: null,
			timezone: null,
			duration_seconds: null,
			word_count: null,
			speaker_count: speakerCount,
			client_stats: clientStats,
			updated_at: new Date().toISOString(),
			unfinished: false,
		}),
		[mid, meetingTitle, meetingStartedAt, transcript, summaryMarkdown, context, currentMeetingLength, speakerCount, clientStats],
	)

	/**
	 * Take somebody else's shared meeting and make it yours.
	 *
	 * Under a *new* id, which is the whole point. The copy used to be stored
	 * under the original's id, and that broke two things at once. Sharing it
	 * on was impossible: `POST /publish` checks the owner token against the
	 * hash minted by whoever shared it first, so it came back 403 — "This
	 * meeting belongs to another browser." And the copy shadowed the original
	 * in this browser forever, because `getLocalMeeting` is consulted before
	 * the server and the two answered to the same name.
	 *
	 * There are no accounts, so ownership is "holds the token for this id".
	 * A new id is therefore the only way to be an owner, and being an owner
	 * is what lets you edit the meeting and hand out a link of your own. The
	 * two meetings never sync afterwards, in either direction: what you are
	 * saving is a copy, which is what a share has always handed out.
	 */
	const saveSharedCopy = useCallback(async () => {
		if (!mid) return
		const ownId = crypto.randomUUID()
		const record: LocalMeeting = {
			...asRecord(),
			id: ownId,
			// Nobody else can reach this one yet, however widely the meeting it
			// came from is shared.
			published: false,
			shared_until: null,
			copied_from: mid,
			updated_at: new Date().toISOString(),
		}
		await putLocalMeeting(record)
		saveMeetingMeta({
			id: ownId,
			title: record.title,
			started_at: record.started_at,
			status: 'complete',
			storage: 'local',
			duration_seconds: record.duration_seconds,
		})
		setSavedCopy(true)
		// `replace`, not `push`: the link that was open is now the *other*
		// meeting, and Back should reach the list rather than a copy of the
		// page that just moved.
		navigate(`/summary/${ownId}`, { replace: true, state: { savedFrom: mid } })
	}, [mid, asRecord, navigate])

	/**
	 * Save the meeting as a file. Offered for cloud meetings too — the fact
	 * that the server has a copy is not a reason to make someone copy-paste
	 * their own notes into a document.
	 */
	const handleDownload = useCallback(() => {
		downloadMeetingMarkdown(meeting.localMeeting ?? asRecord())
	}, [meeting.localMeeting, asRecord])

	/**
	 * Pull the meeting into this browser.
	 *
	 * No `window.confirm` here any more: the switch that calls this opens a
	 * panel listing exactly what the move costs, in the app’s own type rather
	 * than a browser dialog with bullet characters in it. Two confirmations for
	 * one deliberate action is one too many.
	 */
	const handleMakePrivate = useCallback(async () => {
		setConvertError(null)
		try {
			await meeting.makePrivate()
		} catch (e) {
			setConvertError(e instanceof Error ? e.message : String(e))
		}
	}, [meeting])

	/**
	 * One control for both modes, because they are the same thing.
	 *
	 * A cloud meeting *is* a meeting shared with no expiry — the server holds a
	 * copy and anyone with the link can read it. So there is no separate "share"
	 * and "make private" button: the popover shows the current state and offers
	 * the moves out of it, whichever state you are in.
	 */
	const shareTitle = !isShared
		? 'Only in this browser — share it with a link'
		: share?.expires_at
			? 'Shared — manage the link or let it expire'
			: 'Shared with no expiry — anyone with the link can read it'

	// Streaming output has nowhere to live until the run is saved, so it gets
	// its own card while it arrives — and gives it up the moment the stored
	// summary exists, not when the phase reaches 'done'. The two used to be
	// the same moment only because saving never reached the page: now that it
	// does, and now that a title is generated after it, the phase is still
	// 'saving' or 'titling' while the real summary is already on screen, and
	// the card was rendering the same text again underneath it.
	const showStreaming = localSummary.state.streaming.length > 0 && !summaryMarkdown
	const showLocalPanel = isLocal && !!transcript && !summaryMarkdown && !showStreaming

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
				maxWidth: 800,
				margin: '0 auto',
				padding: '12px 24px 24px',
				color: currentThemeColors.text,
				transition: 'max-width 0.2s ease',
			}}>
			{/* Top nav */}
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
					<button
						onClick={() => navigate('/record')}
						style={{
							background: 'none',
							border: 'none',
							cursor: 'pointer',
							color: currentThemeColors.secondaryText,
							fontSize: '15px',
							fontFamily: 'inherit',
							padding: 0,
						}}>
						← Back
					</button>
					{/* Nothing about storage lives here any more. Sharing *is*
					    storage — a cloud meeting is one shared with no expiry —
					    so the share control below states it and changes it, and a
					    second control saying the same thing was just somewhere
					    else for the two to disagree. A removed meeting keeps its
					    marker, because `TombstoneNotice` is the only other place
					    that says so and it can be scrolled past. */}
					{meeting.tombstone && <StorageBadge storage={storage} theme={currentThemeColors} loud={badgeLoud} gone />}
				</div>
				<div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
					<LocalActivityBadge theme={currentThemeColors} />
					{/* Copy, edit, delete, tags and favourites all act on the real
					    summary, so they only belong on the Claude tab — offering
					    "edit" while an on-device run is on screen would imply the
					    run is editable, and "copy" would quietly copy the other one. */}
					{hasSummary && !isProcessing && (
						<>
							{/* Private or shared, as a pair rather than one button
							    whose icon swaps — same reasoning, and the same
							    control, as the mode switch on the record page.
							    First in the row because it is about the meeting
							    rather than about this copy of its text.

							    Both segments open the sharing panel. Neither
							    direction is a free flip: sharing puts the text on
							    a server, and locking it takes away access people
							    already have (and, for a cloud meeting, deletes the
							    only copy anyone else could reach). The panel is
							    where those say so and where the buttons live. */}
							<div style={{ position: 'relative', display: 'flex' }}>
								<SegmentedToggle
									theme={currentThemeColors}
									ariaLabel="Whether this meeting is shared"
									value={isShared ? 'shared' : 'private'}
									options={[
										{
											value: 'private',
											icon: LockIcon,
											title: isShared
												? 'Stop sharing — keep this meeting in this browser alone'
												: 'Only in this browser. Nobody else can reach it.',
										},
										{ value: 'shared', icon: ShareIcon, title: shareTitle },
									]}
									onSelect={() => setShareOpen((v) => !v)}
								/>
								{shareOpen && (
									<SharePopover
										theme={currentThemeColors}
										meeting={meeting.localMeeting ?? asRecord()}
										status={share}
										isLocal={isLocal}
										canMakePrivate={!isLocal && hasSummary}
										onMakePrivate={handleMakePrivate}
										onChange={setShare}
										onClose={() => setShareOpen(false)}
									/>
								)}
							</div>
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
								<div style={{ width: '1px', backgroundColor: currentThemeColors.border }} />
								<button
									onClick={handleDownload}
									style={copyButtonStyle}
									title="Download as Markdown"
									onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
									onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
									<DownloadIcon />
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

			{meeting.tombstone && (
				<TombstoneNotice
					theme={currentThemeColors}
					tombstone={meeting.tombstone}
					recovered={meeting.recoveredCopy}
					onBack={() => navigate('/record')}
					onOpenCopy={() => window.location.reload()}
				/>
			)}

			{viewingSharedCopy && share?.expires_at && !meeting.tombstone && (
				<SaveCopyBanner theme={currentThemeColors} expiresAt={share.expires_at} saved={savedCopy} onSave={saveSharedCopy} />
			)}

			{/* Landed here from a Save Copy, one navigation ago. */}
			{justSavedFrom && isLocal && !meeting.tombstone && <SaveCopyBanner theme={currentThemeColors} expiresAt={null} saved />}

			{convertError && (
				<p
					style={{
						margin: '0 0 12px',
						padding: '10px 12px',
						borderRadius: '10px',
						border: `1px solid ${currentThemeColors.button.danger}55`,
						color: currentThemeColors.button.danger,
						lineHeight: 1.5,
					}}>
					{convertError}
				</p>
			)}

			{/* Settings card */}
			{!meeting.tombstone && (hasSummary || isProcessing) && (
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
								disabled={regenerating || isProcessing}
								onSelect={(l: SummaryLength) => (isLocal ? void rerunLocally({ summary_length: l }, l) : handleRegenerate({ newLength: l }))}
							/>
							<LanguageSelector disabled={regenerating || isProcessing} onSelectionChange={handleLanguageChange} />
						</div>
						<div>
							<textarea
								id="context-editor"
								value={editedContext ?? ''}
								onChange={(e) => setEditedContext(e.target.value)}
								placeholder="Context: participant names, project codes, key terms..."
								disabled={regenerating || isProcessing}
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
									opacity: regenerating || isProcessing ? 0.7 : 1,
								}}
							/>
							{contextHasChanged && (
								<button
									onClick={handleContextUpdateConfirm}
									disabled={regenerating || isProcessing}
									style={{
										marginTop: '6px',
										padding: '8px 14px',
										border: 'none',
										borderRadius: '6px',
										backgroundColor: currentThemeColors.button.primary,
										color: currentThemeColors.button.primaryText,
										fontSize: '15px',
										fontWeight: '500',
										cursor: regenerating || isProcessing ? 'not-allowed' : 'pointer',
										opacity: regenerating || isProcessing ? 0.6 : 1,
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
				<LocalSummaryProgress
					theme={currentThemeColors}
					state={localSummary.state}
					busy={localSummary.busy}
					webgpuAvailable={localSummary.webgpuAvailable}
					onGenerate={() => localSummary.generate(currentMeetingLength)}
					onCancel={localSummary.cancel}
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

			{/* Summary */}
			{displayLoading ? (
				<p style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<Spinner label="Loading summary" />
					Loading summary…
				</p>
			) : error ? (
				<p style={{ color: currentThemeColors.button.danger }}>Error: {error}</p>
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

			{/* Feedback is stored against a server meeting row, which a local
			    meeting has not got. */}
			{hasSummary && !isLoading && !isLocal && (
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
