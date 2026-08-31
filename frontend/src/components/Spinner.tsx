import React from 'react'

interface SpinnerProps {
	/** Diameter in px. */
	size?: number
	/** Defaults to the surrounding text colour. */
	color?: string
	/** Announced to screen readers; omit for purely decorative use. */
	label?: string
}

/**
 * Small indeterminate spinner for waits with no meaningful percentage.
 * The rotation lives in index.css (.spinner) so it respects
 * prefers-reduced-motion.
 */
const Spinner: React.FC<SpinnerProps> = ({ size = 16, color = 'currentColor', label }) => (
	<svg
		className="spinner"
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		role={label ? 'status' : undefined}
		aria-label={label}
		aria-hidden={label ? undefined : true}
		style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0 }}>
		<circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2.5" strokeOpacity="0.25" />
		<path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
	</svg>
)

export default Spinner
