import React, { useState, useEffect, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { ThemeContext } from '../contexts/ThemeContext'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'

// --- Type definitions for our new complex stats object ---
interface StatSet {
	total_summaries: number
	total_words: number
	total_hours: number
}
interface FeatureSuggestion {
	suggestion: string
	submitted_at: string
	meeting_id: string
	meeting_title: string
}
interface UsageTimelinePoint {
	date: string
	count: number
}
interface DashboardStats {
	all_time: StatSet
	today: StatSet
	device_distribution: { [key: string]: number }
	feedback_counts: { [key: string]: number }
	feature_suggestions: FeatureSuggestion[]
	usage_timeline: UsageTimelinePoint[]
}

// --- Reusable Components for the Dashboard ---

const StatCard = ({ title, value, icon, color }) => (
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

const BarChart = ({ data, title, theme }) => {
	const maxValue = Math.max(...Object.values(data))
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
									width: `${(value / maxValue) * 100}%`,
									backgroundColor: theme.button.primary,
									height: '20px',
									borderRadius: '4px',
									transition: 'width 0.5s ease-out',
								}}></div>
						</div>
						<span style={{ fontSize: '12px', fontWeight: 'bold' }}>{value}</span>
					</div>
				))}
			</div>
		</div>
	)
}

const PieChart = ({ data, theme }) => {
	const colors = {
		accurate: '#22c55e',
		too_short: '#facc15',
		too_detailed: '#f59e0b',
		general: '#fbbf24',
		inaccurate: '#ef4444',
		feature_suggestion: '#3b82f6',
	}
	const total = Object.values(data).reduce((acc: number, val) => acc + (val as number), 0)
	if (total === 0) return <div style={{ textAlign: 'center', color: theme.secondaryText, padding: '40px 0' }}>No feedback data for chart.</div>

	let cumulativePercent = 0
	const segments = Object.entries(data).map(([key, value]) => {
		const percent = (value / total) * 100
		const startAngle = (cumulativePercent / 100) * 360
		cumulativePercent += percent
		const endAngle = (cumulativePercent / 100) * 360

		const startX = 50 + 40 * Math.cos(((startAngle - 90) * Math.PI) / 180)
		const startY = 50 + 40 * Math.sin(((startAngle - 90) * Math.PI) / 180)
		const endX = 50 + 40 * Math.cos(((endAngle - 90) * Math.PI) / 180)
		const endY = 50 + 40 * Math.sin(((endAngle - 90) * Math.PI) / 180)
		const largeArcFlag = percent > 50 ? 1 : 0

		return {
			key,
			value,
			percent: percent.toFixed(1),
			color: colors[key] || '#9ca3af',
			path: `M ${startX} ${startY} A 40 40 0 ${largeArcFlag} 1 ${endX} ${endY}`,
		}
	})

	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
			<svg viewBox="0 0 100 100" width="150" height="150">
				{segments.map((seg) => (
					<path key={seg.key} d={seg.path} stroke={seg.color} strokeWidth="20" fill="none" />
				))}
			</svg>
			<div style={{ flex: 1, minWidth: '200px' }}>
				{segments.map((seg) => (
					<div key={seg.key} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '14px' }}>
						<span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: seg.color, marginRight: '8px' }}></span>
						<span style={{ color: theme.text, textTransform: 'capitalize' }}>{seg.key.replace(/_/g, ' ')}:</span>
						<span style={{ marginLeft: 'auto', fontWeight: 'bold', color: theme.text }}>
							{seg.value} ({seg.percent}%)
						</span>
					</div>
				))}
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
		red: { bg: theme === 'light' ? '#fef2f2' : '#451a1a', border: theme === 'light' ? '#fecaca' : '#b91c1c', text: theme === 'light' ? '#b91c1c' : '#fecaca' },
		yellow: {
			bg: theme === 'light' ? '#fefce8' : '#3d3c1a',
			border: theme === 'light' ? '#fde047' : '#a16207',
			text: theme === 'light' ? '#a16207' : '#fde047',
		},
	}

	if (isLoading) return <div style={{ color: currentThemeColors.text, textAlign: 'center', paddingTop: '50px' }}>Loading Dashboard...</div>
	if (error) return <div style={{ color: 'red', textAlign: 'center', paddingTop: '50px' }}>Error: {error}</div>
	if (!stats) return <div style={{ color: currentThemeColors.text, textAlign: 'center', paddingTop: '50px' }}>No stats available.</div>

	const displayStats = stats[timeframe]
	const needsImprovementCount =
		(stats.feedback_counts.inaccurate || 0) +
		(stats.feedback_counts.too_short || 0) +
		(stats.feedback_counts.too_detailed || 0) +
		(stats.feedback_counts.general || 0)

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

			<header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
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

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '20px' }}>
				<StatCard title="Summaries Generated" value={displayStats.total_summaries} icon="📝" color={cardColors.blue} />
				<StatCard title="Words Transcribed" value={displayStats.total_words} icon="✍️" color={cardColors.amber} />
				<StatCard title="Hours Recorded" value={displayStats.total_hours} icon="⏱️" color={cardColors.green} />
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: '20px' }}>
				<div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}` }}>
					<PieChart data={stats.feedback_counts} theme={currentThemeColors} />
				</div>

				<div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}` }}>
					<BarChart title="Device Types" data={stats.device_distribution} theme={currentThemeColors} />
				</div>

				<div
					style={{
						gridColumn: '1 / -1',
						backgroundColor: currentThemeColors.body,
						padding: '20px',
						borderRadius: '12px',
						border: `1px solid ${currentThemeColors.border}`,
					}}>
					<h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 500 }}>💡 Feature Suggestions</h3>
					<div style={{ maxHeight: '300px', overflowY: 'auto' }}>
						{stats.feature_suggestions.length > 0 ? (
							<ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
								{stats.feature_suggestions.map((item, index) => (
									<li
										key={index}
										onClick={() => navigate(`/summary/${item.meeting_id}`)}
										style={{ padding: '12px', borderBottom: `1px solid ${currentThemeColors.backgroundSecondary}`, cursor: 'pointer' }}>
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
		</div>
	)
}
