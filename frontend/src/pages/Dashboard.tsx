import React, { useState, useEffect, useContext, useMemo } from 'react'
import { useNavigate, NavigateFunction } from 'react-router-dom'
import { ThemeContext } from '../contexts/ThemeContext'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'

// --- Type definitions ---
interface StatSet {
	total_summaries: number
	total_words: number
	total_hours: number
}

interface Feedback {
	type: string
	suggestion: string | null
	created_at: string
}

interface MeetingWithFeedback {
	id: string
	title: string
	started_at: string
	feedback: Feedback[]
}

interface FeatureSuggestion {
	suggestion: string
	submitted_at: string
	meeting_id: string
	meeting_title: string
}
interface DashboardStats {
	all_time: StatSet
	today: StatSet
	device_distribution: { [key: string]: number }
	feedback_counts: { [key: string]: number }
	feature_suggestions: FeatureSuggestion[]
	meetings_with_feedback: MeetingWithFeedback[]
}

// --- Reusable Components with Types ---
interface StatCardProps {
	title: string
	value: number
	icon: string
	color: { bg: string; border: string; text: string }
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color }) => (
	<div
		style={{
			backgroundColor: color.bg,
			padding: '20px',
			borderRadius: '12px',
			border: `1px solid ${color.border}`,
			display: 'flex',
			flexDirection: 'column',
		}}>
		<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', color: color.text }}>
			<h3 style={{ margin: 0, fontSize: '16px', fontWeight: 500 }}>{title}</h3>
			<span style={{ fontSize: '24px', opacity: 0.8 }}>{icon}</span>
		</div>
		<p style={{ margin: '8px 0 0 0', fontSize: '36px', fontWeight: 'bold', color: color.text }}>{value.toLocaleString()}</p>
	</div>
)

interface BarChartProps {
	data: { [key: string]: number }
	title: string
	theme: AppTheme
}
const BarChart: React.FC<BarChartProps> = ({ data, title, theme }) => {
	const maxValue = Math.max(...(Object.values(data) as number[]))
	if (maxValue === 0) {
		return (
			<div>
				<h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>{title}</h3>
				<p style={{ color: theme.secondaryText, textAlign: 'center' }}>No device data available.</p>
			</div>
		)
	}
	return (
		<div>
			<h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>{title}</h3>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
				{Object.entries(data).map(([key, value]) => (
					<div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
						<span style={{ width: '80px', fontSize: '12px', color: theme.secondaryText, textAlign: 'right', flexShrink: 0 }}>{key}</span>
						<div style={{ flexGrow: 1, backgroundColor: theme.backgroundSecondary, borderRadius: '4px' }}>
							<div
								style={{
									width: `${((value as number) / maxValue) * 100}%`,
									backgroundColor: theme.button.primary,
									height: '20px',
									borderRadius: '4px',
									transition: 'width 0.5s ease-out',
								}}></div>
						</div>
						<span style={{ fontSize: '12px', fontWeight: 'bold' }}>{value as number}</span>
					</div>
				))}
			</div>
		</div>
	)
}

interface FeedbackTableProps {
	meetings: MeetingWithFeedback[]
	theme: AppTheme
	navigate: NavigateFunction
}

