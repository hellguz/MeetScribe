export type AudioSource = 'mic' | 'system' | 'file';

export interface StatSet {
    total_summaries: number;
    total_words: number;
    total_hours: number;
}

export interface Feedback {
    id: number;
    type: string;
    suggestion: string | null;
    created_at: string;
    status: string;
}

export interface MeetingWithFeedback {
    id: string;
    title: string;
    started_at: string;
    feedback: Feedback[];
}

export interface FeatureSuggestion {
    id: number;
    suggestion: string;
    submitted_at: string;
    meeting_id: string;
    meeting_title: string;
    status: string;
}
export interface DashboardStats {
    all_time: StatSet;
    today: StatSet;
    device_distribution: { [key: string]: number };
    feedback_counts: { [key: string]: number };
    feature_suggestions: FeatureSuggestion[];
    meetings_with_feedback: MeetingWithFeedback[];
}
