import React, { useEffect, useRef, useState } from 'react'
import { AppTheme } from '../styles/theme'
import type { LocalMeeting } from '../local/store'
import { ShareIcon } from './Icons'
import {
	DEFAULT_DURATION_SECONDS,
	SHARE_DURATIONS,
	formatExpiry,
	publishMeeting,
	shareUrl,
	unpublishMeeting,
	type PublishStatus,
} from '../local/publish'

/**
 * Sharing a local meeting: one duration, one link.
 *
 * Deliberately not two features. "Share for a while" and "move to the cloud"
 * are the same operation with different clocks, so `Never` is a chip in the
 * row rather than a second button somewhere else — which is also how a meeting
 * recorded in cloud mode is described, since that is exactly what it is.
 */

interface Props {
	theme: AppTheme
	meeting: LocalMeeting
	status: PublishStatus | null
	onChange: (status: PublishStatus | null) => void
	onClose: () => void
}

const SharePopover: React.FC<Props> = ({ theme, meeting, status, onChange, onClose }) => {
	const [seconds, setSeconds] = useState<number | null>(DEFAULT_DURATION_SECONDS)
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

	const run = async (fn: () => Promise<void>) => {
		setBusy(true)
		setError(null)
		try {
			await fn()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	const link = shareUrl(meeting.id)

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link)
			setCopied(true)
			setTimeout(() => setCopied(false), 2500)
		} catch {
			setError('Could not copy the link. Select it and copy by hand.')
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
				right: 0,
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
				<strong style={{ fontSize: '13px' }}>{status?.published ? 'Shared' : 'Share this meeting'}</strong>
			</div>
			<p style={{ margin: '6px 0 10px', color: theme.secondaryText, lineHeight: 1.5 }}>
				Anyone with the link can read it. They get their own copy — edits don't travel in either direction.
			</p>

			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
				{SHARE_DURATIONS.map((d) => chip(d.label, seconds === d.seconds, () => setSeconds(d.seconds)))}
			</div>

			{seconds === null && (
				<p style={{ margin: '0 0 10px', color: theme.secondaryText, lineHeight: 1.45 }}>
					Stays on the server until you remove it. This is what a normal cloud meeting is.
				</p>
			)}

			{status?.published && (
				<>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '8px',
							padding: '7px 9px',
							borderRadius: '8px',
							border: `1px solid ${theme.border}`,
							backgroundColor: theme.backgroundSecondary,
							marginBottom: '8px',
						}}>
						<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '12px' }}>
							{link}
						</span>
						<button
							type="button"
							onClick={copy}
							style={{
								padding: '4px 10px',
								borderRadius: '6px',
								border: `1px solid ${theme.border}`,
								backgroundColor: theme.background,
								color: theme.text,
								font: 'inherit',
								fontSize: '12px',
								cursor: 'pointer',
								flexShrink: 0,
							}}>
							{copied ? 'Copied ✓' : 'Copy'}
						</button>
					</div>
					<p style={{ margin: '0 0 10px', color: theme.secondaryText, lineHeight: 1.45 }}>
						{status.expires_at ? `Expires ${formatExpiry(status.expires_at)}` : 'No expiry set'} · people who open it keep their own copy
					</p>
				</>
			)}

			{error && <p style={{ margin: '0 0 10px', color: '#b45309', lineHeight: 1.45 }}>{error}</p>}

			<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
				{status?.published && (
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							run(async () => {
								if (!window.confirm('Anyone with the link loses access. People who already opened it keep their copy.')) return
								await unpublishMeeting(meeting.id)
								onChange(null)
							})
						}
						style={{
							padding: '7px 11px',
							borderRadius: '6px',
							border: `1px solid ${theme.border}`,
							backgroundColor: theme.backgroundSecondary,
							color: theme.text,
							font: 'inherit',
							fontSize: '12px',
							cursor: busy ? 'wait' : 'pointer',
						}}>
						Stop sharing
					</button>
				)}
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						run(async () => {
							const next = await publishMeeting(meeting, seconds)
							onChange(next)
						})
					}
					style={{
						padding: '7px 11px',
						borderRadius: '6px',
						border: '1px solid transparent',
						backgroundColor: theme.button.primary,
						color: theme.button.primaryText,
						font: 'inherit',
						fontSize: '12px',
						cursor: busy ? 'wait' : 'pointer',
						opacity: busy ? 0.7 : 1,
					}}>
					{busy ? 'Working…' : status?.published ? 'Update link' : 'Create link'}
				</button>
			</div>
		</div>
	)
}

export default SharePopover