const FeedbackTable: React.FC<FeedbackTableProps> = ({ meetings, theme, navigate }) => {
	const [activeFilters, setActiveFilters] = useState<string[]>([])

	const feedbackColors = useMemo(() => {
		const light = {
			accurate: { text: '#057a55', bg: '#def7ec', border: '#a7f3d0' },
			inaccurate: { text: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
			too_short: { text: '#b45309', bg: '#fffbeb', border: '#fde68a' },
			too_detailed: { text: '#b45309', bg: '#fffbeb', border: '#fde68a' },
			general: { text: '#b45309', bg: '#fffbeb', border: '#fde68a' },
			'💡 Suggestion': { text: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
		}
		const dark = {
			accurate: { text: '#a7f3d0', bg: '#143623', border: '#15803d' },
			inaccurate: { text: '#fecaca', bg: '#451a1a', border: '#b91c1c' },
			too_short: { text: '#fde68a', bg: '#422006', border: '#b45309' },
			too_detailed: { text: '#fde68a', bg: '#422006', border: '#b45309' },
			general: { text: '#fde68a', bg: '#422006', border: '#b45309' },
			'💡 Suggestion': { text: '#bfdbfe', bg: '#1e3a8a', border: '#1e40af' },
		}
		return theme.text === lightTheme.text ? light : dark
	}, [theme])

	const allFeedbackTypes = useMemo(() => {
		const types = new Set<string>()
		meetings.forEach((m: MeetingWithFeedback) => m.feedback.forEach((f: Feedback) => f.type !== 'feature_suggestion' && types.add(f.type)))
		return Array.from(types).sort()
	}, [meetings])

	const filteredMeetings = useMemo(() => {
		if (activeFilters.length === 0) return meetings
		return meetings.filter((m: MeetingWithFeedback) => m.feedback.some((f: Feedback) => activeFilters.includes(f.type)))
	}, [meetings, activeFilters])

	const toggleFilter = (type: string) => {
		setActiveFilters((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
	}

	const getLabel = (type: string) => type.replace(/_/g, ' ')

	const feedbackPill = (type: string, key: number | string) => {
		const label = getLabel(type)
		const colors = feedbackColors[type] || { text: theme.text, bg: theme.backgroundSecondary, border: theme.border }
		return (
			<span
				key={key}
				style={{
					display: 'inline-block',
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
						const colors = feedbackColors[type] || { text: theme.text, bg: theme.backgroundSecondary, border: theme.border }

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
							<th style={{ padding: '12px', textAlign: 'left', borderBottom: `1px solid ${theme.border}` }}>Meeting</th>
							<th style={{ padding: '12px', textAlign: 'left', borderBottom: `1px solid ${theme.border}` }}>Date</th>
							<th style={{ padding: '12px', textAlign: 'left', borderBottom: `1px solid ${theme.border}` }}>Feedback Received</th>
						</tr>
					</thead>
					<tbody>
						{filteredMeetings.length > 0 ? (
							filteredMeetings.map((meeting: MeetingWithFeedback) => (
								<tr
									key={meeting.id}
									onClick={() => navigate(`/summary/${meeting.id}`)}
									style={{
										cursor: 'pointer',
										backgroundColor: theme.body,
										transition: 'background-color 0.2s ease',
									}}
									onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.background)}
									onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.body)}>
									<td style={{ padding: '12px', fontWeight: 500, borderBottom: `1px solid ${theme.border}` }}>{meeting.title}</td>
									<td style={{ padding: '12px', whiteSpace: 'nowrap', borderBottom: `1px solid ${theme.border}` }}>
										{new Date(meeting.started_at).toLocaleDateString()}
									</td>
									<td style={{ padding: '12px', borderBottom: `1px solid ${theme.border}` }}>
										<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
											{meeting.feedback.map((f: Feedback, i: number) => {
												if (f.type === 'feature_suggestion') {
													return feedbackPill('💡 Suggestion', `sugg-${i}`)
												}
												return feedbackPill(f.type, i)
											})}
										</div>
									</td>
								</tr>
							))
						) : (
							<tr>
								<td colSpan={3} style={{ textAlign: 'center', padding: '20px', color: theme.secondaryText }}>
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

// --- Main Dashboard Component ---
export default function Dashboard() {
	const navigate = useNavigate()
	const themeContext = useContext(ThemeContext)
	if (!themeContext) throw new Error('ThemeContext not found')
	const { theme } = themeContext
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme

	const [stats, setStats] = useState<DashboardStats | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [timeframe, setTimeframe] = useState<'all_time' | 'today'>('all_time')

	useEffect(() => {
		document.body.style.backgroundColor = currentThemeColors.background
	}, [currentThemeColors])

	useEffect(() => {
		const fetchStats = async () => {
			try {
				const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/dashboard/stats`)
				if (!response.ok) throw new Error('Failed to fetch dashboard stats.')
				const data = await response.json()
				setStats(data)
			} catch (err) {
				setError(err instanceof Error ? err.message : 'An unknown error occurred.')
			} finally {
				setIsLoading(false)
			}
		}
		fetchStats()
	}, [])

	const cardColors = {
		green: {
			bg: theme === 'light' ? '#f0fdf4' : '#143623',
			border: theme === 'light' ? '#a7f3d0' : '#15803d',
			text: theme === 'light' ? '#15803d' : '#a7f3d0',
		},
		blue: { bg: theme === 'light' ? '#eff6ff' : '#1e3a8a', border: theme === 'light' ? '#bfdbfe' : '#1e40af', text: theme === 'light' ? '#1d4ed8' : '#bfdbfe' },
		amber: {
			bg: theme === 'light' ? '#fffbeb' : '#422006',
			border: theme === 'light' ? '#fde68a' : '#b45309',
			text: theme === 'light' ? '#b45309' : '#fde68a',
		},
	}

	if (isLoading) return <div style={{ color: currentThemeColors.text, textAlign: 'center', paddingTop: '50px' }}>Loading Dashboard...</div>
	if (error) return <div style={{ color: 'red', textAlign: 'center', paddingTop: '50px' }}>Error: {error}</div>
	if (!stats) return <div style={{ color: currentThemeColors.text, textAlign: 'center', paddingTop: '50px' }}>No stats available.</div>

	const displayStats = stats[timeframe]

	return (
		<div
			style={{
				backgroundColor: currentThemeColors.background,
				color: currentThemeColors.text,
				padding: '24px',
				fontFamily: "'Inter', sans-serif",
				minHeight: '100vh',
			}}>
			<button
				onClick={() => navigate('/record')}
				style={{
					background: 'none',
					border: 'none',
					cursor: 'pointer',
					color: currentThemeColors.secondaryText,
					fontSize: '15px',
					display: 'inline-flex',
					alignItems: 'center',
					gap: '8px',
					padding: '0',
					marginBottom: '24px',
				}}>
				← Back to Recordings
			</button>

			<header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
				<div>
					<h1 style={{ margin: '0 0 4px 0', fontSize: '28px', fontWeight: 'bold' }}>Dashboard</h1>
					<p style={{ margin: 0, color: currentThemeColors.secondaryText }}>Platform usage and feedback overview.</p>
				</div>
				<div style={{ display: 'flex', backgroundColor: currentThemeColors.backgroundSecondary, borderRadius: '8px', padding: '4px' }}>
					<button
						onClick={() => setTimeframe('today')}
						style={{
							padding: '6px 12px',
							border: 'none',
							borderRadius: '6px',
							backgroundColor: timeframe === 'today' ? currentThemeColors.body : 'transparent',
							color: currentThemeColors.text,
							cursor: 'pointer',
						}}>
						Today
					</button>
					<button
						onClick={() => setTimeframe('all_time')}
						style={{
							padding: '6px 12px',
							border: 'none',
							borderRadius: '6px',
							backgroundColor: timeframe === 'all_time' ? currentThemeColors.body : 'transparent',
							color: currentThemeColors.text,
							cursor: 'pointer',
						}}>
						All-Time
					</button>
				</div>
			</header>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '32px' }}>
				<StatCard title="Summaries Generated" value={displayStats.total_summaries} icon="📝" color={cardColors.blue} />
				<StatCard title="Words Transcribed" value={displayStats.total_words} icon="✍️" color={cardColors.amber} />
				<StatCard title="Hours Recorded" value={displayStats.total_hours} icon="⏱️" color={cardColors.green} />
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '32px' }}>
				<div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}` }}>
					<BarChart title="Device Types" data={stats.device_distribution} theme={currentThemeColors} />
				</div>
				<div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}` }}>
					<h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>Feature Suggestions</h3>
					<div style={{ maxHeight: '300px', overflowY: 'auto' }}>
						{stats.feature_suggestions.length > 0 ? (
							<ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
								{stats.feature_suggestions.map((item: FeatureSuggestion, index: number) => (
									<li
										key={index}
										onClick={() => navigate(`/summary/${item.meeting_id}`)}
										style={{
											padding: '12px',
											borderBottom: `1px solid ${currentThemeColors.backgroundSecondary}`,
											cursor: 'pointer',
											transition: 'background-color 0.2s ease',
										}}
										onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
										onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
										<p style={{ margin: 0, fontWeight: 500 }}>{item.suggestion}</p>
										<p style={{ margin: '4px 0 0', fontSize: '12px', color: currentThemeColors.secondaryText }}>
											From: <span style={{ fontWeight: '500' }}>{item.meeting_title}</span>
										</p>
									</li>
								))}
							</ul>
						) : (
							<p style={{ color: currentThemeColors.secondaryText, textAlign: 'center', padding: '20px 0' }}>No feature suggestions submitted yet.</p>
						)}
					</div>
				</div>
			</div>
			<div
				style={{
					marginTop: '32px',
					backgroundColor: currentThemeColors.body,
					padding: '20px',
					borderRadius: '12px',
					border: `1px solid ${currentThemeColors.border}`,
				}}>
				<h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 'bold' }}>Feedback Log</h2>
				<FeedbackTable meetings={stats.meetings_with_feedback} theme={currentThemeColors} navigate={navigate} />
			</div>
		</div>
	)
}
