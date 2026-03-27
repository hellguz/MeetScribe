import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Tag, getTags, createTag, updateTag, deleteTag, getDefaultColors } from '../utils/tags'
import { TagIcon, PlusIcon, EditIcon, CloseIcon } from './Icons'
import { AppTheme } from '../styles/theme'

interface TagsManagerProps {
	selectedTagIds: string[]
	onToggleTag: (tagId: string) => void
	onTagsChanged: () => void
	theme: AppTheme
	size?: number
	ghost?: boolean
}

/** Compact colored dots showing selected tags. */
const TagDots: React.FC<{ tags: Tag[]; selectedIds: string[]; theme: AppTheme; ghost?: boolean }> = ({ tags, selectedIds, theme, ghost = false }) => {
	const selected = tags.filter((t) => selectedIds.includes(t.id))
	if (selected.length === 0) return null
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: '3px',
				padding: ghost ? '7px 4px 7px 0' : '7px 8px',
				border: ghost ? 'none' : `1px solid ${theme.border}`,
				borderRight: 'none',
				borderRadius: ghost ? 0 : '6px 0 0 6px',
				backgroundColor: ghost ? 'transparent' : theme.backgroundSecondary,
				lineHeight: 1,
				boxSizing: 'border-box',
				minHeight: '32px',
			}}>
			{selected.map((t) => (
				<span
					key={t.id}
					title={t.name}
					style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: t.color, display: 'inline-block', flexShrink: 0 }}
				/>
			))}
		</div>
	)
}

/** Form for creating or editing a tag. */
const TagForm: React.FC<{
	initial?: { name: string; color: string }
	onSave: (name: string, color: string) => void
	onDelete?: () => void
	onCancel: () => void
	theme: AppTheme
}> = ({ initial, onSave, onDelete, onCancel, theme }) => {
	const [name, setName] = useState(initial?.name ?? '')
	const [color, setColor] = useState(initial?.color ?? getDefaultColors()[0])
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	const handleSubmit = () => {
		if (!name.trim()) return
		onSave(name.trim(), color)
	}

	return (
		<div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
			<input
				ref={inputRef}
				value={name}
				onChange={(e) => setName(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') handleSubmit()
					if (e.key === 'Escape') onCancel()
					e.stopPropagation()
				}}
				placeholder="Tag name"
				style={{
					padding: '6px 8px',
					fontSize: '14px',
					border: `1px solid ${theme.input.border}`,
					borderRadius: '4px',
					backgroundColor: theme.input.background,
					color: theme.input.text,
					outline: 'none',
					fontFamily: 'inherit',
				}}
			/>
			<div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
				{getDefaultColors().map((c) => (
					<button
						key={c}
						onClick={() => setColor(c)}
						style={{
							width: 20,
							height: 20,
							borderRadius: '50%',
							backgroundColor: c,
							border: color === c ? '2px solid ' + theme.text : '2px solid transparent',
							cursor: 'pointer',
							padding: 0,
							flexShrink: 0,
						}}
					/>
				))}
			</div>
			<div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
				{onDelete && (
					<button
						onClick={onDelete}
						style={{
							padding: '5px 10px',
							fontSize: '13px',
							border: 'none',
							borderRadius: '4px',
							backgroundColor: theme.button.danger,
							color: theme.button.dangerText,
							cursor: 'pointer',
							fontFamily: 'inherit',
							marginRight: 'auto',
						}}>
						Remove
					</button>
				)}
				<button
					onClick={onCancel}
					style={{
						padding: '5px 10px',
						fontSize: '13px',
						border: `1px solid ${theme.border}`,
						borderRadius: '4px',
						backgroundColor: theme.background,
						color: theme.text,
						cursor: 'pointer',
						fontFamily: 'inherit',
					}}>
					Cancel
				</button>
				<button
					onClick={handleSubmit}
					disabled={!name.trim()}
					style={{
						padding: '5px 10px',
						fontSize: '13px',
						border: 'none',
						borderRadius: '4px',
						backgroundColor: theme.button.primary,
						color: theme.button.primaryText,
						cursor: name.trim() ? 'pointer' : 'not-allowed',
						opacity: name.trim() ? 1 : 0.5,
						fontFamily: 'inherit',
					}}>
					Save
				</button>
			</div>
		</div>
	)
}

