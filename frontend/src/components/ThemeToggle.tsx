import React, { useContext } from 'react'
import { ThemeContext } from '../contexts/ThemeContext'

const ThemeToggle: React.FC = () => {
	const context = useContext(ThemeContext)

	if (!context) {
		// This should not happen if the component is used within ThemeProvider
		return null
	}

	const { theme, toggleTheme } = context

	// Use only the emoji, no text
	const emoji = theme === 'light' ? '🌙' : '☀️'

	return (
		<button
			onClick={toggleTheme}
			title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
			style={{
				position: 'fixed',
				top: '15px',
				right: '15px',
				zIndex: 1000,
				cursor: 'pointer',

				// Style Reset for "invisible button"
				background: 'transparent',
				border: 'none',
				padding: 0,

				// Emoji Styling
				fontSize: '16px',
				lineHeight: 1,
			}}>
			{emoji}
		</button>
	)
}

export default ThemeToggle
