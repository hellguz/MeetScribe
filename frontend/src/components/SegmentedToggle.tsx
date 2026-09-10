import React from 'react'
import { AppTheme } from '../styles/theme'

/**
 * Two answers to one question, one of them filled in.
 *
 * The controls this replaced were single buttons that changed their own
 * border, or their own glyph, to mean "pressed". A lone button in a changed
 * state says so only to someone who watched it change; everyone else reads an
 * outline as a stray focus ring, and a swapped icon as just an icon. A
 * segmented pair has no state to infer — the answer is the segment that is
 * filled in, and the alternative is sitting next to it.
 *
 * Metrics come from `SummaryLengthSelector`, which is the app's existing
 * segmented control: a bordered track with 3–4px of padding, 5px-radius
 * segments, and the active one lifted with `backgroundSecondary`.
 *
 * Used for both of the app's two-state questions: where new meetings go
 * (`LocalModeToggle`) and whether this meeting is shared (the summary page's
 * toolbar). Labels are optional — a toolbar that is already full takes the
 * icons alone and puts the words in the tooltip.
 */

export interface Segment {
	value: string
	/** Omit for an icon-only segment. */
	label?: string
	/** Tooltip. Worth writing even when there is a label. */
	title?: string
	icon: React.FC<{ size?: number }>
	/** A caution marker, shown only while this segment is the active one. */
	warning?: boolean
	/**
	 * Colours the segment while it is the active one — glyph and ground both,
	 * so the state reads from across the toolbar rather than from a 13px
	 * icon. For the one state that has a clock on it: a share with an expiry,
	 * which the app colours amber wherever it appears.
	 */
	accent?: string
}

interface Props {
	theme: AppTheme
	/** Matches one segment's `value`. */
	value: string
	/** Exactly two, in reading order. */
	options: [Segment, Segment]
	onSelect: (value: string) => void
	disabled?: boolean
	ariaLabel: string
}

const SegmentedToggle: React.FC<Props> = ({ theme, value, options, onSelect, disabled = false, ariaLabel }) => (
	<div
		role="group"
		aria-label={ariaLabel}
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
		{options.map((option) => {
			const isActive = value === option.value
			const Icon = option.icon
			return (
				<button
					key={option.value}
					type="button"
					disabled={disabled}
					aria-pressed={isActive}
					title={option.title ?? option.label}
					aria-label={option.title ?? option.label}
					onClick={() => !disabled && onSelect(option.value)}
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						gap: '5px',
						padding: option.label ? '5px 10px' : '5px 8px',
						height: '26px',
						boxSizing: 'border-box',
						border: 'none',
						borderRadius: '5px',
						backgroundColor: isActive ? (option.accent ? `${option.accent}30` : theme.backgroundSecondary) : 'transparent',
						color: isActive ? (option.accent ?? theme.text) : theme.secondaryText,
						fontWeight: isActive ? 600 : 400,
						fontSize: '12px',
						fontFamily: 'inherit',
						lineHeight: 1,
						whiteSpace: 'nowrap',
						cursor: disabled ? 'not-allowed' : 'pointer',
						transition: 'background-color 0.2s ease, color 0.2s ease',
					}}>
					<Icon size={13} />
					{option.label}
					{isActive && option.warning && <span aria-hidden>⚠</span>}
				</button>
			)
		})}
	</div>
)

export default SegmentedToggle
