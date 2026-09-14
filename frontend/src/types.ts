export type AudioSource = 'mic' | 'system' | 'file'

export interface StatSet {
	total_summaries: number
	total_words: number
	total_duration_seconds: number
}

export interface InterestingFacts {
	avg_summary_words: number
	busiest_hour: string
}

export interface Feedback {
	id: number
	type: string
	suggestion: string | null
	created_at: string
	status: string
}

/** One meeting's feedback, with nothing that could identify the meeting. */
export interface FeedbackLogEntry {
	started_at: string
	feedback: Feedback[]
}

export interface FeatureSuggestion {
	id: number
	suggestion: string
	submitted_at: string
	status: string
}
export interface DashboardStats {
	all_time: StatSet
	today: StatSet
	device_distribution: { [key: string]: number }
	feedback_counts: { [key: string]: number }
	feature_suggestions: FeatureSuggestion[]
	feedback_log: FeedbackLogEntry[]
	interesting_facts: InterestingFacts
	length_distribution: { [key: string]: number }
	language_distribution: { [key: string]: number }
}
