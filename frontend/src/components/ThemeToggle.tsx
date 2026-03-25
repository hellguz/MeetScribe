import React from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { lightTheme, darkTheme } from '../styles/theme'

interface ThemeToggleProps {
	style?: React.CSSProperties
}

const SunIcon = () => (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="5" />
		<line x1="12" y1="1" x2="12" y2="3" />
		<line x1="12" y1="21" x2="12" y2="23" />
		<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
		<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
		<line x1="1" y1="12" x2="3" y2="12" />
		<line x1="21" y1="12" x2="23" y2="12" />
		<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
		<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
	</svg>
)

const MoonIcon = () => (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
	</svg>
)

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
