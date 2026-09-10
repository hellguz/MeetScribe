import React from 'react'
import { AppTheme } from '../styles/theme'
import type { LocalSummaryState } from '../ondevice/summary/useLocalSummary'
import { formatBytes } from '../utils/formatBytes'
import Spinner from './Spinner'
import { LockIcon } from './Icons'

/**
 * What the on-device summariser is doing right now.
 *
 * The panel this replaces was an instrument for an experiment — every timing,
 * next to a Claude summary to judge it against. A local meeting has no other
 * summary, so the only question left is "is it working, and how long will it
 * take", which is four lines rather than forty.
 */

const fmtMs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`)

interface Props {
	theme: AppTheme
	state: LocalSummaryState
	busy: boolean
	webgpuAvailable: boolean
	onGenerate: () => void
	onCancel: () => void
	/** Offered when the run failed, or when the user declined earlier. */
	onUseCloud?: () => void
	/**
	 * The summariser is busy with a different meeting. One model on one GPU,
	 * so this one has to wait — and offering a button that quietly does
	 * nothing would be worse than saying so.
	 */
	blocked?: boolean
}

const LocalSummaryProgress: React.FC<Props> = ({ theme, state, busy, webgpuAvailable, onGenerate, onCancel, onUseCloud, blocked = false }) => {
	const { phase, statusText, error, download, prefill, decode, measured } = state

	const detail = (): string | null => {
		if (download && !download.total) return 'Downloading the model…'
		if (download && download.total > 0 && phase === 'loading') {
			const pct = Math.round((download.loaded / download.total) * 100)
			return `Downloading the model — ${formatBytes(download.loaded)} of ${formatBytes(download.total)} (${pct}%)`
		}
		if (phase === 'prefilling' && prefill) {
			const pct = prefill.total > 0 ? Math.round((prefill.processed / prefill.total) * 100) : 0
			const eta = prefill.etaMs ? ` · ~${fmtMs(prefill.etaMs)} left` : ''
			return `Reading the transcript — ${pct}%${eta}`
		}
		if (phase === 'generating' && decode) {
			const rate = decode.tokensPerSecond ? ` · ${decode.tokensPerSecond.toFixed(1)} words/s` : ''
			return `Writing the summary${rate}`
		}
		return statusText
	}

	const card: React.CSSProperties = {
		marginBottom: '12px',
		padding: '12px 14px',
		borderRadius: '8px',
		border: `1px solid ${error ? '#f59e0b66' : theme.border}`,
		backgroundColor: error ? '#f59e0b0f' : theme.background,
		fontSize: '13px',
		color: theme.text,
	}

	const button = (label: string, onClick: () => void, primary = false): React.ReactElement => (
		<button
			type="button"
			onClick={onClick}
			style={{
				padding: '7px 12px',
				borderRadius: '6px',
				border: primary ? '1px solid transparent' : `1px solid ${theme.border}`,
				backgroundColor: primary ? theme.button.primary : 'transparent',
				color: primary ? theme.button.primaryText : theme.text,
				font: 'inherit',
				cursor: 'pointer',
			}}>
			{label}
		</button>
	)

	if (!webgpuAvailable) {
		return (
			<div style={card}>
				<strong>This browser cannot write the summary.</strong>
				<p style={{ margin: '5px 0 10px', color: theme.secondaryText, lineHeight: 1.5 }}>
					On-device summarizing needs WebGPU — Chrome, Edge, or Safari 26+ on a desktop. Your transcript is safe on this device either way.
				</p>
				{onUseCloud && button('Summarize in the cloud…', onUseCloud)}
			</div>
		)
	}

	if (error) {
		return (
			<div style={card}>
				<strong>The summary didn't finish.</strong>
				<p style={{ margin: '5px 0 10px', color: theme.secondaryText, lineHeight: 1.5, wordBreak: 'break-word' }}>{error}</p>
				<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
					{button('Try again', onGenerate, true)}
					{onUseCloud && button('Summarize in the cloud…', onUseCloud)}
				</div>
				<p style={{ margin: '9px 0 0', color: theme.secondaryText, lineHeight: 1.45 }}>
					Your transcript is saved on this device. Keeping it without a summary is fine too.
				</p>
			</div>
		)
	}

	if (busy) {
		return (
			<div style={card}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
					<Spinner label="Summarizing on this device" />
					<span style={{ flex: 1, minWidth: 0 }}>{detail() ?? 'Summarizing on this device…'}</span>
					{button('Stop', onCancel)}
				</div>
				{measured.totalMs !== null && (
					<div style={{ marginTop: '7px', color: theme.secondaryText }}>Finished in {fmtMs(measured.totalMs)}</div>
				)}
			</div>
		)
	}

	// Idle with no summary yet: the meeting has a transcript and is waiting.
	return (
		<div style={card}>
			<span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
				<LockIcon size={13} />
				<strong>Summarize on this device</strong>
			</span>
			<p style={{ margin: '5px 0 10px', color: theme.secondaryText, lineHeight: 1.5 }}>
				{blocked
					? 'The summariser is finishing another meeting. This one starts as soon as it is free — there is one model and one graphics card.'
					: 'Runs Qwen3-4B on your graphics card. Nothing leaves this browser.'}
			</p>
			{blocked ? (
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: theme.secondaryText }}>
					<Spinner label="Waiting for the summariser" />
					Waiting its turn
				</span>
			) : (
				button('Generate summary', onGenerate, true)
			)}
		</div>
	)
}

export default LocalSummaryProgress
