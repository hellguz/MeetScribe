import React, { useEffect, useState } from 'react'
import { AppTheme } from '../styles/theme'
import { formatExpiry, msUntil } from '../local/publish'
import { ShareIcon, CheckIcon } from './Icons'

/**
 * "This copy disappears on 17 Sep."
 *
 * Two constraints pull against each other: it has to be impossible to miss,
 * and it has to be three seconds of reading. The Apple convention resolves it —
 * a short bold line stating the consequence, one sentence of body, and a
 * button labelled with the verb it performs. Never "OK".
 *
 * Dismissing collapses it to a single quiet line rather than removing it: an
 * unsaved copy that is about to vanish should keep saying so.
 */

const AMBER = '#f59e0b'
const RED = '#dc2626'

interface Props {
	theme: AppTheme
	expiresAt: string
	saved: boolean
	onSave: () => void
}

const SaveCopyBanner: React.FC<Props> = ({ theme, expiresAt, saved, onSave }) => {
	const [collapsed, setCollapsed] = useState(false)
	const [, setTick] = useState(0)

	// Under an hour the wording changes by the minute, so it has to re-render.
	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 30_000)
		return () => clearInterval(id)
	}, [])

	if (saved) {
		return (
			<div
				style={{
					margin: '0 0 12px',
					padding: '9px 12px',
					borderRadius: '8px',
					backgroundColor: `${theme.text}0d`,
					color: theme.secondaryText,
					fontSize: '13px',
					display: 'flex',
					alignItems: 'center',
					gap: '7px',
				}}>
				<CheckIcon size={13} />
				Saved to this device. Yours to keep.
			</div>
		)
	}

	const remainingMs = msUntil(expiresAt)
	const urgent = remainingMs > 0 && remainingMs < 60_000
	const accent = urgent ? RED : AMBER

	const headline = urgent
		? `This copy disappears in ${Math.max(1, Math.round(remainingMs / 60_000))} minute${Math.round(remainingMs / 60_000) === 1 ? '' : 's'}`
		: `This copy disappears on ${formatExpiry(expiresAt)}`

	const saveButton = (
		<button
			type="button"
			onClick={onSave}
			style={{
				padding: '7px 12px',
				borderRadius: '6px',
				border: '1px solid transparent',
				backgroundColor: accent,
				color: '#ffffff',
				font: 'inherit',
				fontSize: '13px',
				fontWeight: 600,
				cursor: 'pointer',
				flexShrink: 0,
			}}>
			Save Copy
		</button>
	)

	if (collapsed) {
		return (
			<div style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: accent }}>
				<span style={{ flex: 1, minWidth: 0 }}>Not saved — gone after {formatExpiry(expiresAt)}.</span>
				{saveButton}
			</div>
		)
	}

	return (
		<div
			role="status"
			style={{
				position: 'sticky',
				top: 0,
				zIndex: 30,
				margin: '0 0 12px',
				padding: '11px 13px',
				borderRadius: '8px',
				border: `1px solid ${accent}66`,
				backgroundColor: `${accent}1f`,
				display: 'flex',
				alignItems: 'center',
				gap: '12px',
			}}>
			<span style={{ display: 'flex', flexShrink: 0, color: accent }}>
				<ShareIcon size={16} />
			</span>
			<div style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
				<div style={{ fontWeight: 600, fontSize: '13.5px', color: theme.text }}>{headline}</div>
				<div style={{ fontSize: '13px', color: theme.secondaryText }}>Save it and it's yours for good.</div>
			</div>
			{saveButton}
			<button
				type="button"
				aria-label="Collapse"
				onClick={() => setCollapsed(true)}
				style={{ border: 'none', background: 'none', color: theme.secondaryText, cursor: 'pointer', font: 'inherit', fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>
				×
			</button>
		</div>
	)
}

export default SaveCopyBanner
