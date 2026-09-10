import React, { useEffect, useRef, useState } from 'react'
import { AppTheme } from '../styles/theme'
import type { LocalMeeting } from '../local/store'
import { ShareIcon } from './Icons'
import { DEFAULT_DURATION_SECONDS, SHARE_DURATIONS, formatExpiry, publishMeeting, shareUrl, type PublishStatus } from '../local/publish'

/**
 * Sharing a meeting: one duration, one link.
 *
 * Deliberately not two features. "Share for a while" and "keep it in the
 * cloud" are the same operation with different clocks, so `Never` is a chip
 * in the row rather than a second concept elsewhere — which is also how a
 * meeting recorded in cloud mode is described, since that is exactly what it
 * is.
 *
 * The reverse operation is not here. Un-sharing lives behind the padlock, and
 * it lives there *only*: "Stop sharing" was a third button in this footer
 * doing what clicking the padlock does, which meant two places to keep in
 * step and two chances to word the same warning differently.
 *
 * The link is a button, not a text box. A monospace URL across the middle of
 * a popover is the widest thing in it, it invites reading a `uuid` nobody
 * needs to read, and the only thing anyone does with it is copy it.
 */

const AMBER = '#f59e0b'

interface Props {
	theme: AppTheme
	meeting: LocalMeeting
	status: PublishStatus | null
	/** A local meeting is not on the server until it is published; a cloud one already is. */
	isLocal: boolean
	onChange: (status: PublishStatus | null) => void
	onClose: () => void
}

const SharePopover: React.FC<Props> = ({ theme, meeting, status, isLocal, onChange, onClose }) => {
	// A cloud meeting is already shared, with no expiry — that is precisely
	// what "cloud" means here — so it opens on `Never` rather than pretending
	// nothing has been shared yet.
	const alreadyShared = !isLocal || !!status?.published || !!status?.expires_at
	const [seconds, setSeconds] = useState<number | null>(
		isLocal ? (status?.expires_at ? DEFAULT_DURATION_SECONDS : status?.published ? null : DEFAULT_DURATION_SECONDS) : null,
	)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const wrapRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose()
		}
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		document.addEventListener('mousedown', onDown)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('mousedown', onDown)
			document.removeEventListener('keydown', onKey)
		}
	}, [onClose])

	const link = shareUrl(meeting.id)

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link)
			setCopied(true)
			setTimeout(() => setCopied(false), 2500)
		} catch {
			setError(`Could not reach the clipboard. The link is ${link}`)
		}
	}

	const chip = (label: string, active: boolean, onClick: () => void) => (
		<button
			key={label}
			type="button"
			onClick={onClick}
			aria-pressed={active}
			style={{
				padding: '4px 10px',
				borderRadius: '999px',
				fontSize: '12px',
				font: 'inherit',
				fontFamily: 'inherit',
				cursor: 'pointer',
				border: `1px solid ${active ? theme.text : theme.border}`,
				backgroundColor: active ? `${theme.text}14` : 'transparent',
				color: active ? theme.text : theme.secondaryText,
			}}>
			{label}
		</button>
	)

	const secondary = (label: string, onClick: () => void) => (
		<button
			type="button"
			onClick={onClick}
			style={{
				padding: '7px 11px',
				borderRadius: '6px',
				border: `1px solid ${theme.border}`,
				backgroundColor: theme.backgroundSecondary,
				color: theme.text,
				font: 'inherit',
				fontSize: '12px',
				cursor: 'pointer',
			}}>
			{label}
		</button>
	)

	return (
		<div
			ref={wrapRef}
			role="dialog"
			aria-label="Share this meeting"
			onClick={(e) => e.stopPropagation()}
			style={{
				// Matches the tags dropdown: same offset, radius, shadow and
				// stacking, so the two menus read as one family.
				position: 'absolute',
				top: '100%',
				left: 0,
				marginTop: '4px',
				zIndex: 1000,
				width: 'min(320px, calc(100vw - 32px))',
				padding: '12px',
				borderRadius: '8px',
				border: `1px solid ${theme.border}`,
				backgroundColor: theme.background,
				boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
				fontSize: '13px',
				color: theme.text,
				textAlign: 'left',
			}}>
			<div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
				<ShareIcon size={13} />
				<strong style={{ fontSize: '13px' }}>{alreadyShared ? 'Shared' : 'Share this meeting'}</strong>
			</div>
			<p style={{ margin: '6px 0 10px', color: theme.secondaryText, lineHeight: 1.5 }}>
				{alreadyShared
					? 'Anyone with the link can read it, and anything you change here is pushed to that copy.'
					: 'Sharing puts a copy on the server; whoever opens the link can save it as their own meeting, at their own link, which yours is then unaffected by.'}
			</p>

			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
				{SHARE_DURATIONS.map((d) => chip(d.label, seconds === d.seconds, () => setSeconds(d.seconds)))}
			</div>

			<p style={{ margin: '0 0 10px', color: theme.secondaryText, lineHeight: 1.45 }}>
				{seconds === null
					? 'Stays on the server until you take it back — which is what a normal cloud meeting is.'
					: `Deleted automatically when the time is up${status?.expires_at ? `, currently ${formatExpiry(status.expires_at)}` : ''}.`}{' '}
				Whoever saves it keeps their own copy.
			</p>

			{error && <p style={{ margin: '0 0 10px', color: '#b45309', lineHeight: 1.45, wordBreak: 'break-word' }}>{error}</p>}

			<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
				{alreadyShared && secondary(copied ? 'Copied ✓' : 'Copy link', copy)}
				<button
					type="button"
					disabled={busy}
					onClick={async () => {
						setBusy(true)
						setError(null)
						try {
							onChange(await publishMeeting(meeting, seconds))
							onClose()
						} catch (e) {
							setError(e instanceof Error ? e.message : String(e))
						} finally {
							setBusy(false)
						}
					}}
					style={{
						padding: '7px 11px',
						borderRadius: '6px',
						border: '1px solid transparent',
						// Amber for an update, the colour this app gives a share
						// that is being held open on a clock.
						backgroundColor: alreadyShared ? AMBER : theme.button.primary,
						color: '#ffffff',
						font: 'inherit',
						fontSize: '12px',
						fontWeight: 500,
						cursor: busy ? 'wait' : 'pointer',
						opacity: busy ? 0.7 : 1,
					}}>
					{busy ? 'Working…' : alreadyShared ? 'Update link' : 'Create link'}
				</button>
			</div>
		</div>
	)
}

export default SharePopover
