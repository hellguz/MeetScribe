import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MeetingMeta } from '../utils/history'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'
import { useTheme } from '../contexts/ThemeContext'
import { EditIcon, TrashIcon } from './Icons'
import FavoriteButton from './FavoriteButton'
import TagsManager from './TagsManager'
import { isFavorite as checkFavorite, toggleFavorite, getMeetingTagIds, toggleMeetingTag } from '../utils/tags'

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

	// Force re-render when favorites/tags change
	const [, setTick] = useState(0)
	const refresh = useCallback(() => setTick((t) => t + 1), [])

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
				{history.map((m, index) => {
					const fav = checkFavorite(m.id)
					const tagIds = getMeetingTagIds(m.id)
					const isHovered = hoveredMeetingId === m.id
					const hasTags = tagIds.length > 0
					// Show the fav/tags wrapper whenever there are dots, a star, or hover
					const showFavTags = hasTags || fav || isHovered

					return (
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
										<div style={{ flexGrow: 1, cursor: 'pointer', minWidth: 0 }} onClick={() => navigate(`/summary/${m.id}`)}>
											<span style={{ fontWeight: 500, fontSize: '0.9em', display: 'block' }}>{m.title}</span>
											<span style={{ fontSize: 12, color: currentThemeColors.secondaryText, fontStyle: 'italic' }}>
												{new Date(m.started_at).toLocaleDateString()}
											</span>
										</div>
										<div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
											{/* Edit/Delete group - only on hover */}
											<div
												className="history-edit-delete"
												style={{
													display: 'flex',
													alignItems: 'center',
													visibility: isHovered ? 'visible' : 'hidden',
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
													<EditIcon />
												</button>
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
													<TrashIcon />
												</button>
											</div>
											{/* Tags & Favorite - visible when dots/star present or hovered; individual items control own visibility */}
											<div
												className="history-fav-tags"
												style={{
													display: 'flex',
													alignItems: 'center',
													gap: '0',
													visibility: showFavTags ? 'visible' : 'hidden',
												}}>
												<TagsManager
													selectedTagIds={tagIds}
													onToggleTag={(tagId) => {
														toggleMeetingTag(m.id, tagId)
														refresh()
													}}
													onTagsChanged={refresh}
													theme={currentThemeColors}
													ghost
													iconVisible={isHovered}
												/>
												<FavoriteButton
													isFavorite={fav}
													onToggle={() => {
														toggleFavorite(m.id)
														refresh()
													}}
													theme={currentThemeColors}
													ghost
													visible={fav || isHovered}
												/>
											</div>
										</div>
									</>
								)}
							</div>
						</li>
					)
				})}
			</ul>
		</div>
	)
}

export default HistoryList
