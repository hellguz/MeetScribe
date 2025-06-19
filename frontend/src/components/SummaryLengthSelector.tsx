import React from 'react'
import { useSummaryLength, SummaryLength } from '../contexts/SummaryLengthContext'
import { useTheme } from '../contexts/ThemeContext'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'

interface SummaryLengthSelectorProps {
	disabled?: boolean
	onSelect: (preset: SummaryLength) => void
}

const options: { label: string; value: SummaryLength }[] = [
	{ label: 'Auto', value: 'auto' },
	{ label: '¼ Page', value: 'quar_page' },
	{ label: '½ Page', value: 'half_page' },
	{ label: '1 Page', value: 'one_page' },
	{ label: '2 Pages', value: 'two_pages' },
]

const SummaryLengthSelector: React.FC<SummaryLengthSelectorProps> = ({ disabled = false, onSelect }) => {
	const { summaryLength, setSummaryLength } = useSummaryLength()
	const { theme } = useTheme()
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme

	const handleSelect = (length: SummaryLength) => {
		if (disabled) return
		// Update context immediately for responsive UI
		setSummaryLength(length)
		// Propagate the change to the parent component
		onSelect(length)
	}

	return (
		<div
			style={{
				display: 'flex',
				backgroundColor: currentThemeColors.backgroundSecondary,
				borderRadius: '8px',
				padding: '4px',
				width: 'fit-content',
				opacity: disabled ? 0.6 : 1,
				cursor: disabled ? 'not-allowed' : 'default',
			}}>
			{options.map((option) => {
				const isActive = summaryLength === option.value
				return (
					<button
						key={option.value}
						onClick={() => handleSelect(option.value)}
						disabled={disabled}
						style={{
							padding: '6px 14px',
							border: 'none',
							borderRadius: '6px',
							backgroundColor: isActive ? currentThemeColors.body : 'transparent',
							color: isActive ? currentThemeColors.text : currentThemeColors.secondaryText,
							cursor: disabled ? 'not-allowed' : 'pointer',
							fontWeight: isActive ? 'bold' : 'normal',
							transition: 'all 0.2s ease',
							fontSize: '14px',
						}}>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}

export default SummaryLengthSelector
