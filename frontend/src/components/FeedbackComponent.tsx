import React, { useState, useMemo } from 'react'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'

interface FeedbackComponentProps {
	onSubmit: (feedbackTypes: string[], suggestionText?: string) => Promise<void>
	theme: 'light' | 'dark'
}

type ChipColor = 'green' | 'yellow' | 'red'

interface FeedbackOption {
	type: string
	label: string
	color: ChipColor
}

const feedbackOptions: FeedbackOption[] = [
	{ type: 'accurate', label: 'On the spot', color: 'green' },
	{ type: 'too_short', label: 'Too short', color: 'yellow' },
	{ type: 'too_detailed', label: 'Too detailed', color: 'yellow' },
	{ type: 'general', label: 'Too general', color: 'yellow' },
	{ type: 'inaccurate', label: 'Inaccurate', color: 'red' },
]

const FeedbackComponent: React.FC<FeedbackComponentProps> = ({ onSubmit, theme }) => {
	const [selectedTypes, setSelectedTypes] = useState<string[]>([])
	const [suggestion, setSuggestion] = useState('')
	const [isSubmitted, setIsSubmitted] = useState(false)
	const [isSubmitting, setIsSubmitting] = useState(false)

	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme

	const chipColors: Record<ChipColor, { border: string; hoverBg: string; selectedBg: string }> = useMemo(
		() => ({
			green: {
				border: theme === 'light' ? '#22c55e' : '#4ade80', // Saturated green
				hoverBg: theme === 'light' ? '#f0fdf4' : '#143623',
				selectedBg: theme === 'light' ? '#dcfce7' : '#166534',
			},
			yellow: {
				border: theme === 'light' ? '#f59e0b' : '#fabc05', // Saturated amber/yellow
				hoverBg: theme === 'light' ? '#fffbeb' : '#422006',
				selectedBg: theme === 'light' ? '#fef3c7' : '#b45309',
			},
			red: {
				border: theme === 'light' ? '#ef4444' : '#f87171', // Saturated red
				hoverBg: theme === 'light' ? '#fef2f2' : '#450a0a',
				selectedBg: theme === 'light' ? '#fee2e2' : '#b91c1c',
			},
		}),
		[theme],
	)

	const handleTypeSelect = async (type: string) => {
		const isSelecting = !selectedTypes.includes(type)

		if (isSelecting) {
			setIsSubmitting(true)
			await onSubmit([type], '') // Submit with the selected type and empty suggestion
			setIsSubmitting(false)
			setIsSubmitted(true)
			setSelectedTypes((prev) => [...prev, type]) // Add to selected types

			// Hide the "thank you" message after a few seconds
			setTimeout(() => setIsSubmitted(false), 4000)
		} else {
			setSelectedTypes((prev) => prev.filter((t) => t !== type)) // Remove from selected types
		}
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (suggestion.trim() === '' || isSubmitting) {
			return
		}
		setIsSubmitting(true)
		await onSubmit([], suggestion.trim()) // Only submit suggestion text
		setIsSubmitting(false)
		setIsSubmitted(true)
		setSuggestion('') // Clear only the suggestion

		// Hide the "thank you" message after a few seconds
		setTimeout(() => setIsSubmitted(false), 4000)
	}

	const isSubmitDisabled = suggestion.trim() === '' || isSubmitting

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
					const isSelected = selectedTypes.includes(opt.type)
					return (
						<button
							key={opt.type}
							onClick={() => handleTypeSelect(opt.type)}
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
								if (!isSelected) {
									e.currentTarget.style.backgroundColor = colorSet.hoverBg
									e.currentTarget.style.color = currentThemeColors.text
								}
							}}
							onMouseLeave={(e) => {
								if (!isSelected) {
									e.currentTarget.style.backgroundColor = 'transparent'
									e.currentTarget.style.color = colorSet.border
								}
							}}>
							{opt.label}
						</button>
					)
				})}
			</div>

			<form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					{suggestion.trim() !== '' && (
						<button
							type="submit"
							style={{
								padding: '8px 16px',
							border: 'none',
							borderRadius: '8px',
							backgroundColor: isSubmitDisabled ? currentThemeColors.backgroundSecondary : currentThemeColors.button.primary,
							color: isSubmitDisabled ? currentThemeColors.secondaryText : currentThemeColors.button.primaryText,
							fontSize: '14px',
							fontWeight: '500',
							cursor: isSubmitDisabled ? 'not-allowed' : 'pointer',
							transition: 'background-color 0.2s, color 0.2s',
							opacity: isSubmitting ? 0.7 : 1,
						}}
						disabled={isSubmitDisabled}>
						{isSubmitting ? 'Submitting...' : 'Submit Feedback'}
						</button>
					)}
					{/* The "Thanks" message is aligned to the right if the button is not visible,
					    or if it's visible and there's space. We might need to adjust flex properties if needed.
						For now, let's keep its position relative to the button container. */}
					{isSubmitted && (
						<div
							style={{
								color: currentThemeColors.text,
								fontWeight: 500,
								// If suggestion is empty, the button is hidden, thanks message should take up the start space
								marginLeft: suggestion.trim() === '' ? '0' : 'auto',
								// If suggestion is not empty, button is visible, thanks message is to its right.
								// If button is also there, ensure it's on the right.
								// This might need more sophisticated layout if designs are very specific.
							}}
						>
							Thanks for your feedback! ✨
						</div>
					)}
				</div>
			</form>
		</div>
	)
}

export default FeedbackComponent
