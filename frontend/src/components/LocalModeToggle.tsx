import React, { useEffect, useRef, useState } from 'react'
import { AppTheme } from '../styles/theme'
import { useLocalMode } from '../local/mode'
import { NOTABLE_MISSING, PARAKEET_LANGUAGES, SUPPORTED_COUNT } from '../local/languages'
import { measurePlanBytes } from '../ondevice/hub'
import { detectCapabilities, resolvePlan, type DeviceCapabilities } from '../ondevice/capabilities'
import { SUMMARY_MODELS } from '../ondevice/summary/models'
import { formatBytes } from '../utils/formatBytes'
import { LockIcon, UnlockIcon, AlertIcon } from './Icons'

/**
 * The Local mode switch, in the record page's top bar.
 *
 * A button, never a checkbox: clicking opens the panel, it does not flip the
 * state. Turning this on commits the user to a multi-gigabyte download, and
 * that must never happen from a stray click on the way to the theme toggle.
 */

const DIARIZATION_BYTES = 30_000_000 // campplus + pyannote segmentation, from /api/models

interface Props {
	theme: AppTheme
	/** Recording in progress: the switch must not move under a live meeting. */
	locked?: boolean
}

const LocalModeToggle: React.FC<Props> = ({ theme, locked = false }) => {
	const { enabled, enable, disable } = useLocalMode()
	const [open, setOpen] = useState(false)
	const [caps, setCaps] = useState<DeviceCapabilities | null>(null)
	const [speechBytes, setSpeechBytes] = useState<number | null>(null)
	const [showLanguages, setShowLanguages] = useState(false)
	// Not a blocker: local mode turns on either way, and this explains what the
	// browser would not promise.
	const [storageWarning, setStorageWarning] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const wrapRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		let live = true
		detectCapabilities().then((c) => {
			if (!live) return
			setCaps(c)
			// Ask the host rather than hardcoding: a self-hosted model base can
			// serve files nothing like the upstream sizes.
			measurePlanBytes(resolvePlan('auto', c)).then((b) => live && setSpeechBytes(b))
		})
		return () => {
			live = false
		}
	}, [open])

	// Click-outside and Escape, the two ways every popover should close.
	useEffect(() => {
		if (!open) return
		const onDown = (e: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
		}
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
		document.addEventListener('mousedown', onDown)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('mousedown', onDown)
			document.removeEventListener('keydown', onKey)
		}
	}, [open])

	const summaryBytes = SUMMARY_MODELS[0]?.bytes ?? 0
	const totalBytes = (speechBytes ?? 0) + DIARIZATION_BYTES + summaryBytes
	const noWebgpu = caps !== null && !caps.webgpu
	const mobile = caps?.isMobile ?? false

	const handleEnable = async () => {
		setBusy(true)
		setStorageWarning(null)
		const result = await enable()
		setBusy(false)
		// Enabling always succeeds. A warning keeps the panel open so it is
		// actually read; without one there is nothing left to say.
		if (result.warning) setStorageWarning(result.warning.message)
		else setOpen(false)
	}

	// Same metrics as the tags/favourite icon buttons it sits beside.
	const pill: React.CSSProperties = {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '6px',
		padding: '7px 9px',
		borderRadius: '6px',
		fontSize: '12px',
		fontFamily: 'inherit',
		lineHeight: 1,
		cursor: locked ? 'not-allowed' : 'pointer',
		border: `1px solid ${enabled ? theme.text : theme.border}`,
		backgroundColor: enabled ? `${theme.text}12` : theme.backgroundSecondary,
		color: enabled ? theme.text : theme.secondaryText,
		opacity: locked ? 0.5 : 1,
		transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease',
	}

	const row = (label: string, value: string): React.ReactElement => (
		<div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', color: theme.secondaryText }}>
			<span>{label}</span>
			<span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
		</div>
	)

	const warn = (children: React.ReactNode, tone: 'warn' | 'stop' = 'warn'): React.ReactElement => (
		<li style={{ display: 'flex', gap: '7px', color: tone === 'stop' ? '#d97706' : theme.secondaryText, lineHeight: 1.45 }}>
			<span style={{ display: 'flex', flexShrink: 0, marginTop: '1px', color: tone === 'stop' ? '#d97706' : theme.secondaryText }}>
				<AlertIcon size={12} />
			</span>
			<span>{children}</span>
		</li>
	)

	return (
		<div ref={wrapRef} style={{ position: 'relative' }}>
			<button
				type="button"
				disabled={locked}
				aria-expanded={open}
				onClick={() => !locked && setOpen((v) => !v)}
				title={enabled ? 'Local mode is on — meetings stay in this browser' : 'Local mode is off — meetings are stored on the server'}
				style={pill}
				onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.background)}
				onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = enabled ? `${theme.text}12` : theme.backgroundSecondary)}>
				{enabled ? <LockIcon size={13} /> : <UnlockIcon size={13} />}
				{enabled ? 'Local' : 'Cloud'}
				{enabled && (noWebgpu || mobile) && <AlertIcon size={12} />}
			</button>

			{open && (
				<div
					role="dialog"
					aria-label="Local mode"
					onClick={(e) => e.stopPropagation()}
					style={{
						// Matches the tags dropdown so the menus read as a family.
						position: 'absolute',
						top: '100%',
						right: 0,
						marginTop: '4px',
						zIndex: 1000,
						width: 'min(330px, calc(100vw - 32px))',
						padding: '12px',
						borderRadius: '8px',
						border: `1px solid ${theme.border}`,
						backgroundColor: theme.background,
						boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
						fontSize: '13px',
						color: theme.text,
						textAlign: 'left',
					}}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
						<LockIcon size={13} />
						<strong style={{ fontSize: '13px' }}>Local mode</strong>
						<span
							style={{
								fontSize: '10px',
								letterSpacing: '0.08em',
								color: theme.secondaryText,
								border: `1px solid ${theme.border}`,
								borderRadius: 4,
								padding: '1px 5px',
							}}>
							EXPERIMENTAL
						</span>
					</div>

					<p style={{ margin: '0 0 10px', lineHeight: 1.5, color: theme.secondaryText }}>
						Everything happens in this browser. Your audio, your transcript and your summary are never sent to our server or to any AI
						provider.
					</p>

					{!enabled && (
						<div
							style={{
								padding: '9px 11px',
								borderRadius: '6px',
								backgroundColor: theme.backgroundSecondary,
								marginBottom: '10px',
								display: 'flex',
								flexDirection: 'column',
								gap: '3px',
							}}>
							<div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: '3px' }}>
								<span>What you'll download once</span>
								<span style={{ fontVariantNumeric: 'tabular-nums' }}>{speechBytes ? `~${formatBytes(totalBytes)}` : '…'}</span>
							</div>
							{row('Speech recognition', speechBytes ? formatBytes(speechBytes) : '…')}
							{row('Speaker labelling', `~${formatBytes(DIARIZATION_BYTES)}`)}
							{row('Summary model', formatBytes(summaryBytes))}
							<div style={{ color: theme.secondaryText, marginTop: '4px' }}>Kept in this browser's cache. Nothing to download next time.</div>
						</div>
					)}

					{mobile && (
						<p style={{ margin: '0 0 10px', lineHeight: 1.5, color: '#d97706' }}>
							<strong>This will almost certainly not work on this phone.</strong> Local mode needs several GB of storage, ~2 GB of free
							memory and WebGPU. On iPhone and iPad the tab will most likely run out of memory and crash. Use a desktop, or leave this
							off.
						</p>
					)}

					<ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
						{noWebgpu && warn(<>No WebGPU in this browser, so the summary model cannot run at all. Use Chrome, Edge, or Safari 26+.</>, 'stop')}
						{warn(<>If something goes wrong mid-way, we'll ask whether to finish the job in the cloud. Nothing is ever sent without asking.</>)}
						{warn(<>Meetings live only in this browser. Clearing site data deletes them, and they will not appear on your other devices.</>)}
						{warn(<>Summaries are written by a 4B model, not Claude — shorter, flatter, and weaker outside English.</>)}
						{warn(
							<>
								Speech recognition covers {SUPPORTED_COUNT} European languages. {NOTABLE_MISSING.join(', ')} and others won't
								transcribe at all here.{' '}
								<button
									type="button"
									onClick={() => setShowLanguages((v) => !v)}
									style={{
										border: 'none',
										background: 'none',
										padding: 0,
										color: theme.text,
										cursor: 'pointer',
										font: 'inherit',
										textDecoration: 'underline',
									}}>
									{showLanguages ? 'Hide list' : 'Full list →'}
								</button>
								{showLanguages && (
									<span style={{ display: 'block', marginTop: '5px', color: theme.secondaryText }}>{PARAKEET_LANGUAGES.join(' · ')}</span>
								)}
							</>,
							'stop',
						)}
					</ul>

					{storageWarning && (
						<p
							style={{
								margin: '0 0 10px',
								padding: '9px 11px',
								borderRadius: '6px',
								lineHeight: 1.5,
								color: '#b45309',
								backgroundColor: '#f59e0b1f',
								border: '1px solid #f59e0b55',
								display: 'flex',
								gap: '7px',
							}}>
							<span style={{ display: 'flex', flexShrink: 0, marginTop: '1px' }}>
								<AlertIcon size={12} />
							</span>
							<span>
								<strong>Local mode is on.</strong> {storageWarning}
							</span>
						</p>
					)}

					<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
						<button
							type="button"
							onClick={() => setOpen(false)}
							style={{
								padding: '7px 11px',
								borderRadius: '6px',
								border: `1px solid ${theme.border}`,
								backgroundColor: theme.backgroundSecondary,
								color: theme.text,
								font: 'inherit',
								fontSize: '12px',
								cursor: 'pointer',
							}}>
							Cancel
						</button>
						{enabled ? (
							<button
								type="button"
								onClick={() => {
									disable()
									setOpen(false)
								}}
								style={{
									padding: '7px 11px',
									borderRadius: '6px',
									fontSize: '12px',
									border: `1px solid ${theme.border}`,
									backgroundColor: theme.backgroundSecondary,
									color: theme.text,
									font: 'inherit',
									cursor: 'pointer',
								}}>
								Turn off
							</button>
						) : (
							<button
								type="button"
								disabled={busy}
								onClick={handleEnable}
								style={{
									padding: '7px 11px',
									borderRadius: '6px',
									fontSize: '12px',
									border: '1px solid transparent',
									backgroundColor: theme.button.primary,
									color: theme.button.primaryText,
									font: 'inherit',
									cursor: busy ? 'wait' : 'pointer',
									opacity: busy ? 0.7 : 1,
								}}>
								{busy ? 'Checking…' : mobile ? 'Turn on anyway' : 'Turn on'}
							</button>
						)}
					</div>

					{enabled && (
						<p style={{ margin: '10px 0 0', color: theme.secondaryText, lineHeight: 1.45 }}>
							Turning this off only changes where <em>new</em> meetings go. Meetings already stored in this browser stay here.
						</p>
					)}
				</div>
			)}
		</div>
	)
}

export default LocalModeToggle
