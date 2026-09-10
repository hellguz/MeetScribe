import React, { useSyncExternalStore } from 'react'
import { AppTheme } from '../styles/theme'
import { getLocalActivity, subscribeLocalActivity } from '../local/activity'

/**
 * "Writing summary · 41%", in a pill the size of the theme toggle.
 *
 * On-device work takes minutes and shows nothing while it does, which is
 * indistinguishable from a hung tab. This says what is happening in two or
 * three words and how far along it is, and then gets out of the way: nothing
 * is rendered at all while the device is idle.
 *
 * The ring is drawn rather than animated so that a determinate stage reads as
 * a fraction at a glance; an indeterminate one spins the same circle instead,
 * reusing `Spinner`'s rotation so the two look related.
 */

const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const Ring: React.FC<{ progress: number | null; color: string; track: string }> = ({ progress, color, track }) => (
	// `.spinner` is the app's own rotation, and it already backs off under
	// prefers-reduced-motion — so an indeterminate ring spins the whole svg
	// rather than introducing a second set of keyframes. The track circle is
	// symmetric, so rotating it changes nothing.
	<svg
		className={progress === null ? 'spinner' : undefined}
		width={14}
		height={14}
		viewBox="0 0 14 14"
		style={{ flexShrink: 0, display: 'block' }}
		aria-hidden>
		<circle cx="7" cy="7" r={RADIUS} fill="none" stroke={track} strokeWidth="2" />
		<circle
			cx="7"
			cy="7"
			r={RADIUS}
			fill="none"
			stroke={color}
			strokeWidth="2"
			strokeLinecap="round"
			// An indeterminate ring is a quarter arc; a determinate one is the
			// fraction itself, starting at 12 o'clock like any progress dial.
			strokeDasharray={`${CIRCUMFERENCE * (progress === null ? 0.25 : Math.min(1, Math.max(0, progress)))} ${CIRCUMFERENCE}`}
			transform="rotate(-90 7 7)"
		/>
	</svg>
)

interface Props {
	theme: AppTheme
}

const LocalActivityBadge: React.FC<Props> = ({ theme }) => {
	/**
	 * `useSyncExternalStore`, not `useState` + `useEffect`, because the naive
	 * pair loses exactly one update and it is the one that matters.
	 *
	 * On a route change React renders the new page (this badge reads the slot
	 * — still holding the old page's "Loading model") *before* it runs the old
	 * page's cleanup, which is what clears the slot. That clear is broadcast
	 * to subscribers, and this badge has not subscribed yet, so it misses it.
	 * The next writer then finds the slot already null and coalesces its own
	 * update away, so nothing ever tells the badge again: it sat there naming
	 * a model load belonging to a page the reader had left.
	 *
	 * This hook re-reads the snapshot after subscribing, which is the whole
	 * reason it exists.
	 */
	const activity = useSyncExternalStore(subscribeLocalActivity, getLocalActivity, getLocalActivity)

	if (!activity) return null

	const percent = activity.progress === null ? null : Math.round(Math.min(1, Math.max(0, activity.progress)) * 100)

	return (
		<span
			title={activity.detail ?? `${activity.label}${percent === null ? '' : ` — ${percent}%`} · running on this device`}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: '6px',
				flexShrink: 0,
				maxWidth: '190px',
				whiteSpace: 'nowrap',
				padding: '5px 9px',
				borderRadius: '999px',
				border: `1px solid ${theme.border}`,
				backgroundColor: theme.backgroundSecondary,
				color: theme.secondaryText,
				fontSize: '11px',
				lineHeight: 1,
			}}>
			<Ring progress={activity.progress} color={theme.text} track={theme.border} />
			<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{activity.label}</span>
			{percent !== null && <span style={{ fontVariantNumeric: 'tabular-nums', color: theme.text }}>{percent}%</span>}
		</span>
	)
}

export default LocalActivityBadge
