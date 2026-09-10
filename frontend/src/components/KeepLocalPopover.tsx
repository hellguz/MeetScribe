import React, { useEffect, useRef, useState } from 'react'
import { AppTheme } from '../styles/theme'
import { AlertIcon, LockIcon } from './Icons'

/**
 * The padlock's own panel: what happens, and where the meeting ends up.
 *
 * It used to open the sharing panel, which was the wrong document entirely —
 * the reader had just asked to make something private and was shown a row of
 * durations. Taking a meeting back is also the one move here that destroys
 * something: the copy on the server goes, and with it everyone else's access.
 * That deserves saying in full, once, in the app's own type rather than a
 * browser dialog.
 *
 * Three states, because the sentence is different in each:
 *
 *   already private   nothing to do. Say where it is kept and close.
 *   shared from here  the original is safe in this browser; the copy goes.
 *   a cloud meeting   there is no local original yet. One is written first,
 *                     and only then is the server's copy removed.
 */

interface Props {
	theme: AppTheme
	/** The meeting body lives in this browser. */
	isLocal: boolean
	/** A copy is on the server, whether or not it has an expiry. */
	isShared: boolean
	/** Runs the move. Resolves when it is done; may throw. */
	onKeepLocal: () => Promise<void>
	onClose: () => void
}

const KeepLocalPopover: React.FC<Props> = ({ theme, isLocal, isShared, onKeepLocal, onClose }) => {
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
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

	const point = (children: React.ReactNode): React.ReactElement => (
		<li style={{ display: 'flex', gap: '7px', color: theme.secondaryText, lineHeight: 1.45 }}>
			<span style={{ display: 'flex', flexShrink: 0, marginTop: '1px' }}>
				<AlertIcon size={12} />
			</span>
			<span>{children}</span>
		</li>
	)

	const nothingToDo = !isShared && isLocal

	return (
		<div
			ref={wrapRef}
			role="dialog"
			aria-label="Keep this meeting on this device"
			onClick={(e) => e.stopPropagation()}
			className="anchored-menu"
			style={{
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
				<LockIcon size={13} />
				<strong style={{ fontSize: '13px' }}>{nothingToDo ? 'On this device only' : 'Keep it on this device'}</strong>
			</div>

			<p style={{ margin: '6px 0 10px', color: theme.secondaryText, lineHeight: 1.5 }}>
				{nothingToDo
					? 'This meeting is stored in this browser, in its own database. There is no copy on our server, so nobody else can reach it — and it is not on your other devices either.'
					: isLocal
						? 'The original is already in this browser. Taking it back deletes the copy the link points at, and nothing else changes.'
						: 'The meeting is copied into this browser first. Once that copy is verified, the server’s is deleted — it is never removed before there is somewhere for it to go.'}
			</p>

			{!nothingToDo && (
				<ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
					{isShared && point(<>Anyone you sent the link to loses access. Copies they already saved are theirs and stay.</>)}
					{!isLocal && point(<>The original audio is deleted with it, so speakers can never be re-identified.</>)}
					{point(
						<>
							Stored only in this browser afterwards. Clearing site data deletes it, and it will not appear on your other devices —
							download anything you would hate to lose.
						</>,
					)}
				</ul>
			)}

			{nothingToDo && (
				<ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
					{point(<>Clearing site data deletes it, and it will not appear on your other devices.</>)}
					{point(<>Share it to put a copy on the server — for an hour, a week, or until you take it back.</>)}
				</ul>
			)}

			{error && <p style={{ margin: '0 0 10px', color: '#b45309', lineHeight: 1.45, wordBreak: 'break-word' }}>{error}</p>}

			<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
				<button
					type="button"
					onClick={onClose}
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
					{nothingToDo ? 'Close' : 'Cancel'}
				</button>
				{!nothingToDo && (
					<button
						type="button"
						disabled={busy}
						onClick={async () => {
							setBusy(true)
							setError(null)
							try {
								await onKeepLocal()
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
							backgroundColor: theme.button.primary,
							color: theme.button.primaryText,
							font: 'inherit',
							fontSize: '12px',
							fontWeight: 500,
							cursor: busy ? 'wait' : 'pointer',
							opacity: busy ? 0.7 : 1,
						}}>
						{busy ? 'Working…' : isLocal ? 'Stop sharing' : 'Make it local'}
					</button>
				)}
			</div>
		</div>
	)
}

export default KeepLocalPopover
