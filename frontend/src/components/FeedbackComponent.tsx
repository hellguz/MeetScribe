import React, { useState, useMemo } from 'react'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'

interface FeedbackComponentProps {
	// Let the parent component manage the state of submitted feedback
	submittedTypes: string[]
	onFeedbackToggle: (type: string, isSelected: boolean) => Promise<void>
	onSuggestionSubmit: (suggestionText: string) => Promise<void>
	theme: 'light' | 'dark'
}

type ChipColor = 'green' | 'yellow' | 'red'

interface FeedbackOption {
	type: string
	label: string
	color: ChipColor
}

const feedbackOptions: FeedbackOption[] = [
	{ type: 'accurate', label: 'Accurate', color: 'green' },
	{ type: 'well_structured', label: 'Well Structured', color: 'green' },
	{ type: 'too_short', label: 'Too Short', color: 'yellow' },
	{ type: 'too_detailed', label: 'Too Detailed', color: 'yellow' },
	{ type: 'missed_key_points', label: 'Missed Key Points', color: 'yellow' },
	{ type: 'confusing', label: 'Confusing', color: 'red' },
	{ type: 'inaccurate', label: 'Inaccurate', color: 'red' },
	{ type: 'hallucinated', label: 'Made things up', color: 'red' },
]

const FeedbackComponent: React.FC<FeedbackComponentProps> = ({ submittedTypes, onFeedbackToggle, onSuggestionSubmit, theme }) => {
	const [suggestion, setSuggestion] = useState('')
	const [isSuggestionSubmitted, setIsSuggestionSubmitted] = useState(false)
	const [isSubmitting, setIsSubmitting] = useState(false)

	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme

	const chipColors: Record<ChipColor, { border: string; hoverBg: string; selectedBg: string }> = useMemo(
		() => ({
			green: {
				border: theme === 'light' ? '#22c55e' : '#4ade80',
				hoverBg: theme === 'light' ? '#f0fdf4' : '#143623',
				selectedBg: theme === 'light' ? '#dcfce7' : '#166534',
			},
			yellow: {
				border: theme === 'light' ? '#f59e0b' : '#facc15',
				hoverBg: theme === 'light' ? '#fefce8' : '#422006',
				selectedBg: theme === 'light' ? '#fef9c3' : '#b45309',
			},
			red: {
				border: theme === 'light' ? '#ef4444' : '#f87171',
				hoverBg: theme === 'light' ? '#fef2f2' : '#450a0a',
				selectedBg: theme === 'light' ? '#fee2e2' : '#b91c1c',
			},
		}),
		[theme],
	)

	const handleTypeToggle = (type: string) => {
		const isCurrentlySelected = submittedTypes.includes(type)
		onFeedbackToggle(type, !isCurrentlySelected)
	}

	const handleSuggestionSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (suggestion.trim() === '' || isSubmitting) {
			return
		}
		setIsSubmitting(true)
		await onSuggestionSubmit(suggestion.trim())
		setIsSubmitting(false)
		setIsSuggestionSubmitted(true)
		setSuggestion('')
		setTimeout(() => setIsSuggestionSubmitted(false), 4000)
	}

	return (
		<div
			style={{
				padding: '16px',
				margin: '24px 0',
				backgroundColor: 'transparent',
				border: `1px solid ${currentThemeColors.border}`,
				borderRadius: '8px',
			}}>
			<p style={{ margin: '0 0 12px 0', fontWeight: '500', fontSize: '15px', color: currentThemeColors.text }}>Was this summary helpful?</p>

			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
				{feedbackOptions.map((opt) => {
					const colorSet = chipColors[opt.color]
					const isSelected = submittedTypes.includes(opt.type)
					return (
						<button
							key={opt.type}
							onClick={() => handleTypeToggle(opt.type)}
							style={{
								padding: '6px 12px',
								border: `1.5px solid ${colorSet.border}`,
								borderRadius: '16px',
								backgroundColor: isSelected ? colorSet.selectedBg : 'transparent',
								color: isSelected ? currentThemeColors.text : colorSet.border,
								fontWeight: '500',
								fontSize: '14px',
								cursor: 'pointer',
								transition: 'background-color 0.2s ease, color 0.2s ease',
							}}
							onMouseEnter={(e) => {
								if (!isSelected) e.currentTarget.style.backgroundColor = colorSet.hoverBg
							}}
							onMouseLeave={(e) => {
								if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'
							}}>
							{opt.label}
						</button>
					)
				})}
			</div>

			<form onSubmit={handleSuggestionSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
				<input
					type="text"
					value={suggestion}
					onChange={(e) => setSuggestion(e.target.value)}
					placeholder="Have a feature suggestion or other comment?"
					style={{
						flexGrow: 1,
						padding: '8px 12px',
						border: `1px solid ${currentThemeColors.input.border}`,
						borderRadius: '8px',
						backgroundColor: currentThemeColors.input.background,
						color: currentThemeColors.text,
						fontSize: '14px',
					}}
				/>
				<div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
					{isSuggestionSubmitted ? (
						<div style={{ color: currentThemeColors.text, fontWeight: 500 }}>Thanks for your feedback! ✨</div>
					) : (
						<button
							type="submit"
							style={{
								padding: '8px 16px',
								border: 'none',
								borderRadius: '8px',
								backgroundColor: currentThemeColors.button.primary,
								color: currentThemeColors.button.primaryText,
								fontSize: '14px',
								fontWeight: '500',
								cursor: isSubmitting || !suggestion.trim() ? 'not-allowed' : 'pointer',
								transition: 'background-color 0.2s, opacity 0.2s',
								opacity: isSubmitting || !suggestion.trim() ? 0.6 : 1,
							}}
							disabled={isSubmitting || !suggestion.trim()}>
							{isSubmitting ? 'Submitting...' : 'Submit Suggestion'}
						</button>
					)}
				</div>
			</form>
		</div>
	)
}

export default FeedbackComponent
