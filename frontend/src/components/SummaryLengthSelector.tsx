import React, { useContext } from 'react'
import { useSummaryLength, SummaryLength } from '../contexts/SummaryLengthContext'
import { ThemeContext, useTheme } from '../contexts/ThemeContext'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'

interface SummaryLengthSelectorProps {
	onSelect?: (length: SummaryLength) => void
	disabled?: boolean
}

const options: { label: string; value: SummaryLength }[] = [
	{ label: '½ Page', value: 'short' },
	{ label: '1 Page', value: 'medium' },
	{ label: '2 Pages', value: 'long' },
	{ label: 'Auto', value: 'custom' },
]

const SummaryLengthSelector: React.FC<SummaryLengthSelectorProps> = ({ onSelect, disabled = false }) => {
	const { summaryLength, setSummaryLength } = useSummaryLength()
	const { theme } = useTheme()
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme

	const handleSelect = (length: SummaryLength) => {
		if (disabled) return
		setSummaryLength(length)
		if (onSelect) {
			onSelect(length)
		}
	}

	return (
		<div
			style={{
				display: 'flex',
				backgroundColor: currentThemeColors.backgroundSecondary,
				borderRadius: '8px',
				padding: '4px',
				width: 'fit-content',
				margin: '0 auto',
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
