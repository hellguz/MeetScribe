/**
 * The IndexedDB destination for an on-device meeting.
 *
 * Mirrors `serverSink`, and the difference that matters is `requestFallback:
 * null` — a local meeting never uploaded its audio, so nothing on the server
 * can quietly take over. A failure has to reach the user as a question.
 *
 * Chunks are written as they finish rather than only at the end. It costs one
 * small write every 30 seconds and it means a tab that dies mid-meeting leaves
 * a usable transcript behind instead of nothing.
 */
import type { MeetingSink, FinalizeResult } from '../ondevice/api'
import type { TranscriptSegment } from '../ondevice/diarization/label'
import type { SummaryLength } from '../contexts/SummaryLengthContext'
import { putLocalMeeting, type LocalMeeting } from './store'
import { saveMeeting } from '../utils/history'

export interface LocalMeetingSeed {
	id: string
	title: string
	started_at: string
	context: string | null
	summary_length: SummaryLength
	summary_language_mode: string
	summary_custom_language: string | null
	timezone: string | null
}

const blank = (seed: LocalMeetingSeed): LocalMeeting => ({
	...seed,
	transcript: '',
	segments: [],
	summary_markdown: null,
	duration_seconds: null,
	word_count: null,
	speaker_count: null,
	client_stats: null,
	updated_at: new Date().toISOString(),
	unfinished: true,
})

/** Record the meeting in the history list and the store, before anything runs. */
export async function seedLocalMeeting(seed: LocalMeetingSeed): Promise<void> {
	await putLocalMeeting(blank(seed))
	saveMeeting({ id: seed.id, title: seed.title, started_at: seed.started_at, status: 'pending', storage: 'local' })
}

export function createLocalSink(seed: LocalMeetingSeed): MeetingSink {
	// Held here rather than re-read from IndexedDB each time: chunks land out
	// of order and a read-modify-write per chunk would race with itself.
	const texts = new Map<number, string>()
	const segments = new Map<number, TranscriptSegment[]>()

	const joined = () =>
		[...texts.keys()]
			.sort((a, b) => a - b)
			.map((i) => texts.get(i) ?? '')
			.filter(Boolean)
			.join(' ')
			.trim()

	return {
		async putChunk(index, text, chunkSegments) {
			texts.set(index, text)
			segments.set(index, chunkSegments)
			const transcript = joined()
			await putLocalMeeting({
				...blank(seed),
				transcript,
				word_count: transcript ? transcript.split(/\s+/).filter(Boolean).length : 0,
				unfinished: true,
			})
		},

		async finalize({ transcript, segments: absolute, speakerCount, durationSeconds, clientStats }: FinalizeResult) {
			const finalTranscript = transcript || joined()
			await putLocalMeeting({
				...blank(seed),
				transcript: finalTranscript,
				segments: absolute,
				speaker_count: speakerCount,
				duration_seconds: durationSeconds,
				word_count: finalTranscript ? finalTranscript.split(/\s+/).filter(Boolean).length : 0,
				client_stats: (clientStats ?? null) as LocalMeeting['client_stats'],
				// The transcript is done; the summary has not run yet. The
				// summary page picks it up from here and clears this.
				unfinished: true,
			})
			saveMeeting({ id: seed.id, title: seed.title, started_at: seed.started_at, status: 'complete', storage: 'local' })
		},

		// No server row to keep warm.
		heartbeat: () => {},

		// Nothing was ever uploaded; falling back requires consent first.
		requestFallback: null,
	}
}
