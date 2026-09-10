import React from 'react'
import { AppTheme } from '../styles/theme'
import { formatBytes } from './OnDevicePanel'

/** What the browser measured for an on-device meeting (meeting.client_stats). */
export interface ClientStats {
	plan?: string | null
	backend?: 'webgpu' | 'wasm' | null
	threads?: number | null
	download?: { bytes: number; ms: number; cached: boolean } | null
	model_load_ms?: number | null
	transcription?: { chunks: number; audio_seconds: number; process_ms: number } | null
	diarization?: { audio_seconds: number; ms: number | null; speakers: number | null; model_bytes: number | null; model_load_ms: number | null } | null
	device?: { cores?: number | null; memory_gb?: number | null; mobile?: boolean | null } | null
}

const fmt = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`)

const OnDeviceStats: React.FC<{ stats: ClientStats; theme: AppTheme }> = ({ stats, theme }) => {
	const parts: string[] = []
	if (stats.backend) parts.push(stats.backend === 'webgpu' ? 'GPU fp16' : `CPU int8 · ${stats.threads ?? 1} thr`)
	if (stats.download) parts.push(stats.download.cached ? 'model cached' : `downloaded ${formatBytes(stats.download.bytes)} in ${fmt(stats.download.ms)}`)
	if (typeof stats.model_load_ms === 'number') parts.push(`loaded in ${fmt(stats.model_load_ms)}`)
	if (stats.transcription && stats.transcription.process_ms > 0) {
		const speed = stats.transcription.audio_seconds / (stats.transcription.process_ms / 1000)
		parts.push(`transcribed ${speed.toFixed(1)}× realtime`)
	}
	if (stats.diarization && typeof stats.diarization.ms === 'number') {
		const speed = stats.diarization.audio_seconds / (stats.diarization.ms / 1000)
		parts.push(`speakers in ${fmt(stats.diarization.ms)} (${speed.toFixed(1)}×)`)
	}
	if (parts.length === 0) return null
	return (
		<div style={{ fontSize: '12px', color: theme.secondaryText, marginTop: 6, lineHeight: 1.5 }} title="Measured in the browser that recorded this meeting">
			⚡ On-device · {parts.join(' · ')}
		</div>
	)
}

export default OnDeviceStats
