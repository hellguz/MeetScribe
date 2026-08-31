/**
 * Meeting timestamps, parsed and displayed correctly for whoever is looking.
 *
 * The backend stores UTC. Older responses (and anything already cached in
 * localStorage) serialise it without a timezone designator, e.g.
 * "2026-08-31T11:36:50.399044" — and JavaScript reads a bare date-time as
 * LOCAL time, so it lands hours off. Everything here goes through
 * `parseServerDate`, which pins such strings to UTC before doing anything else.
 *
 * Times are then rendered in the *viewer's* timezone: the same meeting opened
 * in Berlin and in New York should each read correctly for the person reading
 * it, rather than in whatever zone the recorder happened to be in.
 */

/** True when the string already states a zone (Z, +02:00, -0500…). */
const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i

export function parseServerDate(value?: string | null): Date | null {
	if (!value) return null
	const normalised = HAS_TIMEZONE.test(value.trim()) ? value.trim() : `${value.trim()}Z`
	const date = new Date(normalised)
	return Number.isNaN(date.getTime()) ? null : date
}

/** Milliseconds since epoch, for sorting. 0 when unparseable. */
export function serverDateMs(value?: string | null): number {
	return parseServerDate(value)?.getTime() ?? 0
}

/**
 * "31 August 2026 at 13:36 CEST" in the viewer's own timezone.
 * The zone name is included so the time is never ambiguous.
 */
export function formatMeetingDateTime(value?: string | null): string | null {
	const date = parseServerDate(value)
	if (!date) return null
	try {
		return new Intl.DateTimeFormat(undefined, {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZoneName: 'short',
		}).format(date)
	} catch {
		return date.toLocaleString()
	}
}

/** Compact date for lists, in the viewer's timezone. */
export function formatMeetingDateShort(value?: string | null): string {
	const date = parseServerDate(value)
	if (!date) return ''
	try {
		return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
	} catch {
		return date.toLocaleDateString()
	}
}

/**
 * "31 Aug 2026, 21:44" — date and time for the history list, in the viewer's
 * timezone. No zone name here: the list would get noisy, and the summary page
 * spells it out in full when it matters.
 */
export function formatMeetingDateTimeShort(value?: string | null): string {
	const date = parseServerDate(value)
	if (!date) return ''
	try {
		return new Intl.DateTimeFormat(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		}).format(date)
	} catch {
		return date.toLocaleString()
	}
}
