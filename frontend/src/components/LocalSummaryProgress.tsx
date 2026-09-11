import React from 'react'
import { AppTheme } from '../styles/theme'
import type { LocalSummaryState } from '../ondevice/summary/useLocalSummary'
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
	/**
	 * Why the *stored* record says the last attempt stopped.
	 *
	 * Set when this page never saw the run — it happened in a tab that has
	 * since been closed. Without it a meeting whose automatic retries had all
	 * failed showed the plain "Summarize on this device" card, as though it
	 * had simply never been tried.
	 */
	storedError?: string | null
}

const LocalSummaryProgress: React.FC<Props> = ({ theme, state, busy, webgpuAvailable, onGenerate, onCancel, onUseCloud, blocked = false, storedError = null }) => {
	const { phase, statusText, error, download, measured } = state

	/**
	 * What is happening, in words and nothing else.
	 *
	 * The numbers used to live here as well — megabytes downloaded of
	 * megabytes, the prefill percentage and its ETA, the decode rate — from
	 * before there was anywhere else to put them. The dial in the top bar now
	 * carries all of it, and having both meant reading
	 * "Downloading the model — 3.05 GB of 3.05 GB (100%)" underneath a dial
	 * that had just said the same thing more briefly.
	 *
	 * So this line names the step and this card keeps the Stop button, which
	 * is the thing the dial cannot be.
	 */
	const detail = (): string => {
		switch (phase) {
			case 'prompt':
				return 'Reading the transcript'
			case 'loading':
				// "Downloading" only while bytes are actually moving; a model
				// already on disk goes straight to loading it into the GPU.
				return download && download.total > 0 && download.loaded < download.total ? 'Downloading the model' : 'Loading the model'
			case 'prefilling':
				return 'Reading the transcript'
			case 'generating':
				return 'Writing the summary'
			case 'titling':
				return 'Naming the meeting'
			case 'saving':
				return 'Saving to this device'
			default:
				return statusText ?? 'Summarizing on this device'
		}
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
					<span style={{ flex: 1, minWidth: 0 }}>{detail()}</span>
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
		<div style={{ ...card, border: `1px solid ${storedError ? '#f59e0b66' : theme.border}` }}>
			<span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
				<LockIcon size={13} />
				<strong>{storedError ? 'This summary needs another go' : 'Summarize on this device'}</strong>
			</span>
			<p style={{ margin: '5px 0 10px', color: theme.secondaryText, lineHeight: 1.5, wordBreak: 'break-word' }}>
				{blocked
					? 'The summariser is finishing another meeting. This one starts as soon as it is free — there is one model and one graphics card.'
					: storedError
						? `The last attempt stopped: ${storedError} Your transcript is saved on this device either way.`
						: 'Runs Qwen3-4B on your graphics card. Nothing leaves this browser.'}
			</p>
			{blocked ? (
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: theme.secondaryText }}>
					<Spinner label="Waiting for the summariser" />
					Waiting its turn
				</span>
			) : (
				button(storedError ? 'Try again' : 'Generate summary', onGenerate, true)
			)}
		</div>
	)
}

export default LocalSummaryProgress
