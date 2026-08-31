import React, { useState, useCallback } from 'react'
import { formatMeetingDateTimeShort } from '../utils/datetime'
import { useNavigate } from 'react-router-dom'
import { MeetingMeta } from '../utils/history'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'
import { useTheme } from '../contexts/ThemeContext'
import { EditIcon, TrashIcon } from './Icons'
import FavoriteButton from './FavoriteButton'
import TagsManager from './TagsManager'
import { isFavorite as checkFavorite, toggleFavorite, getMeetingTagIds, toggleMeetingTag, getTags } from '../utils/tags'
import { StarIcon } from './Icons'

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

	const [favouritesOnly, setFavouritesOnly] = useState(false)
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])

	const allTags = getTags()
	// A tag deleted while still selected would otherwise filter everything out.
	const activeTagIds = selectedTagIds.filter((id) => allTags.some((tag) => tag.id === id))
	const filtersActive = favouritesOnly || activeTagIds.length > 0

	const visible = history.filter((m) => {
		if (favouritesOnly && !checkFavorite(m.id)) return false
		if (activeTagIds.length === 0) return true
		// Any of the chosen tags, not all — narrowing to "all" gets empty fast.
		const ids = getMeetingTagIds(m.id)
		return activeTagIds.some((id) => ids.includes(id))
	})

	const toggleTagFilter = (id: string) =>
		setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))

	const clearFilters = () => {
		setFavouritesOnly(false)
		setSelectedTagIds([])
	}

	// Nothing to filter by yet: no favourites and no tags anywhere.
	const anyFavourites = history.some((m) => checkFavorite(m.id))
	const showFilters = anyFavourites || allTags.length > 0

	const chipStyle = (active: boolean, accent: string): React.CSSProperties => ({
		display: 'inline-flex',
		alignItems: 'center',
		gap: '6px',
		padding: '4px 10px',
		borderRadius: '999px',
		border: `1px solid ${active ? accent : currentThemeColors.border}`,
		backgroundColor: active ? `${accent}22` : 'transparent',
		color: active ? currentThemeColors.text : currentThemeColors.secondaryText,
		fontSize: '13px',
		fontFamily: 'inherit',
		cursor: 'pointer',
		transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
	})

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

			{showFilters && (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', alignItems: 'center', marginBottom: '10px' }}>
					{anyFavourites && (
						<button
							onClick={() => setFavouritesOnly((v) => !v)}
							aria-pressed={favouritesOnly}
							style={chipStyle(favouritesOnly, '#eab308')}>
							<StarIcon size={12} filled={favouritesOnly} />
							Favourites
						</button>
					)}
					{allTags.map((tag) => {
						const active = activeTagIds.includes(tag.id)
						return (
							<button key={tag.id} onClick={() => toggleTagFilter(tag.id)} aria-pressed={active} style={chipStyle(active, tag.color)}>
								<span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: tag.color, flexShrink: 0 }} />
								{tag.name}
							</button>
						)
					})}
					{filtersActive && (
						<button
							onClick={clearFilters}
							style={{
								padding: '4px 8px',
								border: 'none',
								background: 'none',
								color: currentThemeColors.secondaryText,
								fontSize: '13px',
								fontFamily: 'inherit',
								cursor: 'pointer',
								textDecoration: 'underline',
							}}>
							Clear
						</button>
					)}
				</div>
			)}

			{filtersActive && visible.length === 0 ? (
				<p style={{ textAlign: 'center', color: currentThemeColors.secondaryText, fontSize: '14px', margin: '16px 0' }}>
					No meetings match these filters.
				</p>
			) : null}

			<ul style={{ listStyle: 'none', padding: 0, margin: 0, border: visible.length ? `1px solid ${currentThemeColors.border}` : 'none', borderRadius: '8px' }}>
				{visible.map((m, index) => {
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
								borderBottom: index === visible.length - 1 ? 'none' : `1px solid ${currentThemeColors.border}`,
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
												{formatMeetingDateTimeShort(m.started_at)}
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
