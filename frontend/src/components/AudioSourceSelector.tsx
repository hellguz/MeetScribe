import React from 'react'
import { AppTheme } from '../styles/theme'
import { AudioSource } from '../types'

interface AudioSourceSelectorProps {
	audioSource: AudioSource
	setAudioSource: (source: AudioSource) => void
	includeMic: boolean
	setIncludeMic: (include: boolean) => void
	isSystemAudioSupported: boolean
	disabled: boolean
	theme: AppTheme
}

const SOURCES: { value: AudioSource; label: string }[] = [
	{ value: 'mic', label: 'Microphone' },
	{ value: 'system', label: 'System Audio' },
	{ value: 'file', label: 'Upload File' },
]

const AudioSourceSelector: React.FC<AudioSourceSelectorProps> = ({
	audioSource,
	setAudioSource,
	includeMic,
	setIncludeMic,
	isSystemAudioSupported,
	disabled,
	theme,
}) => {
	return (
		<div style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '20px', opacity: disabled ? 0.5 : 1 }}>
			{/* Segmented toggle rather than a native <select>: three fixed options
			    read better as buttons, and it matches the app's own controls
			    instead of the browser's. */}
			<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
				<span style={{ fontWeight: 500, color: theme.text, fontSize: '15px' }}>Audio Source</span>
				<div
					role="group"
					aria-label="Audio source"
					style={{
						display: 'flex',
						backgroundColor: theme.backgroundSecondary,
						border: `1px solid ${theme.border}`,
						borderRadius: '8px',
						padding: '4px',
						gap: '4px',
						flexWrap: 'wrap',
						justifyContent: 'center',
					}}>
					{SOURCES.map(({ value, label }) => {
						const active = audioSource === value
						return (
							<button
								key={value}
								type="button"
								aria-pressed={active}
								disabled={disabled}
								onClick={() => setAudioSource(value)}
								style={{
									padding: '7px 14px',
									border: 'none',
									borderRadius: '6px',
									backgroundColor: active ? theme.body : 'transparent',
									color: active ? theme.text : theme.secondaryText,
									fontWeight: active ? 600 : 400,
									fontSize: '15px',
									fontFamily: 'inherit',
									cursor: disabled ? 'not-allowed' : 'pointer',
									boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
									transition: 'background-color 0.15s, color 0.15s',
									whiteSpace: 'nowrap',
								}}>
								{label}
							</button>
						)
					})}
				</div>
			</div>

			{audioSource === 'system' && !isSystemAudioSupported && (
				<div
					style={{
						padding: '12px',
						backgroundColor: theme.backgroundSecondary,
						border: `1px solid ${theme.border}`,
						color: theme.text,
						borderRadius: '8px',
						textAlign: 'center',
					}}>
					⚠️ System audio recording is not supported on your device or browser (e.g., iPhones/iPads). This option is unlikely to work.
				</div>
			)}
			{audioSource === 'system' && isSystemAudioSupported && (
				<div
					style={{
						padding: '12px',
						backgroundColor: theme.backgroundSecondary,
						border: `1px solid ${theme.border}`,
						color: theme.text,
						borderRadius: '8px',
						textAlign: 'center',
						fontSize: '14px',
						lineHeight: 1.5,
					}}>
					ℹ️ When prompted, choose a screen, window, or tab to share. <br />
					<b>Crucially, ensure you check the "Share system audio" or "Share tab audio" box</b> to record sound.
				</div>
			)}

			{audioSource === 'system' && (
				<div
					style={{
						display: 'flex',
						justifyContent: 'center',
						alignItems: 'center',
						padding: '10px',
						backgroundColor: theme.backgroundSecondary,
						borderRadius: '8px',
					}}>
					<input
						type="checkbox"
						id="include-mic-checkbox"
						checked={includeMic}
						onChange={(e) => setIncludeMic(e.target.checked)}
						disabled={disabled}
						style={{ marginRight: '8px', width: '16px', height: '16px' }}
					/>
					<label htmlFor="include-mic-checkbox" style={{ fontWeight: 500, color: theme.text, cursor: disabled ? 'not-allowed' : 'pointer' }}>
						Include microphone audio
					</label>
				</div>
			)}
		</div>
	)
}

export default AudioSourceSelector
