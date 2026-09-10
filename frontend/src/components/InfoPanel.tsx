import React, { useEffect, useState } from 'react'
import { AppTheme } from '../styles/theme'
import { InfoIcon, CloseIcon } from './Icons'

const REPO_URL = 'https://github.com/hellguz/meetscribe'

interface ChangelogEntry {
	when: string
	/**
	 * The one or two things in a release worth stopping for. Two is the cap
	 * that makes them worth reading: a release with five headlines has none.
	 */
	highlights?: { icon: string; title: string; body: string }[]
	/** Everything else, one short line each. */
	lines: string[]
}

/**
 * What's new, newest first.
 *
 * Written for somebody who has been using MeetScribe for months and will give
 * this two minutes. That budget is the whole design: the newest release gets
 * two headlines and a handful of one-liners, not the thirteen bullets it had
 * when this was drawn straight from the merged pull requests. A changelog
 * nobody finishes reading is the same as no changelog.
 *
 * The rule for what goes where: a highlight is something that changes what
 * you can do with the app. Everything else is a line, however much work it
 * was.
 */
const CHANGELOG: ChangelogEntry[] = [
	{
		when: 'September 2026',
		highlights: [
			{
				icon: '🔒',
				title: 'It can all run on your own computer',
				body: 'Recording, transcribing, working out who spoke, writing the summary — none of it has to leave your browser. No server, no AI provider, nothing to trust. Switch it on at the top of the page.',
			},
			{
				icon: '🙈',
				title: 'And then nobody else can read it',
				body: 'A meeting kept here has no address for anyone to visit. When you do want to send it, one click gives you a link that lasts an hour, a week, or until you take it back — and the padlock takes it back.',
			},
		],
		lines: [
			'🔗 Save a meeting someone shared with you and it becomes yours, at your own link, yours to edit.',
			'⚡ The top bar shows what your machine is doing. Nothing downloads until you press record.',
			'🌍 Summary length, language and extra context all work on a local meeting too.',
			'🤖 Summaries and titles written here come from a small model on your graphics card — shorter and plainer than Claude, and weaker outside English.',
			'🗓️ Your meeting list now shows the weekday and how long each one ran.',
		],
	},
	{
		when: 'August 2026',
		highlights: [
			{
				icon: '🗣️',
				title: 'It works out who said what',
				body: 'Summaries and transcripts now name the speakers — Speaker 1, Speaker 2 — so a conversation reads like one. Worked out on your own machine, from the audio, with nothing extra to set up.',
			},
			{
				icon: '🔍',
				title: 'Find an old meeting again',
				body: 'Star the ones you keep coming back to, tag the rest, and filter your list by either. Useful at about the fiftieth meeting, which is where everyone ends up.',
			},
		],
		lines: [
			'📁 Uploaded files are handled on the server, so they take minutes instead of hours.',
			'🕒 Meeting times now show in your own timezone, to the minute.',
			'⏳ While a summary is being made, you can see which step it is on.',
		],
	},
	{
		when: 'March 2026',
		lines: [
			'⏸️ Pause and resume a recording without losing it.',
			'⭐ Favourites and 🏷️ tags, so a long list stays findable.',
			'✂️ Essence mode for the shortest possible summary, plus a live length tracker.',
			'🧹 Dropped Redis and Celery — same features, far fewer moving parts.',
		],
	},
	{
		when: 'August 2025',
		lines: ['📑 Custom summary sections, later folded back into the presets.'],
	},
	{
		when: 'June 2025',
		lines: [
			'📊 A dashboard with usage stats and feedback trends.',
			'🌍 Summaries in 25+ languages, with a length toggle.',
			'🌙 Dark mode, ✏️ renaming, and offline caching of past summaries.',
			'🎙️ First release — record, transcribe, summarize.',
		],
	},
]

const SEEN_KEY = 'meetscribe_changelog_seen'

/** FNV-1a. Cheap, stable, and plenty to notice that a release changed. */
function digest(value: string): string {
	let hash = 2166136261
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(36)
}

/**
 * A name for "the newest release, as currently written".
 *
 * Derived from the newest entry's own content rather than a number somebody
 * has to remember to bump — the version that needs bumping is exactly the
 * version that gets forgotten. Only the newest entry feeds it, so correcting
 * a typo in a two-year-old line does not reintroduce the panel to everyone.
 */
export const CHANGELOG_VERSION = `${CHANGELOG[0].when}·${digest(JSON.stringify(CHANGELOG[0]))}`

/**
 * Has this browser seen the newest release notes?
 *
 * A storage failure counts as "seen". Private windows cannot remember the
 * answer, and a panel that opens itself on every single load is worse than
 * one that never mentions the release at all.
 */
export function hasUnseenChangelog(): boolean {
	try {
		return localStorage.getItem(SEEN_KEY) !== CHANGELOG_VERSION
	} catch {
		return false
	}
}

export function markChangelogSeen(): void {
	try {
		localStorage.setItem(SEEN_KEY, CHANGELOG_VERSION)
	} catch {
		/* private mode; it simply gets offered again next time */
	}
}

interface InfoPanelProps {
	theme: AppTheme
	open: boolean
	setOpen: (open: boolean) => void
}

