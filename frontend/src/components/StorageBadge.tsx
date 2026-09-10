import React from 'react'
import { AppTheme } from '../styles/theme'
import type { MeetingStorage } from '../utils/history'

/**
 * Where this meeting is kept, stated on the meeting itself.
 *
 * Shown on every meeting, everywhere — but stamping "☁️ Cloud" on every row of
 * someone who has never heard of Local mode is noise, so the cloud badge stays
 * quiet (no border, secondary text) until local mode has been used at least
 * once. From then on both states are real statements and both get a full pill.
 */
export type BadgeSize = 'sm' | 'md'

interface Props {
	storage: MeetingStorage
	theme: AppTheme
	/** True once the user has ever turned Local mode on. */
	loud: boolean
	size?: BadgeSize
	title?: string
}

const StorageBadge: React.FC<Props> = ({ storage, theme, loud, size = 'sm', title }) => {
	const isLocal = storage === 'local'
	// A cloud badge nobody asked for should read as a footnote, not a label.
	const quiet = !isLocal && !loud

	const label = isLocal ? 'On this device' : 'Cloud'
	const icon = isLocal ? '🔒' : '☁️'
	const accent = isLocal ? theme.text : theme.secondaryText

	return (
		<span
			title={title ?? (isLocal ? 'Stored only in this browser. Never sent to the server.' : 'Stored on the server.')}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: '4px',
				flexShrink: 0,
				whiteSpace: 'nowrap',
				fontSize: size === 'sm' ? '11px' : '12px',
				lineHeight: 1.6,
				padding: quiet ? 0 : size === 'sm' ? '1px 7px' : '2px 9px',
				borderRadius: '999px',
				border: quiet ? 'none' : `1px solid ${accent}55`,
				backgroundColor: quiet ? 'transparent' : `${accent}14`,
				color: quiet ? theme.secondaryText : accent,
				fontWeight: quiet ? 400 : 500,
			}}>
			<span aria-hidden>{icon}</span>
			{label}
		</span>
	)
}

export default StorageBadge
