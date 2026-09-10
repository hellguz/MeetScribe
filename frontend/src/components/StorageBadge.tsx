import React from 'react'
import { AppTheme } from '../styles/theme'
import type { MeetingStorage } from '../utils/history'
import { shortRemaining } from '../local/publish'

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
	/** ISO expiry of the shared copy, when this meeting is published. */
	sharedUntil?: string | null
	/** The meeting was removed from the server; nothing is coming back. */
	gone?: boolean
}

const StorageBadge: React.FC<Props> = ({ storage, theme, loud, size = 'sm', title, sharedUntil, gone }) => {
	const isLocal = storage === 'local'
	const isShared = isLocal && !!sharedUntil
	// A cloud badge nobody asked for should read as a footnote, not a label.
	const quiet = !isLocal && !loud && !gone

	// A share has a clock on it, so it borrows the colour the app already uses
	// for "temporarily paused" rather than reading as a permanent state.
	const label = gone ? 'Removed from cloud' : isShared ? `Shared · ${shortRemaining(sharedUntil as string)}` : isLocal ? 'On this device' : 'Cloud'
	const icon = gone ? '⚠️' : isShared ? '🔗' : isLocal ? '🔒' : '☁️'
	const accent = gone ? theme.button.danger : isShared ? '#f59e0b' : isLocal ? theme.text : theme.secondaryText

	return (
		<span
			title={
				title ??
				(gone
					? 'This meeting was removed from the server by whoever recorded it.'
					: isShared
						? 'A copy is on the server so the link works. It is deleted when the share expires.'
						: isLocal
							? 'Stored only in this browser. Never sent to the server.'
							: 'Stored on the server.')
			}
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