/** The trigger. Styled to match ThemeToggle exactly, including its hover. */
export const InfoButton: React.FC<{ theme: AppTheme; onClick: () => void }> = ({ theme, onClick }) => (
	<button
		onClick={onClick}
		title="About MeetScribe"
		aria-label="About MeetScribe"
		style={{
			padding: '7px 9px',
			border: `1px solid ${theme.border}`,
			borderRadius: '6px',
			backgroundColor: theme.backgroundSecondary,
			color: theme.secondaryText,
			cursor: 'pointer',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			lineHeight: 1,
			transition: 'background-color 0.2s ease',
		}}
		onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.background)}
		onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.backgroundSecondary)}>
		<InfoIcon />
	</button>
)

const InfoPanel: React.FC<InfoPanelProps> = ({ theme, open, setOpen }) => {
	const [latest, ...earlier] = CHANGELOG
	const [showEarlier, setShowEarlier] = useState(false)

	// Closing is the acknowledgement, however the panel was opened.
	const close = () => {
		markChangelogSeen()
		setOpen(false)
	}

	// Escape closes, and the page behind must not scroll while the modal is up.
	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return
			markChangelogSeen()
			setOpen(false)
		}
		document.addEventListener('keydown', onKey)
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.removeEventListener('keydown', onKey)
			document.body.style.overflow = previousOverflow
		}
	}, [open, setOpen])

	if (!open) return null

	const monthLabel = (when: string) => (
		<div style={{ color: theme.secondaryText, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{when}</div>
	)

	/**
	 * A headline, with room to breathe.
	 *
	 * Anything that needs a paragraph to explain belongs in one of these
	 * rather than in the list, and anything that fits on a line belongs in the
	 * list rather than in one of these.
	 */
	const highlightCard = (h: { icon: string; title: string; body: string }) => (
		<div
			key={h.title}
			style={{
				marginTop: '10px',
				padding: '11px 13px',
				borderRadius: '10px',
				backgroundColor: theme.background,
				border: `1px solid ${theme.border}`,
			}}>
			<div style={{ display: 'flex', gap: '9px', alignItems: 'baseline' }}>
				<span aria-hidden style={{ fontSize: '15px', lineHeight: 1.3 }}>
					{h.icon}
				</span>
				<div>
					<strong>{h.title}</strong>
					<div style={{ color: theme.secondaryText, marginTop: '2px' }}>{h.body}</div>
				</div>
			</div>
		</div>
	)

	const lineList = (lines: string[]) => (
		<ul style={{ margin: '5px 0 0', paddingLeft: '18px' }}>
			{lines.map((line) => (
				<li key={line} style={{ marginBottom: '5px', color: theme.secondaryText }}>
					{line}
				</li>
			))}
		</ul>
	)

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="About MeetScribe"
			onClick={close}
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 100,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: '20px',
				backgroundColor: 'rgba(0, 0, 0, 0.45)',
			}}>
			<div
				// Clicks inside must not fall through to the backdrop's close.
				onClick={(e) => e.stopPropagation()}
				style={{
					width: 'min(420px, 100%)',
					maxHeight: '80vh',
					overflowY: 'auto',
					padding: '18px 20px',
					borderRadius: '14px',
					backgroundColor: theme.body,
					border: `1px solid ${theme.border}`,
					boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
					color: theme.text,
					fontSize: '14px',
					lineHeight: 1.55,
					textAlign: 'left',
				}}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
					<strong style={{ fontSize: '16px' }}>🎙️ MeetScribe</strong>
					<button
						onClick={close}
						aria-label="Close"
						style={{
							display: 'flex',
							border: 'none',
							background: 'none',
							color: theme.secondaryText,
							cursor: 'pointer',
							padding: '2px',
							fontFamily: 'inherit',
						}}>
						<CloseIcon size={16} />
					</button>
				</div>

				<p style={{ margin: '10px 0 0' }}>
					Hit record, focus on the conversation, and get a clean summary plus the full transcript when you're done.
				</p>

				<div style={{ borderTop: `1px solid ${theme.border}`, margin: '14px 0 12px' }} />

				{/* The newest release names itself in the heading, so it does not
				    also get the small uppercase month the earlier ones use. */}
				<strong style={{ fontSize: '14px' }}>New in {latest.when}</strong>

				{latest.highlights?.map(highlightCard)}

				<div style={{ marginTop: '12px' }}>{lineList(latest.lines)}</div>

				<button
					type="button"
					onClick={() => setShowEarlier((v) => !v)}
					style={{
						marginTop: '10px',
						border: 'none',
						background: 'none',
						padding: 0,
						color: theme.secondaryText,
						font: 'inherit',
						fontSize: '13px',
						cursor: 'pointer',
						textDecoration: 'underline',
					}}>
					{showEarlier ? 'Hide earlier updates' : 'Earlier updates →'}
				</button>

				{showEarlier &&
					earlier.map((entry) => (
						<div key={entry.when} style={{ marginTop: '14px' }}>
							{monthLabel(entry.when)}
							{entry.highlights?.map(highlightCard)}
							{lineList(entry.lines)}
						</div>
					))}

				<div style={{ borderTop: `1px solid ${theme.border}`, margin: '14px 0 10px' }} />
				<p style={{ margin: 0, color: theme.secondaryText, fontSize: '13px' }}>
					Self-hostable — run it on your own machine and your recordings stay there.{' '}
					<a href={REPO_URL} target="_blank" rel="noreferrer" style={{ color: theme.button.primary }}>
						Source on GitHub
					</a>
					. A pet project by Egor Gavrilov · MIT licensed.
				</p>
			</div>
		</div>
	)
}

export default InfoPanel
