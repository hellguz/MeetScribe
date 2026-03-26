import React from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme } from '../styles/theme'
import { SunIcon, MoonIcon } from './Icons'

interface ThemeToggleProps {
	style?: React.CSSProperties
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ style }) => {
	const { theme, toggleTheme } = useTheme()
	const colors = theme === 'light' ? lightTheme : darkTheme

	return (
		<button
			onClick={toggleTheme}
			title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
			style={{
				padding: '5px 7px',
				border: `1px solid ${colors.border}`,
				borderRadius: '6px',
				backgroundColor: colors.backgroundSecondary,
				color: colors.secondaryText,
				cursor: 'pointer',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				lineHeight: 1,
				transition: 'background-color 0.2s ease',
				...style,
			}}
			onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.background)}
			onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = colors.backgroundSecondary)}>
			{theme === 'light' ? <MoonIcon /> : <SunIcon />}
		</button>
	)
}

export default ThemeToggle
