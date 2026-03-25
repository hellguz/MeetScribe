import '@fontsource/inter'

export interface AppTheme {
	fontFamily: string
	fontFeatureSettings: string
	body: string
	text: string
	secondaryText: string
	background: string
	backgroundSecondary: string
	border: string
	button: {
		primary: string
		primaryText: string
		secondary: string
		secondaryText: string
		danger: string
		dangerText: string
	}
	input: {
		background: string
		text: string
		border: string
		placeholder: string
	}
	listItem: {
		background: string
		hoverBackground: string
	}
	// Add more specific theme properties as needed
}

export const lightTheme: AppTheme = {
	fontFamily: "'Inter', sans-serif",
	fontFeatureSettings: "'ss01' on, 'ss02' on, 'ss03' on",
	body: '#FFFFFF', // White background for the page
	text: '#1f2937', // Dark gray for primary text (Tailwind gray-800)
	secondaryText: '#6b7280', // Lighter gray for secondary text (Tailwind gray-500)
	background: '#f9fafb', // Very light gray for component backgrounds (Tailwind gray-50)
	backgroundSecondary: '#f3f4f6', // Slightly darker light gray (Tailwind gray-100)
	border: '#e5e7eb', // Light gray for borders (Tailwind gray-200)
	button: {
		primary: '#22c55e', // Green (Tailwind green-500)
		primaryText: '#FFFFFF',
		secondary: '#6b7280', // Gray (Tailwind gray-500)
		secondaryText: '#FFFFFF',
		danger: '#ef4444', // Red (Tailwind red-500)
		dangerText: '#FFFFFF',
	},
	input: {
		background: '#FFFFFF',
		text: '#1f2937',
		border: '#d1d5db', // Tailwind gray-300
		placeholder: '#9ca3af', // Tailwind gray-400
	},
	listItem: {
		background: '#FFFFFF',
		hoverBackground: '#eff6ff', // Tailwind blue-50
	},
}

export const darkTheme: AppTheme = {
	fontFamily: "'Inter', sans-serif",
	fontFeatureSettings: "'ss01' on, 'ss02' on, 'ss03' on",
	body: '#121315', // Deep blue-black — easier on eyes than flat zinc
	text: '#dde1e7', // Soft cool white — reduces harshness vs pure white
	secondaryText: '#8b94a3', // Muted blue-gray
	background: '#181a1d', // Card surfaces — subtle elevation from body
	backgroundSecondary: '#1c2128', // Inputs and secondary surfaces
	border: '#2d333b', // Understated dark border
	button: {
		primary: '#22c55e', // Green
		primaryText: '#FFFFFF',
		secondary: '#2d333b', // Ghost dark button
		secondaryText: '#dde1e7',
		danger: '#f85149', // Slightly warmer red
		dangerText: '#FFFFFF',
	},
	input: {
		background: '#1c2128',
		text: '#dde1e7',
		border: '#444c56', // Slightly more visible input border
		placeholder: '#8b94a3',
	},
	listItem: {
		background: '#161b22',
		hoverBackground: '#1c2128',
	},
}

// Helper function to get current theme object
export const getCurrentTheme = (themeMode: 'light' | 'dark'): AppTheme => {
	return themeMode === 'light' ? lightTheme : darkTheme
}
