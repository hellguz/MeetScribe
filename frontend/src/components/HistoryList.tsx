import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MeetingMeta } from '../utils/history'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'
import { useTheme } from '../contexts/ThemeContext'

interface HistoryListProps {
	history: MeetingMeta[]
	onTitleUpdate: (id: string, newTitle: string) => Promise<void>
	onDelete: (id: string) => Promise<void>
}

const HistoryList: React.FC<HistoryListProps> = ({ history, onTitleUpdate, onDelete }) => {
	const navigate = useNavigate()
	const { theme } = useTheme()
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme
	const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null)
	const [editingTitle, setEditingTitle] = useState<string>('')
	const [hoveredMeetingId, setHoveredMeetingId] = useState<string | null>(null)

	const handleTitleChangeConfirm = async () => {
		if (!editingMeetingId || !editingTitle.trim()) {
			setEditingMeetingId(null)
			setEditingTitle('')
			return
		}
		await onTitleUpdate(editingMeetingId, editingTitle.trim())
		setEditingMeetingId(null)
		setEditingTitle('')
	}

	const handleDeleteClick = (id: string) => {
		if (window.confirm('Are you sure you want to permanently delete this meeting and its summary? This cannot be undone.')) {
			onDelete(id)
		}
	}

	if (history.length === 0) {
		return null
	}

	return (
		<div style={{ marginTop: '40px', marginBottom: '20px' }}>
			<h2 style={{ margin: '12px 0 12px 0', fontSize: 16, textAlign: 'center', color: currentThemeColors.text }}>Previous Meetings</h2>
			<ul style={{ listStyle: 'none', padding: 0, margin: 0, border: `1px solid ${currentThemeColors.border}`, borderRadius: '8px' }}>
				{history.map((m, index) => (
					<li
						key={m.id}
						style={{
							padding: '12px 12px',
							borderBottom: index === history.length - 1 ? 'none' : `1px solid ${currentThemeColors.border}`,
							color: currentThemeColors.text,
						}}
						onMouseEnter={() => setHoveredMeetingId(m.id)}
						onMouseLeave={() => setHoveredMeetingId(null)}>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
							{editingMeetingId === m.id ? (
								<input
									type="text"
									value={editingTitle}
									onChange={(e) => setEditingTitle(e.target.value)}
									onBlur={handleTitleChangeConfirm}
									onKeyDown={(e) => {
										if (e.key === 'Enter') handleTitleChangeConfirm()
										else if (e.key === 'Escape') setEditingMeetingId(null)
										e.stopPropagation()
									}}
									onClick={(e) => e.stopPropagation()}
									style={{
										flexGrow: 1,
										padding: '4px 8px',
										fontSize: '1em',
										marginRight: '10px',
										border: `1px solid ${currentThemeColors.input.border}`,
										borderRadius: '4px',
										backgroundColor: currentThemeColors.input.background,
										color: currentThemeColors.input.text,
									}}
									autoFocus
								/>
							) : (
								<>
									<span style={{ fontWeight: 500, flexGrow: 1, cursor: 'pointer', fontSize: '0.9em' }} onClick={() => navigate(`/summary/${m.id}`)}>
										{m.title}
									</span>
									<div
										style={{
											display: 'flex',
											alignItems: 'center',
											visibility: hoveredMeetingId === m.id ? 'visible' : 'hidden',
											borderRadius: '6px',
											overflow: 'hidden',
											border: `1px solid ${currentThemeColors.border}`,
											backgroundColor: currentThemeColors.backgroundSecondary,
										}}>
										<button
											onClick={(e) => {
												e.stopPropagation()
												setEditingMeetingId(m.id)
												setEditingTitle(m.title)
											}}
											title="Edit title"
											style={{
												padding: '5px 7px',
												border: 'none',
												backgroundColor: 'transparent',
												color: currentThemeColors.secondaryText,
												cursor: 'pointer',
												lineHeight: 1,
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												transition: 'background-color 0.2s ease',
											}}
											onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
											onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
												<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
												<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
											</svg>
										</button>
										<div style={{ width: '1px', backgroundColor: currentThemeColors.border }} />
										<button
											onClick={(e) => {
												e.stopPropagation()
												handleDeleteClick(m.id)
											}}
											title="Delete meeting"
											style={{
												padding: '5px 7px',
												border: 'none',
												backgroundColor: 'transparent',
												color: currentThemeColors.secondaryText,
												cursor: 'pointer',
												lineHeight: 1,
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												transition: 'background-color 0.2s ease',
											}}
											onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)}
											onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
												<polyline points="3 6 5 6 21 6" />
												<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
												<path d="M10 11v6" />
												<path d="M14 11v6" />
												<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
											</svg>
										</button>
									</div>
								</>
							)}
							<div style={{ display: 'flex', alignItems: 'center', marginLeft: '10px', flexShrink: 0 }}>
								{m.status === 'pending' && (
									<span
										style={{
											marginRight: 8,
											color: theme === 'light' ? '#b45309' : '#fde047',
											backgroundColor: theme === 'light' ? '#fef3c7' : '#422006',
											padding: '2px 6px',
											borderRadius: '4px',
											fontSize: 12,
											fontWeight: '500',
										}}>
										Pending
									</span>
								)}
								{m.status === 'complete' && (
									<span
										style={{
											marginRight: 8,
											color: theme === 'light' ? '#057a55' : '#34d399',
											backgroundColor: theme === 'light' ? '#def7ec' : '#047481',
											padding: '2px 6px',
											borderRadius: '4px',
											fontSize: 12,
											fontWeight: '500',
										}}>
										Complete
									</span>
								)}
								<span
									style={{ fontStyle: 'italic', color: currentThemeColors.secondaryText, fontSize: 14, cursor: 'pointer' }}
									onClick={() => navigate(`/summary/${m.id}`)}>
									{new Date(m.started_at).toLocaleDateString()}
								</span>
							</div>
						</div>
					</li>
				))}
			</ul>
		</div>
	)
}

export default HistoryList
