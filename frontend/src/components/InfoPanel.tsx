import React, { useEffect } from 'react'
import { AppTheme } from '../styles/theme'
import { InfoIcon, CloseIcon } from './Icons'

const REPO_URL = 'https://github.com/hellguz/meetscribe'

/**
 * Changelog, newest first. Drawn from the merged pull requests, one or two
 * lines each — a "what's new" for users, not a commit log.
 */
const CHANGELOG: { when: string; lines: string[] }[] = [
	{
		when: 'August 2026',
		lines: [
			'🗣️ Speaker labels — MeetScribe now works out who said what, on your own machine.',
			'📁 Uploaded files are handled on the server, so they take minutes instead of hours.',
			'🔍 Filter your meetings by ⭐ favourite or 🏷️ tag.',
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
	// Escape closes, and the page behind must not scroll while the modal is up.
	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
		document.addEventListener('keydown', onKey)
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.removeEventListener('keydown', onKey)
			document.body.style.overflow = previousOverflow
		}
	}, [open, setOpen])

	if (!open) return null

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="About MeetScribe"
			onClick={() => setOpen(false)}
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
						onClick={() => setOpen(false)}
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
				<p style={{ margin: '8px 0 0', color: theme.secondaryText }}>
					Self-hostable — run it on your own machine and your recordings stay there.{' '}
					<a href={REPO_URL} target="_blank" rel="noreferrer" style={{ color: theme.button.primary }}>
						Source on GitHub
					</a>
					.
				</p>
				<p style={{ margin: '8px 0 0', color: theme.secondaryText }}>A pet project by Egor Gavrilov · MIT licensed.</p>

				<div style={{ borderTop: `1px solid ${theme.border}`, margin: '14px 0 12px' }} />
				<strong style={{ fontSize: '14px' }}>What's new</strong>

				{CHANGELOG.map((entry) => (
					<div key={entry.when} style={{ marginTop: '12px' }}>
						<div style={{ color: theme.secondaryText, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
							{entry.when}
						</div>
						<ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
							{entry.lines.map((line) => (
								<li key={line} style={{ marginBottom: '4px' }}>
									{line}
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</div>
	)
}

export default InfoPanel
