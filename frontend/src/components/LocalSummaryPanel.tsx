import React, { useState } from 'react'
import { AppTheme } from '../styles/theme'
import { SUMMARY_MODELS } from '../ondevice/summary/models'
import { useLocalSummaryPrefs } from '../ondevice/summary/pref'
import type { LocalSummaryRun } from '../ondevice/summary/api'
import type { LocalSummaryState } from '../ondevice/summary/useLocalSummary'
import { formatBytes } from './OnDevicePanel'
import Spinner from './Spinner'

const fmtMs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`)

interface Props {
	theme: AppTheme
	state: LocalSummaryState
	busy: boolean
	webgpuAvailable: boolean
	/** The meeting's current mode; the local run is given the same one. */
	summaryLength: string
	onGenerate: () => void
	onCancel: () => void
	/** Runs already recorded, so the panel can say what has been tried. */
	runs: LocalSummaryRun[]
}

/**
 * The "🧠 On this device" card on the summary page: pick a size, generate,
 * and watch the numbers. Everything it shows was measured in this browser.
 *
 * The card stays visible after a run so the settings for the next one are
 * one click away — comparing 2B against 4B against thinking-on is the
 * reason the feature exists, and each of those is a separate generate.
 */
const LocalSummaryPanel: React.FC<Props> = ({ theme, state, busy, webgpuAvailable, summaryLength, onGenerate, onCancel, runs }) => {
	const { model, setModel, thinking, setThinking } = useLocalSummaryPrefs()
	const [showLog, setShowLog] = useState(false)
	const { measured } = state

	const chip = (active: boolean, disabled: boolean): React.CSSProperties => ({
		padding: '4px 10px',
		borderRadius: '999px',
		fontSize: '12px',
		border: `1px solid ${active ? theme.text : theme.border}`,
		backgroundColor: active ? theme.text : 'transparent',
		color: active ? theme.body : theme.secondaryText,
		cursor: disabled ? 'default' : 'pointer',
		opacity: disabled ? 0.6 : 1,
		userSelect: 'none',
	})

	const downloadPct = state.download && state.download.total > 0 ? Math.min(100, (state.download.loaded / state.download.total) * 100) : 0

	// Decode speed is the honest headline number: prefill is one-off per
	// meeting, but tokens-per-second is what the wait actually feels like.
	const decodeRate = measured.outputTokens && measured.decodeMs ? measured.outputTokens / (measured.decodeMs / 1000) : null
	const prefillRate = measured.promptTokens && measured.prefillMs ? measured.promptTokens / (measured.prefillMs / 1000) : null

	const statParts: string[] = []
	if (measured.device) statParts.push(measured.device === 'webgpu' ? `GPU · ${measured.dtype}` : `${measured.device} · ${measured.dtype}`)
	if (measured.cached) statParts.push('model cached')
	else if (measured.downloadBytes) statParts.push(`downloaded ${formatBytes(measured.downloadBytes)}${measured.downloadMs ? ` in ${fmtMs(measured.downloadMs)}` : ''}`)
	if (measured.loadMs !== null) statParts.push(`loaded in ${fmtMs(measured.loadMs)}`)
	if (measured.promptTokens !== null) statParts.push(`${measured.promptTokens.toLocaleString()} prompt tokens`)
	if (measured.prefillMs !== null) statParts.push(`prefill ${fmtMs(measured.prefillMs)}${prefillRate ? ` (${Math.round(prefillRate)} tok/s)` : ''}`)
	if (measured.outputTokens !== null) statParts.push(`${measured.outputTokens.toLocaleString()} out${decodeRate ? ` at ${decodeRate.toFixed(1)} tok/s` : ''}`)
	if (measured.totalMs !== null) statParts.push(`total ${fmtMs(measured.totalMs)}`)

	return (
		<div
			style={{
				marginBottom: '12px',
				padding: '10px 14px',
				borderRadius: '12px',
				border: `1px solid ${theme.border}`,
				backgroundColor: theme.background,
				fontSize: '13px',
				color: theme.text,
			}}>
			<div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
				<span style={{ fontWeight: 600 }}>🧠 Summarize on this device</span>
				<span style={{ fontSize: '11px', color: theme.secondaryText, letterSpacing: '0.08em', border: `1px solid ${theme.border}`, borderRadius: 4, padding: '1px 5px' }}>EXPERIMENTAL</span>
				<span style={{ color: theme.secondaryText }}>· same prompt as Claude, mode “{summaryLength}”</span>
			</div>

			{!webgpuAvailable ? (
				<p style={{ margin: '8px 0 0', color: '#d97706', lineHeight: 1.45 }}>
					⚠️ This browser has no WebGPU, so there is nothing to run the model on. Chrome, Edge, or Safari 26+ on a desktop.
				</p>
			) : (
				<>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0 0', alignItems: 'center' }}>
						{SUMMARY_MODELS.map((m) => (
							<span key={m.id} style={chip(model === m.id, busy)} onClick={() => !busy && setModel(m.id)} title={m.note}>
								{m.label} · {formatBytes(m.bytes)}
							</span>
						))}
						<span style={{ width: 8 }} />
						<span style={chip(thinking, busy)} onClick={() => !busy && setThinking(!thinking)} title="Let the model reason before writing. Much slower; sometimes better structure.">
							{thinking ? 'Thinking on' : 'Thinking off'}
						</span>
					</div>

					<div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
						<button
							onClick={busy ? onCancel : onGenerate}
							style={{
								padding: '7px 14px',
								border: busy ? `1px solid ${theme.border}` : 'none',
								borderRadius: '6px',
								backgroundColor: busy ? theme.background : theme.button.primary,
								color: busy ? theme.text : theme.button.primaryText,
								fontSize: '14px',
								fontWeight: 500,
								fontFamily: 'inherit',
								cursor: 'pointer',
							}}>
							{busy ? 'Stop' : runs.length > 0 ? 'Generate again' : 'Generate here'}
						</button>
						{busy && state.statusText && (
							<span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: theme.secondaryText }}>
								<Spinner label={state.statusText} />
								{state.statusText}
							</span>
						)}
						{!busy && runs.length > 0 && (
							<span style={{ color: theme.secondaryText }}>
								{runs.length} run{runs.length === 1 ? '' : 's'} recorded — switch versions above the summary
							</span>
						)}
					</div>

					{state.download && state.download.total > 0 && state.download.loaded < state.download.total && (
						<>
							<div style={{ marginTop: 8, color: theme.secondaryText }}>
								⬇️ {formatBytes(state.download.loaded)} / {formatBytes(state.download.total)}
							</div>
							<div style={{ height: 6, borderRadius: 3, backgroundColor: theme.backgroundSecondary, overflow: 'hidden', marginTop: 6 }}>
								<div style={{ width: `${downloadPct}%`, height: '100%', backgroundColor: theme.text, transition: 'width 0.3s' }} />
							</div>
						</>
					)}

					{/* Prefill is the long silent phase on a big transcript. Say so,
					    or a two-minute wait with no output looks like a hang. */}
					{state.phase === 'prefilling' && measured.promptChars !== null && (
						<p style={{ margin: '8px 0 0', color: theme.secondaryText, lineHeight: 1.45 }}>
							Reading {Math.round(measured.promptChars / 1000)}k characters of transcript. Nothing appears until this finishes.
						</p>
					)}

					{statParts.length > 0 && (
						<div style={{ marginTop: 8, color: theme.secondaryText, lineHeight: 1.5 }} title="Measured in this browser">
							⚡ {statParts.join(' · ')}
						</div>
					)}

					{state.error && <p style={{ margin: '8px 0 0', color: theme.button.danger, wordBreak: 'break-word' }}>❌ {state.error}</p>}

					{state.log.length > 0 && (
						<div style={{ marginTop: 8, fontSize: '11px', color: theme.secondaryText, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
							<div style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => setShowLog((v) => !v)} title="Worker log">
								{showLog ? '▾' : '▸'} {state.log[state.log.length - 1]}
							</div>
							{showLog && (
								<pre style={{ margin: '4px 0 0', maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '6px 8px', borderRadius: 6, backgroundColor: theme.backgroundSecondary }}>
									{state.log.join('\n')}
								</pre>
							)}
						</div>
					)}
				</>
			)}
		</div>
	)
}

export default LocalSummaryPanel
