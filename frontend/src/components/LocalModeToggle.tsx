import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppTheme } from '../styles/theme'
import { useLocalMode } from '../local/mode'
import { NOTABLE_MISSING, PARAKEET_LANGUAGES, SUPPORTED_COUNT } from '../local/languages'
import { ESTIMATED_PLAN_BYTES, measurePlanBytes } from '../ondevice/hub'
import { clearModelCaches, measureCachedModels, type CachedModels } from '../ondevice/cache'
import { detectCapabilities, resolvePlan, type DeviceCapabilities } from '../ondevice/capabilities'
import { SUMMARY_MODELS } from '../ondevice/summary/models'
import { formatBytes } from '../utils/formatBytes'
import { LockIcon, AlertIcon, CheckIcon, LaptopIcon, CloudIcon } from './Icons'
import SegmentedToggle from './SegmentedToggle'

/**
 * Where new meetings go, in the record page's top bar.
 *
 * The switch is a segmented pair rather than one button that outlines itself
 * when local mode is on: a lone outlined button reads as a stray focus ring
 * to anyone who did not watch it change.
 *
 * Only the cloud side flips on click. Choosing "On device" opens the panel
 * first, because it commits the user to a multi-gigabyte download and that
 * must never happen from a stray click on the way to the theme toggle.
 * Choosing "Cloud" costs nothing, so it just happens.
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
	const [cached, setCached] = useState<CachedModels | null>(null)
	const [showLanguages, setShowLanguages] = useState(false)
	// Not a blocker: local mode turns on either way, and this explains what the
	// browser would not promise.
	const [storageWarning, setStorageWarning] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [clearing, setClearing] = useState(false)
	const wrapRef = useRef<HTMLDivElement>(null)

	const refreshCached = useCallback(() => {
		measureCachedModels().then(setCached)
	}, [])

	/**
	 * What this machine can do. Needed whenever local mode is on, not only
	 * while the panel is open, because the caution marker on the switch is
	 * drawn from it and a machine with no WebGPU should say so before anyone
	 * opens anything. Costs no network: it asks the browser for a GPU adapter
	 * and reads the user agent.
	 */
	useEffect(() => {
		if (!open && !enabled) return
		let live = true
		detectCapabilities().then((c) => live && setCaps(c))
		return () => {
			live = false
		}
	}, [open, enabled])

	/**
	 * How big the download is. Only while the panel is on screen, because
	 * this one *does* touch the network — a HEAD and a ranged GET per file,
	 * against whichever host is configured.
	 *
	 * It used to run alongside the capability check, which put nine requests
	 * (one of them a 404) on the record page every time it was opened, purely
	 * to have a number ready in a panel nobody had asked for. The record page
	 * now fetches nothing at all until a meeting starts, and that has to mean
	 * nothing.
	 */
	useEffect(() => {
		if (!open || !caps) return
		let live = true
		// Ask the host rather than hardcoding: a self-hosted model base can
		// serve files nothing like the upstream sizes.
		measurePlanBytes(resolvePlan('auto', caps)).then((b) => live && b !== null && setSpeechBytes(b))
		return () => {
			live = false
		}
	}, [open, caps])

	// Only while the panel is on screen: it is a disk read per cached file.
	useEffect(() => {
		if (open) refreshCached()
	}, [open, refreshCached])

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
	// A measured figure when the host will give one, the upstream size when it
	// will not. Never nothing: "how much will this cost me" is the whole
	// question, and an ellipsis in its place reads as a broken panel.
	const measuredSpeech = speechBytes ?? (caps ? ESTIMATED_PLAN_BYTES[resolvePlan('auto', caps)] : null)
	const speechExact = speechBytes !== null
	const totalBytes = (measuredSpeech ?? 0) + DIARIZATION_BYTES + summaryBytes
	const onDisk = cached?.total ?? 0
	const remaining = Math.max(0, totalBytes - onDisk)
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

	const handleClear = async () => {
		setClearing(true)
		await clearModelCaches()
		refreshCached()
		setClearing(false)
	}

	/** The app's inline text button, as used by "Full list →". */
	const linkButton = (label: string, onClick: () => void, waiting = false): React.ReactElement => (
		<button
			type="button"
			disabled={waiting}
			onClick={onClick}
			style={{
				border: 'none',
				background: 'none',
				padding: 0,
				color: theme.text,
				cursor: waiting ? 'wait' : 'pointer',
				font: 'inherit',
				textDecoration: 'underline',
			}}>
			{label}
		</button>
	)

	/**
	 * One model, its size, and how much of it is already here.
	 *
	 * Two columns, because three would need a table and this is a footnote:
	 * the size and its state share the right-hand cell, and a tick is the
	 * whole message once the file is complete.
	 */
	const modelRow = (label: string, total: number | null, stored: number | null, approx = false): React.ReactElement => {
		// Never exactly equal: a re-quantized mirror is a few bytes off the
		// figure we quote, and the summary bucket holds a tokenizer too.
		const complete = total !== null && stored !== null && stored >= total * 0.97
		const partial = !complete && stored !== null && stored > 1_000_000
		return (
			<div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', color: theme.secondaryText }}>
				<span>{label}</span>
				<span style={{ fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
					{total === null ? '…' : `${approx ? '~' : ''}${formatBytes(total)}`}
					{complete ? (
						<span title="Already on this disk" style={{ display: 'flex', color: theme.text }}>
							<CheckIcon size={12} />
						</span>
					) : partial ? (
						<span style={{ color: theme.text }}>· {formatBytes(stored as number)} here</span>
					) : null}
				</span>
			</div>
		)
	}

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
			<SegmentedToggle
				theme={theme}
				ariaLabel="Where new meetings go"
				value={enabled ? 'local' : 'cloud'}
				disabled={locked}
				options={[
					{
						value: 'local',
						label: 'On device',
						icon: LaptopIcon,
						warning: noWebgpu || mobile,
						title: enabled ? 'New meetings stay in this browser — open for details' : 'Keep new meetings in this browser',
					},
					{
						value: 'cloud',
						label: 'Cloud',
						icon: CloudIcon,
						title: enabled ? 'Send new meetings to the server again' : 'New meetings are stored on the server',
					},
				]}
				onSelect={(side) => {
					if (locked) return
					// Turning off is free and instant. Everything else opens the
					// panel, which is where the download and its caveats live.
					if (side === 'cloud' && enabled) disable()
					else setOpen((v) => !v)
				}}
			/>

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

					{/* The models, and how much of them is already here. Shown
					    whether local mode is on or off: beforehand it is the
					    price, afterwards it is the only place that says what is
					    on the disk and offers to give the space back. */}
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
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontWeight: 600, marginBottom: '3px' }}>
							<span>{remaining > 5_000_000 ? "What you'll download" : 'Models'}</span>
							<span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
								{remaining > 5_000_000 ? `~${formatBytes(remaining)} left` : 'all here'}
							</span>
						</div>
						{modelRow('Speech recognition', measuredSpeech, cached?.speech ?? null, !speechExact)}
						{modelRow('Summary model', summaryBytes, cached?.summary ?? null)}
						{modelRow('Speaker labelling', DIARIZATION_BYTES, null, true)}
						<div style={{ color: theme.secondaryText, marginTop: '4px' }}>
							Kept in this browser's cache.{' '}
							{onDisk > 5_000_000
								? linkButton(clearing ? 'Removing…' : `Remove ${formatBytes(onDisk)}`, handleClear, clearing)
								: 'Nothing to download next time.'}
						</div>
					</div>

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
						{warn(<>Summaries and meeting titles are written by a 4B model, not Claude — shorter, flatter, and weaker outside English.</>)}
						{warn(
							<>
								Speech recognition covers {SUPPORTED_COUNT} European languages. {NOTABLE_MISSING.join(', ')} and others won't
								transcribe at all here. {linkButton(showLanguages ? 'Hide list' : 'Full list →', () => setShowLanguages((v) => !v))}
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
