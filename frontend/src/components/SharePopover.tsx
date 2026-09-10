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
 * Sharing a meeting: one duration, one link.
 *
 * Deliberately not two features. "Share for a while" and "keep it in the
 * cloud" are the same operation with different clocks, so `Never` is a chip
 * in the row rather than a second button somewhere else — which is also how a
 * meeting recorded in cloud mode is described, since that is exactly what it
 * is.
 *
 * It is also the only place that states where the meeting is kept. A badge
 * used to say it alongside, and briefly a second local/cloud switch as well;
 * both are gone, because one of the two would eventually be wrong and the
 * question they answered is the one this popover exists to change.
 */

interface Props {
	theme: AppTheme
	meeting: LocalMeeting
	status: PublishStatus | null
	/** A local meeting is not on the server until it is published; a cloud one already is. */
	isLocal: boolean
	/** Offered only when there is somewhere to put the meeting afterwards. */
	canMakePrivate?: boolean
	onMakePrivate?: () => void
	onChange: (status: PublishStatus | null) => void
	onClose: () => void
}

const SharePopover: React.FC<Props> = ({ theme, meeting, status, isLocal, canMakePrivate, onMakePrivate, onChange, onClose }) => {
	// A cloud meeting is already shared, with no expiry — that is precisely
	// what "cloud" means here — so it opens on `Never` rather than pretending
	// nothing has been shared yet.
	const alreadyShared = !isLocal || !!status?.expires_at
	const [seconds, setSeconds] = useState<number | null>(isLocal ? DEFAULT_DURATION_SECONDS : null)
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
				<strong style={{ fontSize: '13px' }}>{alreadyShared ? 'Shared' : 'Only in this browser'}</strong>
			</div>
			<p style={{ margin: '6px 0 10px', color: theme.secondaryText, lineHeight: 1.5 }}>
				{alreadyShared
					? 'Anyone with the link can read it, and anything you change here is pushed to that copy. Set an expiry to have it deleted automatically.'
					: 'Nobody else can reach this meeting yet. Sharing puts a copy on the server; whoever opens the link can save it as their own meeting, at their own link, which yours is then unaffected by.'}
			</p>

			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
				{SHARE_DURATIONS.map((d) => chip(d.label, seconds === d.seconds, () => setSeconds(d.seconds)))}
			</div>

			{seconds === null && (
				<p style={{ margin: '0 0 10px', color: theme.secondaryText, lineHeight: 1.45 }}>
					Stays on the server until you remove it. This is what a normal cloud meeting is.
				</p>
			)}

			{(alreadyShared || status?.published) && (
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
						{status?.expires_at ? `Expires ${formatExpiry(status.expires_at)}` : 'No expiry — stays until you remove it'} · your edits keep it up
						to date · whoever saves it owns their copy
					</p>
				</>
			)}

			{error && <p style={{ margin: '0 0 10px', color: '#b45309', lineHeight: 1.45 }}>{error}</p>}

			<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
				{canMakePrivate && onMakePrivate && (
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							onClose()
							onMakePrivate()
						}}
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
						Make private
					</button>
				)}
				{isLocal && status?.published && (
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
					{busy ? 'Working…' : alreadyShared ? 'Update link' : 'Create link'}
				</button>
			</div>
		</div>
	)
}

export default SharePopover
