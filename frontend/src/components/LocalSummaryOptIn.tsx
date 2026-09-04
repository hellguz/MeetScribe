import React from 'react'
import { AppTheme } from '../styles/theme'
import { useLocalSummaryPrefs } from '../ondevice/summary/pref'
import { modelById, shortModelName } from '../ondevice/summary/models'
import { formatBytes } from './OnDevicePanel'

/**
 * The "🧠 Summarize on this device" opt-in, sitting under the transcription
 * card on the record page.
 *
 * Deliberately separate from the transcription switch: that one only
 * applies to a live recording, while this applies to any meeting after the
 * fact — including uploads and meetings recorded months ago. Turning it on
 * changes nothing on its own; it makes the generate button appear on the
 * summary page, which is where the model actually runs.
 */
const LocalSummaryOptIn: React.FC<{ theme: AppTheme }> = ({ theme }) => {
	const { enabled, setEnabled, model } = useLocalSummaryPrefs()
	const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator
	const chosen = modelById(model)

	return (
		<div
			style={{
				marginBottom: '12px',
				padding: '10px 14px',
				borderRadius: '12px',
				border: `1px solid ${enabled ? theme.text : theme.border}`,
				backgroundColor: theme.background,
				fontSize: '13px',
				color: theme.text,
			}}>
			<label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
				<input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16, margin: 0, accentColor: theme.text }} />
				<span style={{ fontWeight: 600 }}>🧠 Summarize on this device</span>
				<span style={{ fontSize: '11px', color: theme.secondaryText, letterSpacing: '0.08em', border: `1px solid ${theme.border}`, borderRadius: 4, padding: '1px 5px' }}>EXPERIMENTAL</span>
			</label>

			<p style={{ margin: '6px 0 0 26px', color: theme.secondaryText, lineHeight: 1.45 }}>
				Adds a <strong>Generate here</strong> button to every summary page, which runs {chosen ? shortModelName(model) : 'Qwen3.5'} in your
				browser over the same prompt Claude gets. The Claude summary is never replaced — the two sit side by side so you can judge which is
				better.
			</p>

			{enabled && (
				<ul style={{ margin: '8px 0 0 26px', padding: 0, listStyle: 'none', color: webgpu ? theme.secondaryText : '#d97706', lineHeight: 1.4 }}>
					{!webgpu && <li>⚠️ No WebGPU in this browser, so this will not run at all. Chrome, Edge, or Safari 26+ on a desktop.</li>}
					{webgpu && chosen && <li>⬇️ ~{formatBytes(chosen.bytes)} the first time, then cached. Desktop only in practice — a phone has nowhere to put it.</li>}
				</ul>
			)}
		</div>
	)
}

export default LocalSummaryOptIn
