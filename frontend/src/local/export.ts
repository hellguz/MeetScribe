/**
 * Getting a local meeting out of the browser.
 *
 * Until meetings can be published (a later change), this is the only way a
 * local meeting reaches anyone else — which makes it a requirement of the
 * feature, not a nicety. It is also the answer to "my browser storage is the
 * only copy": a file the user controls.
 */
import type { LocalMeeting } from './store'

export function meetingToMarkdown(meeting: LocalMeeting): string {
	const when = new Date(meeting.started_at).toLocaleString()
	const parts = [`# ${meeting.title}`, '', `*${when}*`, '']
	if (meeting.duration_seconds) parts.push(`*Duration: ~${Math.round(meeting.duration_seconds / 60)} min*`, '')
	if (meeting.speaker_count) parts.push(`*Speakers: ${meeting.speaker_count}*`, '')
	parts.push('---', '')
	parts.push(meeting.summary_markdown ?? '_No summary was generated for this meeting._')
	if (meeting.transcript) parts.push('', '---', '', '## Transcript', '', meeting.transcript)
	return parts.join('\n')
}

/** Slug that survives every filesystem people actually use. */
const safeName = (title: string) =>
	title
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.slice(0, 60) || 'meeting'

export function downloadMeetingMarkdown(meeting: LocalMeeting): void {
	const blob = new Blob([meetingToMarkdown(meeting)], { type: 'text/markdown;charset=utf-8' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = `${safeName(meeting.title)}.md`
	document.body.appendChild(a)
	a.click()
	a.remove()
	// Revoking synchronously can cancel the download in Safari.
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
