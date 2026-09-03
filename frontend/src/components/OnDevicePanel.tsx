import React from 'react'
import { AppTheme } from '../styles/theme'
import type { OnDeviceController } from '../ondevice/useOnDevice'
import { PLAN_DOWNLOAD_BYTES, PLAN_LABELS, type PlanChoice } from '../ondevice/capabilities'

interface OnDevicePanelProps {
	controller: OnDeviceController
	theme: AppTheme
	/** Recording or processing: hide the controls, keep the live numbers. */
	locked: boolean
}

export const formatBytes = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.round(bytes / 1e3)} kB`)
const formatSeconds = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`)

const STAGE_LABEL: Record<string, string> = {
	segmenting: 'Finding speech',
	embedding: 'Fingerprinting voices',
	clustering: 'Grouping speakers',
}

/**
 * The "⚡ On this device" card on the record page: a switch, the model plan,
 * device warnings, and — once enabled — live numbers for the download, the
 * transcription speed and the speaker pass. Everything it shows is measured
 * in the browser; nothing comes from the server.
 */
const OnDevicePanel: React.FC<OnDevicePanelProps> = ({ controller, theme, locked }) => {
	const { state, setEnabled, setPlanChoice } = controller
	const { enabled, phase, caps, plan, download, transcription, diarization, error } = state

	const chip = (active: boolean): React.CSSProperties => ({
		padding: '4px 10px',
		borderRadius: '999px',
		fontSize: '12px',
		border: `1px solid ${active ? theme.text : theme.border}`,
		backgroundColor: active ? theme.text : 'transparent',
		color: active ? theme.body : theme.secondaryText,
		cursor: locked ? 'default' : 'pointer',
		userSelect: 'none',
	})

	const speed = transcription.processMs > 0 ? transcription.audioSeconds / (transcription.processMs / 1000) : null
	const downloadPct = download && download.total > 0 ? Math.min(100, (download.loaded / download.total) * 100) : 0
	const downloadEta = download && download.bytesPerSec > 0 && !download.done ? (download.total - download.loaded) / download.bytesPerSec : null
	const planBytes = plan ? PLAN_DOWNLOAD_BYTES[plan] : null

	const statusLine = (() => {
		if (!enabled) return null
		if (phase === 'idle') return { icon: '⏳', text: 'Checking this device…' }
		if (phase === 'error') return { icon: '❌', text: error ?? 'Failed' }
		if (phase === 'fallback') return { icon: '↩️', text: `Handed over to the server${error ? ` (${error})` : ''}` }
		if (phase === 'loading') {
			if (download && !download.done && download.total > 0) return { icon: '⬇️', text: `Downloading Parakeet ${formatBytes(download.loaded)} / ${formatBytes(download.total)} · ${formatBytes(download.bytesPerSec)}/s${downloadEta !== null ? ` · ~${formatSeconds(downloadEta)} left` : ''}` }
			return { icon: '⏳', text: download?.done ? 'Loading model into memory…' : caps ? 'Preparing model (cached files load instantly)…' : 'Checking this device…' }
		}
		if (phase === 'ready' || phase === 'diarizing' || phase === 'finalizing') {
			const parts: string[] = []
			if (state.backend) parts.push(state.backend === 'webgpu' ? 'GPU (WebGPU)' : `CPU · ${state.threads ?? 1} thread${(state.threads ?? 1) === 1 ? '' : 's'}`)
			if (state.modelLoadMs !== null) parts.push(`ready in ${formatSeconds(state.modelLoadMs / 1000)}`)
			if (download?.done && download.total > 0) parts.push(`downloaded ${formatBytes(download.total)} in ${formatSeconds((download.loaded / Math.max(download.bytesPerSec, 1)))}`)
			else if (download?.done) parts.push('models were cached')
			return { icon: '✅', text: parts.join(' · ') }
		}
		return null
	})()

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
			<label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: locked ? 'default' : 'pointer' }}>
				<input type="checkbox" checked={enabled} disabled={locked} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16, margin: 0, accentColor: theme.text }} />
				<span style={{ fontWeight: 600 }}>⚡ Transcribe on this device</span>
				<span style={{ fontSize: '11px', color: theme.secondaryText, letterSpacing: '0.08em', border: `1px solid ${theme.border}`, borderRadius: 4, padding: '1px 5px' }}>EXPERIMENTAL</span>
			</label>

			{!locked && (
				<p style={{ margin: '6px 0 0 26px', color: theme.secondaryText, lineHeight: 1.45 }}>
					Parakeet TDT 0.6B v3 (25 European languages) and speaker identification run in your browser; only the text goes to the server, which still stores the audio and writes the Claude summary. Live recordings only.
				</p>
			)}

			{enabled && !locked && (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0 0 26px', alignItems: 'center' }}>
					{(['auto', 'gpu-fp16', 'cpu-int8'] as PlanChoice[]).map((choice) => (
						<span key={choice} style={chip(state.planChoice === choice)} onClick={() => !locked && setPlanChoice(choice)}>
							{choice === 'auto' ? `Auto${caps ? ` → ${PLAN_LABELS[caps.recommended].split(' · ')[0]}` : ''}` : PLAN_LABELS[choice]}
						</span>
					))}
					{planBytes && phase === 'idle' && <span style={{ color: theme.secondaryText }}>~{formatBytes(planBytes)} once, then cached</span>}
				</div>
			)}

			{enabled && !locked && caps && caps.warnings.length > 0 && (
				<ul style={{ margin: '8px 0 0 26px', padding: 0, listStyle: 'none', color: '#d97706', lineHeight: 1.4 }}>
					{caps.warnings.map((w) => (
						<li key={w}>⚠️ {w}</li>
					))}
				</ul>
			)}

			{statusLine && (
				<div style={{ margin: `8px 0 0 ${locked ? 0 : 26}px`, color: phase === 'error' ? theme.button.danger : theme.secondaryText, wordBreak: 'break-word' }}>
					{statusLine.icon} {statusLine.text}
				</div>
			)}

			{enabled && phase === 'loading' && download && !download.done && download.total > 0 && (
				<div style={{ height: 6, borderRadius: 3, backgroundColor: theme.backgroundSecondary, overflow: 'hidden', margin: `6px 0 0 ${locked ? 0 : 26}px` }}>
					<div style={{ width: `${downloadPct}%`, height: '100%', backgroundColor: theme.text, transition: 'width 0.3s' }} />
				</div>
			)}

			{enabled && locked && (transcription.done > 0 || transcription.queued > 0) && (
				<div style={{ marginTop: 6, color: theme.secondaryText }}>
					🎤 Transcribed {transcription.done} chunk{transcription.done === 1 ? '' : 's'}
					{transcription.queued > 0 ? ` · ${transcription.queued} waiting` : ''}
					{speed !== null ? ` · ${speed.toFixed(1)}× realtime` : ''}
					{transcription.done > 0 ? ` · ${formatSeconds(transcription.processMs / 1000)} for ${formatSeconds(transcription.audioSeconds)} of audio` : ''}
				</div>
			)}

			{enabled && phase === 'diarizing' && (
				<div style={{ marginTop: 6, color: theme.secondaryText }}>
					🗣️ {STAGE_LABEL[diarization.stage ?? ''] ?? 'Identifying speakers'}
					{diarization.total > 0 ? ` ${diarization.done}/${diarization.total}` : ''}…
					{diarization.total > 0 && (
						<div style={{ height: 6, borderRadius: 3, backgroundColor: theme.backgroundSecondary, overflow: 'hidden', marginTop: 6 }}>
							<div style={{ width: `${Math.min(100, (diarization.done / diarization.total) * 100)}%`, height: '100%', backgroundColor: theme.text, transition: 'width 0.2s' }} />
						</div>
					)}
				</div>
			)}

			{enabled && phase === 'finalizing' && (
				<div style={{ marginTop: 6, color: theme.secondaryText }}>
					🗣️ {diarization.speakers !== null ? `${diarization.speakers} speaker${diarization.speakers === 1 ? '' : 's'} found` : 'No speaker labels'}
					{diarization.ms !== null ? ` in ${formatSeconds(diarization.ms / 1000)}` : ''} · transcript sent, Claude is writing the summary…
				</div>
			)}
		</div>
	)
}

export default OnDevicePanel
