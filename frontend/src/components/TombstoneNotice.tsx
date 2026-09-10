import React from 'react'
import { AppTheme } from '../styles/theme'

/**
 * What someone sees when they open a meeting that is no longer on the server.
 *
 * A bare 404 is indistinguishable from a typo. Someone who read this meeting
 * last week and finds it missing today deserves to know which of the two
 * happened — and, when their browser still has the copy it cached while they
 * were reading, that the copy is now theirs.
 *
 * The wording turns on `reason`, because a share window closing on schedule is
 * a very different event from an owner revoking access.
 */

export interface Tombstone {
	id: string
	title: string
	removed_at: string
	reason: 'made_private' | 'expired' | 'deleted' | string
}

const when = (iso: string) =>
	new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

interface Props {
	theme: AppTheme
	tombstone: Tombstone
	/** True when a copy was found in this browser and promoted to a local meeting. */
	recovered: boolean
	onBack: () => void
	onOpenCopy: () => void
}

const TombstoneNotice: React.FC<Props> = ({ theme, tombstone, recovered, onBack, onOpenCopy }) => {
	const removed = when(tombstone.removed_at)

	const headline =
		tombstone.reason === 'expired'
			? 'The shared link expired.'
			: tombstone.reason === 'made_private'
				? 'This meeting was made private.'
				: 'This meeting is no longer available.'

	const body =
		tombstone.reason === 'expired'
			? `The link to “${tombstone.title}” stopped working on ${removed}.`
			: tombstone.reason === 'made_private'
				? `Whoever recorded “${tombstone.title}” removed it from the server on ${removed}.`
				: `“${tombstone.title}” was removed from the server on ${removed}.`

	return (
		<div
			style={{
				margin: '24px 0',
				padding: '20px 22px',
				borderRadius: '8px',
				border: `1px solid ${theme.border}`,
				backgroundColor: theme.background,
				color: theme.text,
			}}>
			<h2 style={{ margin: '0 0 8px', fontSize: '18px' }}>{headline}</h2>
			<p style={{ margin: '0 0 14px', color: theme.secondaryText, lineHeight: 1.55 }}>
				{body}{' '}
				{recovered
					? 'You still have the copy your browser saved while you were reading it, and it is now stored on this device as your own.'
					: "Your browser doesn't have a saved copy."}
			</p>
			<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
				{recovered ? (
					<button
						type="button"
						onClick={onOpenCopy}
						style={{
							padding: '7px 14px',
							borderRadius: '6px',
							border: '1px solid transparent',
							backgroundColor: theme.button.primary,
							color: theme.button.primaryText,
							font: 'inherit',
							cursor: 'pointer',
						}}>
						Got it
					</button>
				) : null}
				<button
					type="button"
					onClick={onBack}
					style={{
						padding: '7px 14px',
						borderRadius: '6px',
						border: `1px solid ${theme.border}`,
						backgroundColor: theme.backgroundSecondary,
						color: theme.text,
						font: 'inherit',
						cursor: 'pointer',
					}}>
					Back
				</button>
			</div>
		</div>
	)
}

export default TombstoneNotice
