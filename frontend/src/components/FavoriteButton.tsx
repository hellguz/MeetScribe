import React from 'react'
import { StarIcon } from './Icons'
import { AppTheme } from '../styles/theme'

interface FavoriteButtonProps {
	isFavorite: boolean
	onToggle: () => void
	theme: AppTheme
	size?: number
}

const FavoriteButton: React.FC<FavoriteButtonProps> = ({ isFavorite, onToggle, theme, size = 16 }) => {
	return (
		<button
			onClick={(e) => {
				e.stopPropagation()
				onToggle()
			}}
			title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
			style={{
				padding: '7px 9px',
				border: `1px solid ${theme.border}`,
				borderRadius: '6px',
				backgroundColor: isFavorite ? (theme.body === '#FFFFFF' ? '#fefce8' : '#422006') : theme.backgroundSecondary,
				color: isFavorite ? '#eab308' : theme.secondaryText,
				cursor: 'pointer',
				lineHeight: 1,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				transition: 'background-color 0.2s ease, color 0.2s ease',
			}}
			onMouseEnter={(e) => {
				if (!isFavorite) e.currentTarget.style.backgroundColor = theme.background
			}}
			onMouseLeave={(e) => {
				if (!isFavorite) e.currentTarget.style.backgroundColor = theme.backgroundSecondary
			}}>
			<StarIcon size={size} filled={isFavorite} />
		</button>
	)
}

export default FavoriteButton
