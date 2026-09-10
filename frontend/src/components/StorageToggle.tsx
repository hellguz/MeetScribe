import React from 'react'
import { AppTheme } from '../styles/theme'
import { CloudIcon, LaptopIcon } from './Icons'

/**
 * Two answers to one question: does this live on this device, or online?
 *
 * The control it replaces was a single button that changed its own border
 * when local mode was on. A lone outlined button says "I am pressed" only to
 * someone who saw it un-pressed a moment ago; everyone else read it as a
 * button with a stray focus ring. A segmented pair has no such state to
 * infer — the answer is the segment that is filled in.
 *
 * Metrics come from `SummaryLengthSelector`, which is the app's existing
 * segmented control: a bordered track with 4px of padding, 5px-radius
 * segments, and the active one lifted with `backgroundSecondary`.
 */

export type StorageSide = 'local' | 'cloud'

interface Props {
	theme: AppTheme
	/** Which side is the current answer. */
	value: StorageSide
	onSelect: (side: StorageSide) => void
	disabled?: boolean
	/** Overrides for the two segments, when "Cloud" is not the right word. */
	labels?: { local: string; cloud: string }
	titles?: { local: string; cloud: string }
	/** A caution marker on the local segment (no WebGPU, a phone). */
	localWarning?: boolean
	/** Icons only, for a bar that is already full. */
	compact?: boolean
}

const StorageToggle: React.FC<Props> = ({ theme, value, onSelect, disabled = false, labels, titles, localWarning = false, compact = false }) => {
	const segment = (side: StorageSide) => {
		const isActive = value === side
		const Icon = side === 'local' ? LaptopIcon : CloudIcon
		const label = side === 'local' ? (labels?.local ?? 'On device') : (labels?.cloud ?? 'Cloud')
		return (
			<button
				key={side}
				type="button"
				disabled={disabled}
				aria-pressed={isActive}
				title={titles?.[side] ?? label}
				onClick={() => !disabled && onSelect(side)}
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					gap: '5px',
					padding: compact ? '5px 8px' : '5px 10px',
					height: '26px',
					boxSizing: 'border-box',
					border: 'none',
					borderRadius: '5px',
					backgroundColor: isActive ? theme.backgroundSecondary : 'transparent',
					color: isActive ? theme.text : theme.secondaryText,
					fontWeight: isActive ? 600 : 400,
					fontSize: '12px',
					fontFamily: 'inherit',
					lineHeight: 1,
					whiteSpace: 'nowrap',
					cursor: disabled ? 'not-allowed' : 'pointer',
					transition: 'background-color 0.2s ease, color 0.2s ease',
				}}>
				<Icon size={13} />
				{!compact && label}
				{side === 'local' && isActive && localWarning && <span aria-hidden>⚠</span>}
			</button>
		)
	}

	return (
		<div
			role="group"
			aria-label="Where meetings are kept"
			style={{
				display: 'flex',
				gap: '2px',
				padding: '3px',
				borderRadius: '8px',
				border: `1px solid ${theme.border}`,
				backgroundColor: theme.body,
				width: 'fit-content',
				opacity: disabled ? 0.5 : 1,
				flexShrink: 0,
			}}>
			{segment('local')}
			{segment('cloud')}
		</div>
	)
}

export default StorageToggle
