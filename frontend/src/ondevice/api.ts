/** Backend calls specific to on-device meetings. */
import { apiUrl } from '../utils/api'
import type { TranscriptSegment } from './diarization/label'

export interface ModelManifest {
	segmentation: { url: string; name: string; bytes: number }
	embedding: { url: string; name: string; bytes: number }
	config: {
		window_shift_ratio: number
		cluster_threshold: number
		min_speaker_share: number
		min_duration_on: number
		min_duration_off: number
	}
}

export async function fetchModelManifest(): Promise<ModelManifest> {
	const res = await fetch(apiUrl('/api/models'))
	if (!res.ok) {
		const detail = await res.json().catch(() => ({}))
		throw new Error(detail.detail || `Could not fetch model list (HTTP ${res.status})`)
	}
	const manifest = (await res.json()) as ModelManifest
	// The worker fetches these itself, so they must be absolute for a
	// cross-origin API base.
	manifest.segmentation.url = apiUrl(manifest.segmentation.url)
	manifest.embedding.url = apiUrl(manifest.embedding.url)
	return manifest
}

export async function putChunkTranscript(meetingId: string, index: number, text: string, segments: TranscriptSegment[], audioSeconds: number): Promise<void> {
	const res = await fetch(apiUrl(`/api/meetings/${meetingId}/chunks/${index}/transcript`), {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, segments, audio_seconds: audioSeconds }),
	})
	if (!res.ok) throw new Error(`Chunk ${index}: HTTP ${res.status}`)
}

export async function finalizeMeeting(meetingId: string, body: { transcript: string; speaker_count: number | null; duration_seconds: number; client_stats: unknown }): Promise<void> {
	const res = await fetch(apiUrl(`/api/meetings/${meetingId}/finalize`), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	if (!res.ok) throw new Error(`Finalize: HTTP ${res.status}`)
}

export async function requestServerFallback(meetingId: string): Promise<void> {
	await fetch(apiUrl(`/api/meetings/${meetingId}/client-fallback`), { method: 'POST' })
}
