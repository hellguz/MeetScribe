import React, { useEffect, useState } from 'react'
import { SummaryLength } from '../contexts/SummaryLengthContext'
import { useTheme } from '../contexts/ThemeContext'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'

interface SummaryLengthSelectorProps {
	value: SummaryLength // The component is now fully controlled
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

const SummaryLengthSelector: React.FC<SummaryLengthSelectorProps> = ({ value, disabled = false, onSelect }) => {
	const { theme } = useTheme()
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

	const handleSelect = (length: SummaryLength) => {
		if (disabled) return
		onSelect(length)
	}

    if (isMobile) {
        return (
            <select
                value={value}
                onChange={(e) => handleSelect(e.target.value as SummaryLength)}
                disabled={disabled}
                style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${currentThemeColors.input.border}`,
                    fontSize: '14px',
                    backgroundColor: currentThemeColors.input.background,
                    color: currentThemeColors.input.text,
                    opacity: disabled ? 0.6 : 1,
                    width: '100%',
                }}
            >
                {options.map(option => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        );
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
				const isActive = value === option.value
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
							height: '32px', // Explicit height for consistency
							boxSizing: 'border-box',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							whiteSpace: 'nowrap',
						}}>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}

export default SummaryLengthSelector



