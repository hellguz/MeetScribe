import React, { useState, useMemo } from 'react'
import { formatMeetingDateShort } from '../../utils/datetime'
import { AppTheme } from '../../styles/theme'
import { FeedbackLogEntry, Feedback } from '../../types'
import { getFeedbackColors } from '../../utils/feedbackColors'

type FeedbackColorEntry = { text: string; bg: string; border: string }
type FeedbackColorMap = Record<string, FeedbackColorEntry | undefined>

/**
 * The public feedback log. Each row is one meeting's worth of feedback, but
 * the meeting itself is not named: a title can give away who met about what,
 * and an id would let anyone open the transcript.
 */
interface FeedbackTableProps {
	entries: FeedbackLogEntry[]
	theme: AppTheme
}

const FeedbackTable: React.FC<FeedbackTableProps> = ({ entries: meetings, theme }) => {
	const [activeFilters, setActiveFilters] = useState<string[]>([])
	const feedbackColors = useMemo(() => getFeedbackColors(theme), [theme])

	const allFeedbackTypes = useMemo(() => {
		const types = new Set<string>()
		meetings.forEach((m) => m.feedback.forEach((f) => f.type !== 'feature_suggestion' && types.add(f.type)))
		return Array.from(types).sort()
	}, [meetings])

	const filteredMeetings = useMemo(() => {
		if (activeFilters.length === 0) return meetings
		return meetings.filter((m) => m.feedback.some((f) => activeFilters.includes(f.type)))
	}, [meetings, activeFilters])

	const toggleFilter = (type: string) => {
		setActiveFilters((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
	}

	const getLabel = (type: string) => type.replace(/_/g, ' ')

	const FeedbackPill: React.FC<{ feedback: Feedback }> = ({ feedback }) => {
		const type = feedback.type === 'feature_suggestion' ? '💡 Suggestion' : feedback.type
		const label = getLabel(type)
		const colors = (feedbackColors as FeedbackColorMap)[type] ?? { text: theme.text, bg: theme.backgroundSecondary, border: theme.border }

		return (
			<span
				title={feedback.suggestion ?? undefined}
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					padding: '4px 8px',
					borderRadius: '12px',
					fontSize: '12px',
					fontWeight: 500,
					backgroundColor: colors.bg,
					color: colors.text,
					border: `1px solid ${colors.border}`,
					whiteSpace: 'nowrap',
				}}>
				{label}
			</span>
		)
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
			<div>
				<h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 500 }}>Filter by Feedback</h3>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
					{allFeedbackTypes.map((type) => {
						const isActive = activeFilters.includes(type)
						const colors = (feedbackColors as FeedbackColorMap)[type] ?? { text: theme.text, bg: theme.backgroundSecondary, border: theme.border }
						return (
							<button
								key={type}
								onClick={() => toggleFilter(type)}
								style={{
									padding: '6px 12px',
									border: `1.5px solid ${colors.border}`,
									borderRadius: '16px',
									cursor: 'pointer',
									backgroundColor: isActive ? colors.bg : 'transparent',
									color: isActive ? colors.text : theme.text,
									fontWeight: isActive ? 600 : 400,
									transition: 'all 0.2s ease',
								}}>
								{getLabel(type)}
							</button>
						)
					})}
					{activeFilters.length > 0 && (
						<button
							onClick={() => setActiveFilters([])}
							style={{ border: 'none', background: 'none', color: theme.secondaryText, cursor: 'pointer', textDecoration: 'underline' }}>
							Clear
						</button>
					)}
				</div>
			</div>
			<div style={{ maxHeight: '600px', overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: '8px' }}>
				<table style={{ width: '100%', borderCollapse: 'collapse' }}>
					<thead style={{ position: 'sticky', top: 0, zIndex: 1, background: theme.background, backdropFilter: 'blur(5px)' }}>
						<tr>
							<th style={{ padding: '12px', textAlign: 'left', borderBottom: `1px solid ${theme.border}` }}>Date</th>
							<th style={{ padding: '12px', textAlign: 'left', borderBottom: `1px solid ${theme.border}` }}>Feedback Received</th>
						</tr>
					</thead>
					<tbody>
						{filteredMeetings.length > 0 ? (
							filteredMeetings.map((meeting, i) => (
								<tr key={`${meeting.started_at}-${i}`} style={{ backgroundColor: theme.body }}>
									<td style={{ padding: '12px', whiteSpace: 'nowrap', borderBottom: `1px solid ${theme.border}` }}>
										{formatMeetingDateShort(meeting.started_at)}
									</td>
									<td style={{ padding: '12px', borderBottom: `1px solid ${theme.border}` }}>
										<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
											{meeting.feedback.map((f) => (
												<FeedbackPill key={f.id} feedback={f} />
											))}
										</div>
									</td>
								</tr>
							))
						) : (
							<tr>
								<td colSpan={2} style={{ textAlign: 'center', padding: '20px', color: theme.secondaryText }}>
									No meetings match the selected filters.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	)
}

export default FeedbackTable
