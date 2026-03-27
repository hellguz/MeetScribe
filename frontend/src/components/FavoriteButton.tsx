import React from 'react'
import { StarIcon } from './Icons'
import { AppTheme } from '../styles/theme'

interface FavoriteButtonProps {
	isFavorite: boolean
	onToggle: () => void
	theme: AppTheme
	size?: number
	ghost?: boolean
}

const FavoriteButton: React.FC<FavoriteButtonProps> = ({ isFavorite, onToggle, theme, size = 16, ghost = false }) => {
	return (
		<button
			onClick={(e) => {
				e.stopPropagation()
				onToggle()
			}}
			title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
			style={{
				padding: '7px 9px',
				border: ghost ? 'none' : `1px solid ${theme.border}`,
				borderRadius: '6px',
				backgroundColor: ghost ? 'transparent' : isFavorite ? (theme.body === '#FFFFFF' ? '#fefce8' : '#422006') : theme.backgroundSecondary,
				color: isFavorite ? '#eab308' : theme.secondaryText,
				cursor: 'pointer',
				lineHeight: 1,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				transition: 'background-color 0.2s ease, color 0.2s ease',
			}}
			onMouseEnter={(e) => {
				if (!isFavorite) e.currentTarget.style.backgroundColor = ghost ? theme.backgroundSecondary : theme.background
			}}
			onMouseLeave={(e) => {
				if (!isFavorite) e.currentTarget.style.backgroundColor = ghost ? 'transparent' : theme.backgroundSecondary
			}}>
			<StarIcon size={size} filled={isFavorite} />
		</button>
	)
}

export default FavoriteButton