const TagsManager: React.FC<TagsManagerProps> = ({ selectedTagIds, onToggleTag, onTagsChanged, theme, size = 16, ghost = false }) => {
	const [isOpen, setIsOpen] = useState(false)
	const [tags, setTags] = useState<Tag[]>(getTags)
	const [formMode, setFormMode] = useState<'none' | 'new' | string>('none') // 'none', 'new', or tag id for editing
	const [hoveredTagId, setHoveredTagId] = useState<string | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	const refreshTags = useCallback(() => {
		setTags(getTags())
		onTagsChanged()
	}, [onTagsChanged])

	useEffect(() => {
		if (!isOpen) {
			setFormMode('none')
			setHoveredTagId(null)
		}
	}, [isOpen])

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setIsOpen(false)
			}
		}
		if (isOpen) document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [isOpen])

	const handleCreateTag = (name: string, color: string) => {
		const tag = createTag(name, color)
		refreshTags()
		onToggleTag(tag.id)
		setFormMode('none')
	}

	const handleUpdateTag = (id: string, name: string, color: string) => {
		updateTag(id, name, color)
		refreshTags()
		setFormMode('none')
	}

	const handleDeleteTag = (id: string) => {
		deleteTag(id)
		refreshTags()
		setFormMode('none')
	}

	const hasDots = selectedTagIds.length > 0

	return (
		<div ref={containerRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
			{hasDots && <TagDots tags={tags} selectedIds={selectedTagIds} theme={theme} ghost={ghost} />}
			<button
				onClick={(e) => {
					e.stopPropagation()
					setIsOpen(!isOpen)
				}}
				title="Manage tags"
				style={{
					padding: '7px 9px',
					border: ghost ? 'none' : `1px solid ${theme.border}`,
					borderRadius: hasDots ? '0 6px 6px 0' : '6px',
					backgroundColor: ghost ? 'transparent' : theme.backgroundSecondary,
					color: theme.secondaryText,
					cursor: 'pointer',
					lineHeight: 1,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					transition: 'background-color 0.2s ease',
				}}
				onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.backgroundSecondary)}
				onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
				<TagIcon size={size} />
			</button>

			{isOpen && (
				<div
					onClick={(e) => e.stopPropagation()}
					style={{
						position: 'absolute',
						top: '100%',
						right: 0,
						marginTop: '4px',
						minWidth: '180px',
						backgroundColor: theme.background,
						border: `1px solid ${theme.border}`,
						borderRadius: '8px',
						boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
						zIndex: 1000,
						overflow: 'hidden',
					}}>
					{formMode !== 'none' ? (
						<TagForm
							initial={formMode !== 'new' ? tags.find((t) => t.id === formMode) : undefined}
							onSave={formMode === 'new' ? handleCreateTag : (name, color) => handleUpdateTag(formMode, name, color)}
							onDelete={formMode !== 'new' ? () => handleDeleteTag(formMode) : undefined}
							onCancel={() => setFormMode('none')}
							theme={theme}
						/>
					) : (
						<>
							<div style={{ maxHeight: '200px', overflowY: 'auto' }}>
								{tags.map((tag) => {
									const isSelected = selectedTagIds.includes(tag.id)
									const isHovered = hoveredTagId === tag.id
									return (
										<div
											key={tag.id}
											onMouseEnter={() => setHoveredTagId(tag.id)}
											onMouseLeave={() => setHoveredTagId(null)}
											style={{
												display: 'flex',
												alignItems: 'center',
												padding: '8px 10px',
												cursor: 'pointer',
												backgroundColor: isHovered ? theme.listItem.hoverBackground : 'transparent',
												transition: 'background-color 0.1s',
											}}
											onClick={() => onToggleTag(tag.id)}>
											<span
												style={{
													width: 10,
													height: 10,
													borderRadius: '50%',
													backgroundColor: tag.color,
													marginRight: '8px',
													flexShrink: 0,
												}}
											/>
											<span
												style={{
													fontSize: '14px',
													color: theme.text,
													flex: 1,
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
													fontWeight: isSelected ? 600 : 400,
												}}>
												{tag.name}
											</span>
											{isHovered && (
												<button
													onClick={(e) => {
														e.stopPropagation()
														setFormMode(tag.id)
													}}
													style={{
														padding: '3px',
														border: 'none',
														background: 'none',
														color: theme.secondaryText,
														cursor: 'pointer',
														lineHeight: 1,
														display: 'flex',
														alignItems: 'center',
														flexShrink: 0,
													}}>
													<EditIcon size={13} />
												</button>
											)}
											{!isHovered && isSelected && <span style={{ fontSize: '13px', color: theme.secondaryText, flexShrink: 0 }}>✓</span>}
										</div>
									)
								})}
							</div>
							<div
								style={{
									borderTop: tags.length > 0 ? `1px solid ${theme.border}` : 'none',
									padding: '8px 10px',
									cursor: 'pointer',
									display: 'flex',
									alignItems: 'center',
									gap: '6px',
									fontSize: '14px',
									color: theme.secondaryText,
									transition: 'background-color 0.1s',
								}}
								onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.listItem.hoverBackground)}
								onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
								onClick={() => setFormMode('new')}>
								<PlusIcon size={13} />
								<span>New Tag</span>
							</div>
						</>
					)}
				</div>
			)}
		</div>
	)
}

export default TagsManager
