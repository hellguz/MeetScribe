import React, { createContext, useState, useEffect, useMemo, ReactNode, useContext } from 'react'
import { lightTheme, darkTheme } from '../styles/theme' // Import themes

export type Theme = 'light' | 'dark'
interface ThemeContextType {
	theme: Theme
	toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined)
interface ThemeProviderProps {
	children: React.ReactNode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
	const [theme, setTheme] = useState<Theme>(() => {
		const storedTheme = localStorage.getItem('app-theme') as Theme | null
		if (storedTheme) {
			return storedTheme
		}
		// Default to light theme or check system preference
		return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
	})
	useEffect(() => {
		localStorage.setItem('app-theme', theme)
		document.documentElement.setAttribute('data-theme', theme)

		// Apply theme to body
		const currentThemeColors = theme === 'light' ? lightTheme : darkTheme
		document.body.style.backgroundColor = currentThemeColors.body
		document.body.style.color = currentThemeColors.text
	}, [theme])
	const toggleTheme = () => {
		setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'))
	}
	const contextValue = useMemo(() => ({ theme, toggleTheme }), [theme])
	return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
}

// Custom hook for consuming the theme context
export const useTheme = (): ThemeContextType => {
	const context = useContext(ThemeContext)
	if (context === undefined) {
		throw new Error('useTheme must be used within a ThemeProvider')
	}
	return context
}
