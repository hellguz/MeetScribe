/**
 * Building the summary prompt without a server round-trip.
 *
 * `GET /api/meetings/{mid}/summary-prompt` needs the transcript to already be
 * in the database, which for a local meeting it never is. So the templates
 * come from `GET /api/prompt-templates` — no meeting data in the request —
 * and the formatting that `tasks.build_summary_prompt` does in Python happens
 * here instead.
 *
 * This file must stay a faithful port of that function. If the two drift, two
 * meetings with identical transcripts get different summaries depending on
 * where they were stored, which is the sort of bug nobody thinks to look for.
 */
import { franc } from 'franc-min'
import { apiUrl } from '../utils/api'

const CACHE_KEY = 'meetscribe_prompt_templates'

export interface PromptTemplates {
	templates: Record<string, string>
	speaker_note: string
	language_footer: string
	context_wrapper: string
}

export type SummaryMode = 'briefing' | 'essence' | 'narrative' | 'minutes'
const MODES: SummaryMode[] = ['briefing', 'essence', 'narrative', 'minutes']

/**
 * franc returns ISO 639-3; the server's `detect_language_local` uses
 * langdetect's ISO 639-1. Both end up at an English language *name*, which is
 * what the templates interpolate, so the mapping is done on the names.
 *
 * Only languages the server also names are listed. Anything else falls back to
 * English, exactly as langdetect's `LangDetectException` path does.
 */
const LANG_NAMES: Record<string, string> = {
	arb: 'Arabic', ces: 'Czech', dan: 'Danish', deu: 'German',
	eng: 'English', spa: 'Spanish', fin: 'Finnish', fra: 'French',
	heb: 'Hebrew', hin: 'Hindi', hun: 'Hungarian', ind: 'Indonesian',
	ita: 'Italian', jpn: 'Japanese', kor: 'Korean', nld: 'Dutch',
	nob: 'Norwegian', nno: 'Norwegian', pol: 'Polish', por: 'Portuguese',
	ron: 'Romanian', rus: 'Russian', slk: 'Slovak', swe: 'Swedish',
	swh: 'Swahili', tha: 'Thai', tur: 'Turkish', vie: 'Vietnamese',
	cmn: 'Chinese (Simplified)', ukr: 'Ukrainian', ell: 'Greek',
	bul: 'Bulgarian', hrv: 'Croatian', srp: 'Serbian', slv: 'Slovenian',
	lit: 'Lithuanian', lav: 'Latvian', est: 'Estonian', cat: 'Catalan',
}

/** Mirrors `tasks.detect_language_local`, including its English default. */
export function detectLanguage(snippet: string): string {
	if (!snippet.trim()) return 'English'
	const code = franc(snippet, { minLength: 10 })
	return LANG_NAMES[code] ?? 'English'
}

/** Mirrors `tasks.looks_diarized` — the same regex, on the same text. */
export const looksDiarized = (transcript: string): boolean => /^Speaker \d+:/m.test(transcript)

/** Python's `str.format` for the handful of named fields the templates use. */
function format(template: string, values: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole))
}

let cached: PromptTemplates | null = null

export async function fetchPromptTemplates(): Promise<PromptTemplates> {
	if (cached) return cached
	try {
		const res = await fetch(apiUrl('/api/prompt-templates'))
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		const data = (await res.json()) as PromptTemplates
		if (!data?.templates?.narrative) throw new Error('malformed template response')
		cached = data
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(data))
		} catch {
			/* over quota; we simply re-fetch next time */
		}
		return data
	} catch (err) {
		try {
			const stored = localStorage.getItem(CACHE_KEY)
			if (stored) {
				cached = JSON.parse(stored) as PromptTemplates
				return cached
			}
		} catch {
			/* fall through */
		}
		throw new Error(
			`Could not load the summary templates (${err instanceof Error ? err.message : String(err)}). ` +
				'They are fetched once and then cached, so this only happens on a first run without a connection.',
		)
	}
}

export interface BuildPromptInput {
	transcript: string
	summaryLength: string
	languageMode: string | null
	customLanguage: string | null
	context: string | null
	meetingDate: string | null
	durationSeconds: number | null
}

export interface BuiltPrompt {
	prompt: string
	targetLanguage: string
	summaryLength: SummaryMode
	promptChars: number
}

/** Port of `tasks.build_summary_prompt`. Keep the two in step. */
export async function buildSummaryPrompt(input: BuildPromptInput): Promise<BuiltPrompt> {
	const t = await fetchPromptTemplates()
	const detected = detectLanguage(input.transcript.slice(0, 2000))

	let targetLanguage: string
	if (input.languageMode === 'custom' && input.customLanguage) targetLanguage = input.customLanguage
	else if (input.languageMode === 'english') targetLanguage = 'English'
	else targetLanguage = detected

	// `+=`, not `=`: assigning here would drop the speaker note whenever the
	// user had also supplied context. The server had exactly this bug once.
	let contextSection = ''
	if (looksDiarized(input.transcript)) contextSection += t.speaker_note
	if (input.context && input.context.trim()) contextSection += format(t.context_wrapper, { context: input.context })

	const mode: SummaryMode = MODES.includes(input.summaryLength as SummaryMode) ? (input.summaryLength as SummaryMode) : 'narrative'

	const date = input.meetingDate ?? new Date().toISOString().slice(0, 10)
	const duration = input.durationSeconds ? `~${Math.floor(input.durationSeconds / 60)} min` : 'unknown'

	let prompt = format(t.templates[mode], {
		target_language: targetLanguage,
		context_section: contextSection,
		full_transcript: input.transcript,
		date,
		duration,
	})
	prompt += format(t.language_footer, { target_language: targetLanguage })

	return { prompt, targetLanguage, summaryLength: mode, promptChars: prompt.length }
}

/** Mirrors `tasks.transcript_too_brief`, so the UI can refuse before loading 3 GB. */
export const transcriptTooBrief = (transcript: string): boolean => transcript.trim().split(/\s+/).filter(Boolean).length < 25
