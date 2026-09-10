/**
 * The server side of the cloud-vs-local comparison: fetch the prompt Claude
 * was given, then post back what the browser produced from it.
 */
import { apiUrl } from '../../utils/api'

export interface SummaryPrompt {
	prompt: string
	target_language: string
	summary_length: string
	prompt_chars: number
}

/** Measurements that make a run comparable, all taken in the browser. */
export interface LocalSummaryRun {
	id: number
	meeting_id: string
	created_at: string
	model: string
	dtype: string
	device: string
	thinking: boolean
	summary_length: string
	target_language: string | null
	markdown: string
	prompt_chars: number | null
	prompt_tokens: number | null
	output_tokens: number | null
	download_bytes: number | null
	download_ms: number | null
	cached: boolean
	load_ms: number | null
	prefill_ms: number | null
	decode_ms: number | null
	total_ms: number | null
	truncated: boolean
	device_info: string | null
	user_agent: string | null
	verdict: string | null
	verdict_note: string | null
}

export type NewLocalSummaryRun = Omit<LocalSummaryRun, 'id' | 'meeting_id' | 'created_at' | 'device_info' | 'user_agent' | 'verdict' | 'verdict_note'> & {
	device_info: Record<string, unknown> | null
}

const json = async (res: Response) => {
	if (!res.ok) {
		const detail = await res
			.json()
			.then((d) => d.detail)
			.catch(() => null)
		throw new Error(detail || `HTTP ${res.status}`)
	}
	return res.json()
}

/**
 * `summaryLength` overrides the meeting's stored mode, so one transcript can
 * be tried as a briefing and as a narrative without regenerating the cloud
 * summary in between.
 */
export async function fetchSummaryPrompt(meetingId: string, summaryLength?: string): Promise<SummaryPrompt> {
	const qs = summaryLength ? `?summary_length=${encodeURIComponent(summaryLength)}` : ''
	return json(await fetch(apiUrl(`/api/meetings/${meetingId}/summary-prompt${qs}`)))
}

export async function fetchLocalSummaries(meetingId: string): Promise<LocalSummaryRun[]> {
	return json(await fetch(apiUrl(`/api/meetings/${meetingId}/local-summaries`)))
}

export async function saveLocalSummary(meetingId: string, run: NewLocalSummaryRun): Promise<LocalSummaryRun> {
	return json(
		await fetch(apiUrl(`/api/meetings/${meetingId}/local-summaries`), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(run),
		}),
	)
}

export async function saveVerdict(meetingId: string, runId: number, verdict: string | null, note: string | null): Promise<LocalSummaryRun> {
	return json(
		await fetch(apiUrl(`/api/meetings/${meetingId}/local-summaries/${runId}`), {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ verdict, verdict_note: note }),
		}),
	)
}
