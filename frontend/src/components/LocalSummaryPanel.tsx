import React, { useState } from 'react'
import { AppTheme } from '../styles/theme'
import { SUMMARY_MODELS } from '../ondevice/summary/models'
import { useLocalSummaryPrefs } from '../ondevice/summary/pref'
import type { LocalSummaryRun } from '../ondevice/summary/api'
import type { LocalSummaryState } from '../ondevice/summary/useLocalSummary'
import { formatBytes } from './OnDevicePanel'
import Spinner from './Spinner'

const fmtMs = (ms: number) =>
	ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
const fmtRate = (tps: number) => `${tps >= 10 ? Math.round(tps) : tps.toFixed(1)} tok/s`

type StepState = 'pending' | 'active' | 'done' | 'failed'

/**
 * One line of the run's progress: where it is, what that step has done so
 * far, and — while it is the live one — how far along.
 *
 * The panel used to say one thing at a time ("Reading the transcript…")
 * with no way to tell a slow step from a stuck one. Four labelled steps
 * with their own numbers answer both questions at a glance, and leave the
 * finished ones on screen as the record of what the run cost.
 */
const Step: React.FC<{ theme: AppTheme; state: StepState; label: string; detail: string | null; pct?: number | null }> = ({
	theme,
	state,
	label,
	detail,
	pct,
}) => (
	<div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', opacity: state === 'pending' ? 0.45 : 1, lineHeight: 1.5 }}>
		<span style={{ width: 14, flexShrink: 0 }}>{state === 'done' ? '✅' : state === 'failed' ? '❌' : state === 'active' ? '⏳' : '·'}</span>
		<span style={{ width: 78, flexShrink: 0, color: theme.secondaryText }}>{label}</span>
		<span style={{ flex: 1, minWidth: 0 }}>
			<span style={{ color: theme.secondaryText, wordBreak: 'break-word' }}>{detail ?? '—'}</span>
			{state === 'active' && typeof pct === 'number' && (
				<span style={{ display: 'block', height: 4, borderRadius: 2, backgroundColor: theme.backgroundSecondary, overflow: 'hidden', marginTop: 4 }}>
					<span
						style={{ display: 'block', width: `${Math.max(2, Math.min(100, pct))}%`, height: '100%', backgroundColor: theme.text, transition: 'width 0.3s' }}
					/>
				</span>
			)}
		</span>
	</div>
)

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
 * one click away, and so the measurements from the last one stay readable.
 * The model chip is a choice only while more than one model is offered;
 * with a single model it is there to say what ran.
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

	// A one-model catalogue makes the chip a label. Anything else reads as a
	// control that does nothing.
	const pickable = SUMMARY_MODELS.length > 1

	const { hardware, prefill, decode } = state
	const downloadPct = state.download && state.download.total > 0 ? Math.min(100, (state.download.loaded / state.download.total) * 100) : 0

	// Decode speed is the honest headline number: prefill is one-off per
	// meeting, but tokens-per-second is what the wait actually feels like.
	const decodeRate = measured.outputTokens && measured.decodeMs ? measured.outputTokens / (measured.decodeMs / 1000) : null
	const prefillRate = measured.promptTokens && measured.prefillMs ? measured.promptTokens / (measured.prefillMs / 1000) : null

	// Kept on screen for a failed run too — which step was live when it
	// broke is most of the diagnosis. A finished run has the ⚡ recap below
	// instead.
	const running = state.phase !== 'idle' && state.phase !== 'done'

	// One row per thing that takes time. `state` here is the step's own,
	// not the panel's: pending until the run reaches it, active while it is
	// the one running, done once its measurement has landed.
	const steps: { label: string; state: StepState; detail: string | null; pct?: number | null }[] = [
		{
			label: 'Device',
			state: hardware ? 'done' : running ? 'active' : 'pending',
			detail: hardware
				? [
						hardware.device === 'webgpu' ? 'GPU (WebGPU)' : `CPU (${hardware.device})`,
						hardware.adapter,
						hardware.maxBufferSize ? `max buffer ${formatBytes(hardware.maxBufferSize)}` : null,
						hardware.cores ? `${hardware.cores} cores` : null,
					]
						.filter(Boolean)
						.join(' · ')
				: 'Asking the browser for a GPU adapter…',
		},
		{
			label: 'Model',
			state: measured.loadMs !== null ? 'done' : state.phase === 'loading' ? 'active' : 'pending',
			detail:
				measured.loadMs !== null
					? [
							measured.downloadBytes
								? `${measured.cached ? 'read' : 'downloaded'} ${formatBytes(measured.downloadBytes)}${measured.downloadMs ? ` in ${fmtMs(measured.downloadMs)}` : ''}${measured.cached ? ' from cache' : ''}`
								: measured.cached
									? 'from cache'
									: null,
							`ready in ${fmtMs(measured.loadMs)}`,
							measured.dtype,
						]
							.filter(Boolean)
							.join(' · ')
					: state.download && state.download.total > 0
						? `${formatBytes(state.download.loaded)} / ${formatBytes(state.download.total)}${state.download.file ? ` · ${state.download.file}` : ''}`
						: 'Building the ONNX sessions…',
			pct: downloadPct,
		},
		{
			label: 'Reading',
			state: measured.prefillMs !== null ? 'done' : state.phase === 'prefilling' ? 'active' : 'pending',
			detail:
				measured.prefillMs !== null
					? `${(measured.promptTokens ?? 0).toLocaleString()} prompt tokens in ${fmtMs(measured.prefillMs)}${prefillRate ? ` · ${fmtRate(prefillRate)}` : ''}`
					: prefill
						? `${prefill.processed.toLocaleString()} / ${prefill.total.toLocaleString()} tokens${prefill.tokensPerSecond ? ` · ${fmtRate(prefill.tokensPerSecond)}` : ''}${prefill.etaMs ? ` · ~${fmtMs(prefill.etaMs)} left` : ''}`
						: measured.promptChars !== null
							? `${Math.round(measured.promptChars / 1000)}k characters of transcript`
							: null,
			pct: prefill && prefill.total > 0 ? (prefill.processed / prefill.total) * 100 : 0,
		},
		{
			label: 'Writing',
			state: measured.outputTokens !== null ? 'done' : state.phase === 'generating' ? 'active' : 'pending',
			detail:
				measured.outputTokens !== null
					? `${measured.outputTokens.toLocaleString()} tokens in ${fmtMs(measured.decodeMs ?? 0)}${decodeRate ? ` · ${fmtRate(decodeRate)}` : ''}`
					: decode
						? `${decode.tokens.toLocaleString()} tokens${decode.tokensPerSecond ? ` · ${fmtRate(decode.tokensPerSecond)}` : ''}`
						: null,
			// Against the cap, which is a ceiling and not a target — most
			// runs stop well short of it, so the bar is a hint, not a promise.
			pct: decode && decode.max > 0 ? (decode.tokens / decode.max) * 100 : 0,
		},
	]

	// On a failure the step that was running is the one that failed; saying
	// so beats leaving an hourglass next to it forever.
	if (state.phase === 'error') {
		const live = steps.find((step) => step.state === 'active')
		if (live) live.state = 'failed'
	}

	const statParts: string[] = []
	// Names the adapter, not just "GPU": two machines with the same browser
	// and wildly different tok/s is the comparison this panel exists for.
	if (measured.device) statParts.push([measured.device === 'webgpu' ? 'GPU' : measured.device, hardware?.adapter, measured.dtype].filter(Boolean).join(' · '))
	if (measured.downloadBytes)
		statParts.push(`${measured.cached ? 'read' : 'downloaded'} ${formatBytes(measured.downloadBytes)}${measured.downloadMs ? ` in ${fmtMs(measured.downloadMs)}` : ''}${measured.cached ? ' from cache' : ''}`)
	else if (measured.cached) statParts.push('model cached')
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
				<span
					style={{
						fontSize: '11px',
						color: theme.secondaryText,
						letterSpacing: '0.08em',
						border: `1px solid ${theme.border}`,
						borderRadius: 4,
						padding: '1px 5px',
					}}>
					EXPERIMENTAL
				</span>
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
							<span
								key={m.id}
								style={{ ...chip(model === m.id, busy), cursor: pickable && !busy ? 'pointer' : 'default' }}
								onClick={() => pickable && !busy && setModel(m.id)}
								title={m.note}>
								{m.label} · {formatBytes(m.bytes)}
							</span>
						))}
						<span style={{ width: 8 }} />
						<span
							style={chip(thinking, busy)}
							onClick={() => !busy && setThinking(!thinking)}
							title="Let the model reason before writing. Much slower; sometimes better structure.">
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

					{/* Every step the run goes through, with the one it is on
					    counting. Prefill in particular is a long silent phase on a
					    big transcript — without a number it reads as a hang. */}
					{running && (
						<div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, backgroundColor: theme.backgroundSecondary }}>
							{steps.map((step) => (
								<Step key={step.label} theme={theme} state={step.state} label={step.label} detail={step.detail} pct={step.pct} />
							))}
							{state.phase === 'prefilling' && (
								<div style={{ marginTop: 4, color: theme.secondaryText, opacity: 0.8 }}>Nothing appears until the whole transcript has been read.</div>
							)}
						</div>
					)}

					{statParts.length > 0 && (
						<div style={{ marginTop: 8, color: theme.secondaryText, lineHeight: 1.5 }} title="Measured in this browser">
							⚡ {statParts.join(' · ')}
						</div>
					)}

					{state.error && <p style={{ margin: '8px 0 0', color: theme.button.danger, wordBreak: 'break-word' }}>❌ {state.error}</p>}

					{state.log.length > 0 && (
						<div style={{ marginTop: 8, fontSize: '11px', color: theme.secondaryText, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
							<div
								style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
								onClick={() => setShowLog((v) => !v)}
								title="Worker log">
								{showLog ? '▾' : '▸'} {state.log[state.log.length - 1]}
							</div>
							{showLog && (
								<pre
									style={{
										margin: '4px 0 0',
										maxHeight: 160,
										overflow: 'auto',
										whiteSpace: 'pre-wrap',
										wordBreak: 'break-word',
										padding: '6px 8px',
										borderRadius: 6,
										backgroundColor: theme.backgroundSecondary,
									}}>
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
