export interface AppTheme {
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
	body: '#18181b', // Monochrome dark (Tailwind zinc-900)
	text: '#f3f4f6', // Light gray for primary text (Tailwind gray-100)
	secondaryText: '#9ca3af', // Medium gray for secondary text (Tailwind gray-400)
	background: '#27272a', // Monochrome dark (Tailwind zinc-800)
	backgroundSecondary: '#3f3f46', // Monochrome dark (Tailwind zinc-700)
	border: '#52525b', // Monochrome dark (Tailwind zinc-600)
	button: {
		primary: '#22c55e', // Green (Tailwind green-500)
		primaryText: '#FFFFFF',
		secondary: '#52525b', // Monochrome dark (Tailwind zinc-600)
		secondaryText: '#f3f4f6',
		danger: '#ef4444', // Red (Tailwind red-500)
		dangerText: '#FFFFFF',
	},
	input: {
		background: '#3f3f46', // Monochrome dark (Tailwind zinc-700)
		text: '#f3f4f6',
		border: '#52525b', // Monochrome dark (Tailwind zinc-600)
		placeholder: '#a1a1aa', // Monochrome gray (Tailwind zinc-400)
	},
	listItem: {
		background: '#27272a', // Monochrome dark (Tailwind zinc-800)
		hoverBackground: '#3f3f46', // Monochrome dark (Tailwind zinc-700)
	},
}

// Helper function to get current theme object
export const getCurrentTheme = (themeMode: 'light' | 'dark'): AppTheme => {
	return themeMode === 'light' ? lightTheme : darkTheme
}
