import React, { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { AppTheme } from '../styles/theme'
import { shortModelName } from '../ondevice/summary/models'
import type { LocalSummaryRun } from '../ondevice/summary/api'
import { formatBytes } from './OnDevicePanel'

/**
 * Which version of a summary the page is showing.
 *
 *   'cloud'   the real summary, editable, the one everything else uses
 *   <run id>  one on-device run, read-only
 *   'compare' cloud and the last-selected run, side by side
 */
export type SummaryView = 'cloud' | 'compare' | number

const fmtMs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`)

/** Read-only rendered markdown, styled like the editor's output. */
export const MarkdownView: React.FC<{ markdown: string; theme: AppTheme }> = ({ markdown, theme }) => {
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!ref.current) return
		ref.current.innerHTML = marked.parse(markdown || '') as string
		const first = ref.current.firstElementChild as HTMLElement | null
		if (first) first.style.marginTop = '0'
	}, [markdown])
	return <div ref={ref} className="markdown-content" style={{ lineHeight: 1.5, fontSize: '16px', color: theme.text }} />
}

/**
 * The version switch above the summary. Only rendered once at least one
 * on-device run exists — with none, there is nothing to switch between and
 * the page should look exactly as it always has.
 */
export const SummaryVersionTabs: React.FC<{
	theme: AppTheme
	runs: LocalSummaryRun[]
	view: SummaryView
	onSelect: (view: SummaryView) => void
}> = ({ theme, runs, view, onSelect }) => {
	const tab = (active: boolean): React.CSSProperties => ({
		padding: '5px 11px',
		borderRadius: '999px',
		fontSize: '13px',
		fontFamily: 'inherit',
		border: `1px solid ${active ? theme.text : theme.border}`,
		backgroundColor: active ? theme.text : 'transparent',
		color: active ? theme.body : theme.secondaryText,
		cursor: 'pointer',
		whiteSpace: 'nowrap',
	})

	return (
		<div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
			<button style={tab(view === 'cloud')} onClick={() => onSelect('cloud')} title="The real summary — the only editable one">
				☁️ Claude
			</button>
			{runs.map((run) => (
				<button
					key={run.id}
					style={tab(view === run.id)}
					onClick={() => onSelect(run.id)}
					title={`${run.model} · ${run.dtype} · ${run.thinking ? 'thinking on' : 'thinking off'} · ${new Date(run.created_at).toLocaleString()}`}>
					🧠 {shortModelName(run.model)}
					{run.thinking ? ' +think' : ''}
					{run.verdict ? ` · ${run.verdict === 'local' ? '👍' : run.verdict === 'cloud' ? '👎' : '🤝'}` : ''}
				</button>
			))}
			<button style={tab(view === 'compare')} onClick={() => onSelect('compare')} title="Claude and the selected on-device run, side by side">
				⇄ Side by side
			</button>
		</div>
	)
}

/** The measurements behind one run, spelled out under its text. */
export const RunStats: React.FC<{ run: LocalSummaryRun; theme: AppTheme }> = ({ run, theme }) => {
	const decodeRate = run.output_tokens && run.decode_ms ? run.output_tokens / (run.decode_ms / 1000) : null
	const prefillRate = run.prompt_tokens && run.prefill_ms ? run.prompt_tokens / (run.prefill_ms / 1000) : null

	let device: Record<string, unknown> = {}
	try {
		device = run.device_info ? JSON.parse(run.device_info) : {}
	} catch {
		device = {}
	}
	const gpu = [device.gpu_vendor, device.gpu_architecture].filter(Boolean).join(' ')

	const parts: string[] = []
	parts.push(`${shortModelName(run.model)} · ${run.dtype} · ${run.device}`)
	if (run.thinking) parts.push('thinking on')
	if (gpu) parts.push(gpu)
	if (device.cores) parts.push(`${device.cores} cores`)
	if (run.cached) parts.push('model cached')
	else if (run.download_bytes) parts.push(`downloaded ${formatBytes(run.download_bytes)}${run.download_ms ? ` in ${fmtMs(run.download_ms)}` : ''}`)
	if (run.load_ms) parts.push(`loaded in ${fmtMs(run.load_ms)}`)
	if (run.prompt_tokens) parts.push(`${run.prompt_tokens.toLocaleString()} in`)
	if (run.prefill_ms) parts.push(`prefill ${fmtMs(run.prefill_ms)}${prefillRate ? ` (${Math.round(prefillRate)} tok/s)` : ''}`)
	if (run.output_tokens) parts.push(`${run.output_tokens.toLocaleString()} out${decodeRate ? ` at ${decodeRate.toFixed(1)} tok/s` : ''}`)
	if (run.total_ms) parts.push(`total ${fmtMs(run.total_ms)}`)

	return (
		<div style={{ fontSize: '12px', color: theme.secondaryText, lineHeight: 1.5 }} title={`Generated ${new Date(run.created_at).toLocaleString()} in this browser`}>
			⚡ {parts.join(' · ')}
			{run.truncated && <div style={{ color: '#d97706', marginTop: 4 }}>⚠️ Hit the token cap, so the text is cut off — judge structure, not the ending.</div>}
		</div>
	)
}

/**
 * The point of the whole feature: a one-click judgement, stored server-side,
 * so a hundred meetings from now there is a real answer rather than a
 * recollection of a couple of good-looking summaries.
 */
export const VerdictBar: React.FC<{
	run: LocalSummaryRun
	theme: AppTheme
	onVerdict: (verdict: string | null, note: string | null) => Promise<void>
}> = ({ run, theme, onVerdict }) => {
	const [note, setNote] = useState(run.verdict_note ?? '')
	const [saving, setSaving] = useState(false)
	const [noteOpen, setNoteOpen] = useState(!!run.verdict_note)

	// A run selected from the tabs brings its own stored note with it.
	useEffect(() => {
		setNote(run.verdict_note ?? '')
		setNoteOpen(!!run.verdict_note)
	}, [run.id, run.verdict_note])

	const choose = async (verdict: string) => {
		setSaving(true)
		try {
			// Clicking the current verdict again clears it, so a misclick is
			// undoable without a separate control.
			await onVerdict(run.verdict === verdict ? null : verdict, note.trim() || null)
		} finally {
			setSaving(false)
		}
	}

	const option = (value: string): React.CSSProperties => ({
		padding: '5px 11px',
		borderRadius: '6px',
		fontSize: '13px',
		fontFamily: 'inherit',
		border: `1px solid ${run.verdict === value ? theme.text : theme.border}`,
		backgroundColor: run.verdict === value ? theme.text : theme.background,
		color: run.verdict === value ? theme.body : theme.text,
		cursor: saving ? 'wait' : 'pointer',
		opacity: saving ? 0.6 : 1,
	})

	return (
		<div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${theme.border}` }}>
			<div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', color: theme.secondaryText }}>
				<span>Which is better?</span>
				<button style={option('cloud')} onClick={() => choose('cloud')} disabled={saving}>
					☁️ Claude
				</button>
				<button style={option('tie')} onClick={() => choose('tie')} disabled={saving}>
					🤝 Tie
				</button>
				<button style={option('local')} onClick={() => choose('local')} disabled={saving}>
					🧠 On-device
				</button>
				{!noteOpen && (
					<button
						onClick={() => setNoteOpen(true)}
						style={{ background: 'none', border: 'none', color: theme.secondaryText, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', textDecoration: 'underline' }}>
						add a note
					</button>
				)}
				{run.verdict && !saving && <span style={{ color: theme.secondaryText }}>saved</span>}
			</div>
			{noteOpen && (
				<textarea
					value={note}
					onChange={(e) => setNote(e.target.value)}
					onBlur={() => run.verdict && onVerdict(run.verdict, note.trim() || null)}
					placeholder="What was wrong or right about it — missed decisions, wrong language, invented names…"
					style={{
						marginTop: '8px',
						width: '100%',
						minHeight: '48px',
						padding: '7px 10px',
						borderRadius: '6px',
						border: `1px solid ${theme.input.border}`,
						backgroundColor: theme.input.background,
						color: theme.input.text,
						fontSize: '14px',
						fontFamily: 'inherit',
						resize: 'vertical',
						boxSizing: 'border-box',
					}}
				/>
			)}
		</div>
	)
}

