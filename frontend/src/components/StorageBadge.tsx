import React from 'react'
import { AppTheme } from '../styles/theme'
import type { MeetingStorage } from '../utils/history'
import { shortRemaining } from '../local/publish'
import { LockIcon, ShareIcon, AlertIcon } from './Icons'

/**
 * Whether this meeting is private, in one glyph.
 *
 * Two states, not three. "Local" and "cloud" used to be the axis, which meant
 * the badge answered a question about our storage architecture rather than
 * about the user's meeting — and it answered it wrongly for a local meeting
 * with a live share link, which is private in the record and readable by
 * anyone with the URL. There is only one thing worth saying here: is there a
 * copy someone else could open?
 *
 *   lock   — only in this browser. Nobody else can reach it.
 *   share  — a copy is on the server. A cloud meeting is exactly this, with
 *            no expiry, which is what "in the cloud" has always meant.
 *
 * A glyph rather than a pill because it appears on every row of the history
 * list, where five outlined badges down the right-hand side read as an alert
 * each. The words live in the tooltip.
 *
 * The share glyph stays hidden for someone who has never used Local mode:
 * every one of their meetings is in the cloud, so marking all of them marks
 * nothing. A timed share is different — it is going to disappear — so that
 * one is always drawn, in the colour the app uses elsewhere for a clock.
 */

interface Props {
	storage: MeetingStorage
	theme: AppTheme
	/** True once the user has ever turned Local mode on. */
	loud: boolean
	size?: number
	title?: string
	/** ISO expiry of the shared copy, when this meeting is published. */
	sharedUntil?: string | null
	/**
	 * There is a copy on the server. Separate from `sharedUntil` because a
	 * share with no expiry has none — see `LocalMeeting.published`.
	 */
	published?: boolean
	/** The meeting was removed from the server; nothing is coming back. */
	gone?: boolean
}

const StorageBadge: React.FC<Props> = ({ storage, theme, loud, size = 12, title, sharedUntil, published, gone }) => {
	const isLocal = storage === 'local'
	const expiring = isLocal && !!sharedUntil
	// Private means private: a published local meeting is not, whether its
	// copy has a clock on it or stays until someone removes it.
	const isPrivate = isLocal && !expiring && !published

	// Staying quiet is only ever right for a cloud row. Anything to do with a
	// local meeting — private, or shared out of this browser — sits in a list
	// beside padlocks, where an unmarked row would read as a third state.
	if (!gone && !isLocal && !loud) return null

	const Icon = gone ? AlertIcon : isPrivate ? LockIcon : ShareIcon
	const colour = gone ? theme.button.danger : expiring ? '#f59e0b' : isPrivate ? theme.text : theme.secondaryText
	const label = gone
		? 'This meeting was removed from the server by whoever recorded it.'
		: expiring
			? `Shared — the copy on the server is deleted in ${shortRemaining(sharedUntil as string)}.`
			: isPrivate
				? 'Only in this browser. Never sent to the server.'
				: 'Shared — anyone with the link can read it.'

	return (
		<span
			role="img"
			aria-label={title ?? label}
			title={title ?? label}
			style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: colour, lineHeight: 1 }}>
			<Icon size={size} />
		</span>
	)
}

export default StorageBadge
