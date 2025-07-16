import React, { useState, useEffect, useRef } from 'react'
import { useSummaryLanguage, LanguageMode, SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'

interface LanguageSelectorProps {
	disabled?: boolean
	onSelectionChange: (update: Partial<SummaryLanguageState>) => void
}

const languages = [
	'Arabic',
	'Chinese (Simplified)',
	'Czech',
	'Danish',
	'Dutch',
	'English',
	'Finnish',
	'French',
	'German',
	'Greek',
	'Hebrew',
	'Hindi',
	'Hungarian',
	'Indonesian',
	'Italian',
	'Japanese',
	'Korean',
	'Norwegian',
	'Polish',
	'Portuguese',
	'Romanian',
	'Russian',
	'Slovak',
	'Spanish',
	'Swedish',
	'Thai',
	'Turkish',
	'Ukrainian',
	'Vietnamese',
]

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ disabled = false, onSelectionChange }) => {
	const { languageState } = useSummaryLanguage()
	const { theme } = useTheme()
	const [isDropdownOpen, setIsDropdownOpen] = useState(false)
	const wrapperRef = useRef<HTMLDivElement>(null)
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme
	const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

	useEffect(() => {
		const handleResize = () => setIsMobile(window.innerWidth < 768)
		window.addEventListener('resize', handleResize)
		return () => window.removeEventListener('resize', handleResize)
	}, [])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
				setIsDropdownOpen(false)
			}
		}

		if (isDropdownOpen) {
			document.addEventListener('mousedown', handleClickOutside)
		} else {
			document.removeEventListener('mousedown', handleClickOutside)
		}

		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [isDropdownOpen])

	const handleSelection = (mode: LanguageMode, customLang?: string) => {
		if (disabled) return
		setIsDropdownOpen(false)
		if (mode === 'custom') {
			onSelectionChange({ mode: 'custom', lastCustomLanguage: customLang || languageState.lastCustomLanguage })
		} else {
			onSelectionChange({ mode })
		}
	}

	const getButtonLabel = () => {
		if (languageState.mode === 'auto') return 'Auto'
		if (languageState.mode === 'english') return 'English'
		return languageState.lastCustomLanguage
	}

	if (isMobile) {
		return (
			<div ref={wrapperRef} style={{ position: 'relative', flex: 1 }}>
				<button
					onClick={() => setIsDropdownOpen(!isDropdownOpen)}
					disabled={disabled}
					style={{
						width: '100%',
						padding: '8px 10px',
						borderRadius: '6px',
						border: `1px solid ${currentThemeColors.border}`,
						fontSize: '14px',
						backgroundColor: currentThemeColors.body,
						color: currentThemeColors.text,
						opacity: disabled ? 0.6 : 1,
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						textAlign: 'left',
						cursor: 'pointer',
						boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
						fontFamily: 'inherit',
					}}>
					<span>{getButtonLabel()}</span>
					<span style={{ transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
				</button>
				{isDropdownOpen && (
					<div
						style={{
							position: 'absolute',
							top: '100%',
							right: 0,
							marginTop: '4px',
							backgroundColor: currentThemeColors.body,
							border: `1px solid ${currentThemeColors.border}`,
							borderRadius: '8px',
							zIndex: 10,
							maxHeight: '200px',
							overflowY: 'auto',
							boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
							minWidth: '100%',
							fontFamily: 'inherit',
						}}>
						<div
							onClick={() => handleSelection('auto')}
							style={{ padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
							onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.backgroundSecondary)}
							onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
							Auto-Detect
						</div>
						<div
							onClick={() => handleSelection('english')}
							style={{ padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
							onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.backgroundSecondary)}
							onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
							English
						</div>
						<hr style={{ margin: '4px 0', border: 'none', borderTop: `1px solid ${currentThemeColors.border}`, fontFamily: 'inherit' }} />
						{languages.map((lang) => (
							<div
								key={lang}
								onClick={() => handleSelection('custom', lang)}
								style={{
									padding: '10px 12px',
									cursor: 'pointer',
									fontWeight: languageState.mode === 'custom' && languageState.lastCustomLanguage === lang ? 'bold' : 'normal',
									fontFamily: 'inherit',
								}}
								onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.backgroundSecondary)}
								onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
								{lang}
							</div>
						))}
					</div>
				)}
			</div>
		)
	}

	// Desktop view
	return (
		<div
			ref={wrapperRef}
			style={{
				display: 'flex',
				position: 'relative',
				backgroundColor: currentThemeColors.body,
				border: `1px solid ${currentThemeColors.border}`,
				borderRadius: '8px',
				padding: '4px',
				width: 'fit-content',
				opacity: disabled ? 0.6 : 1,
				cursor: disabled ? 'not-allowed' : 'default',
				fontFamily: 'inherit',
			}}>
			<button
				onClick={() => handleSelection('auto')}
				disabled={disabled}
				style={{
					...desktopButtonStyle,
					backgroundColor: languageState.mode === 'auto' ? currentThemeColors.backgroundSecondary : 'transparent',
					color: currentThemeColors.text,
					fontWeight: languageState.mode === 'auto' ? 'bold' : 'normal',
					fontFamily: 'inherit',
				}}>
				Auto
			</button>
			<button
				onClick={() => handleSelection('english')}
				disabled={disabled}
				style={{
					...desktopButtonStyle,
					backgroundColor: languageState.mode === 'english' ? currentThemeColors.backgroundSecondary : 'transparent',
					color: currentThemeColors.text,
					fontWeight: languageState.mode === 'english' ? 'bold' : 'normal',
					fontFamily: 'inherit',
				}}>
				English
			</button>
			<div style={{ position: 'relative' }}>
				<button
					onClick={() => setIsDropdownOpen(!isDropdownOpen)}
					disabled={disabled}
					style={{
						...desktopButtonStyle,
						backgroundColor: languageState.mode === 'custom' ? currentThemeColors.backgroundSecondary : 'transparent',
						color: currentThemeColors.text,
						fontWeight: languageState.mode === 'custom' ? 'bold' : 'normal',
						fontFamily: 'inherit',
					}}>
					{languageState.lastCustomLanguage}
					<span style={{ marginLeft: '6px', fontSize: '10px', color: 'currentColor' }}>▼</span>
				</button>
				{isDropdownOpen && (
					<div
						style={{
							position: 'absolute',
							top: '100%',
							right: 0,
							marginTop: '4px',
							backgroundColor: currentThemeColors.body,
							border: `1px solid ${currentThemeColors.border}`,
							borderRadius: '8px',
							zIndex: 10,
							maxHeight: '200px',
							overflowY: 'auto',
							boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
							fontFamily: 'inherit',
						}}>
						{languages.map((lang) => (
							<div
								key={lang}
								onClick={() => handleSelection('custom', lang)}
								style={{
									padding: '8px 16px',
									cursor: 'pointer',
									whiteSpace: 'nowrap',
									color: currentThemeColors.text,
									backgroundColor: languageState.lastCustomLanguage === lang ? currentThemeColors.backgroundSecondary : 'transparent',
									fontFamily: 'inherit',
								}}
								onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.backgroundSecondary)}
								onMouseLeave={(e) =>
									(e.currentTarget.style.backgroundColor = languageState.lastCustomLanguage === lang ? currentThemeColors.backgroundSecondary : 'transparent')
								}>
								{lang}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

const desktopButtonStyle: React.CSSProperties = {
	padding: '6px 14px',
	border: 'none',
	borderRadius: '6px',
	cursor: 'pointer',
	transition: 'all 0.2s ease',
	fontSize: '14px',
	height: '32px',
	boxSizing: 'border-box',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	whiteSpace: 'nowrap',
}

export default LanguageSelector