/**
 * The read-only views: one on-device run on its own, or Claude and that run
 * in two columns.
 *
 * Side by side is the view the feature exists for — the differences that
 * matter (a decision missed, a name invented, the wrong language) only show
 * up when both texts are on screen at once. It collapses to one column
 * under 900px, where two would be unreadable anyway.
 */
export const SummaryComparison: React.FC<{
	theme: AppTheme
	cloudMarkdown: string
	run: LocalSummaryRun
	compare: boolean
	onVerdict: (verdict: string | null, note: string | null) => Promise<void>
}> = ({ theme, cloudMarkdown, run, compare, onVerdict }) => {
	const card: React.CSSProperties = {
		backgroundColor: theme.background,
		borderRadius: '12px',
		border: `1px solid ${theme.border}`,
		padding: '16px 20px',
		minWidth: 0,
	}
	const heading: React.CSSProperties = { margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: theme.secondaryText, letterSpacing: '0.04em' }

	const localCard = (
		<div style={card}>
			<div style={heading}>🧠 {shortModelName(run.model)} — ON THIS DEVICE</div>
			<MarkdownView markdown={run.markdown} theme={theme} />
			<div style={{ marginTop: 12 }}>
				<RunStats run={run} theme={theme} />
			</div>
			<VerdictBar run={run} theme={theme} onVerdict={onVerdict} />
		</div>
	)

	if (!compare) return localCard

	// `min(100%, …)` so a track never demands more width than the container
	// has: on a narrow window this drops to one column instead of forcing
	// the page to scroll sideways.
	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '12px', alignItems: 'start' }}>
			<div style={card}>
				<div style={heading}>☁️ CLAUDE — THE REAL SUMMARY</div>
				<MarkdownView markdown={cloudMarkdown} theme={theme} />
			</div>
			{localCard}
		</div>
	)
}
