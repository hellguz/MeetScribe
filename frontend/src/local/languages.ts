/**
 * What on-device speech recognition can actually hear.
 *
 * Parakeet TDT 0.6B v3 is trained on 25 European languages. Whisper, which
 * the server uses, covers roughly 99. This is the one limit of Local mode that
 * is a hard failure rather than a quality drop: a Japanese meeting does not
 * come out worse on-device, it does not come out at all.
 *
 * So it is stated on the toggle, before the 4.3 GB download, rather than
 * discovered after it.
 */
export const PARAKEET_LANGUAGES = [
	'Bulgarian', 'Croatian', 'Czech', 'Danish', 'Dutch', 'English', 'Estonian',
	'Finnish', 'French', 'German', 'Greek', 'Hungarian', 'Italian', 'Latvian',
	'Lithuanian', 'Maltese', 'Polish', 'Portuguese', 'Romanian', 'Russian',
	'Slovak', 'Slovenian', 'Spanish', 'Swedish', 'Ukrainian',
] as const

/** Named in the warning because they are the most common ones missing. */
export const NOTABLE_MISSING = ['Japanese', 'Chinese', 'Arabic', 'Hindi', 'Korean']

export const SUPPORTED_COUNT = PARAKEET_LANGUAGES.length
