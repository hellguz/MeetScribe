export type AudioSource = 'mic' | 'system' | 'file';

export interface StatSet {
    total_summaries: number;
    total_words: number;
    total_duration_seconds: number;
}

export interface InterestingFacts {
    avg_summary_words: number;
    busiest_hour: string;
    most_active_day: string;
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
    interesting_facts: InterestingFacts;
}

export interface MeetingSection {
    id: number;
    meeting_id: string;
    section_type: string;
    title: string;
    content: string | null;
    position: number;
    created_at: string;
    updated_at: string;
    is_generating: boolean;
}

export interface SectionTemplate {
    type: string;
    title: string;
    icon: string;
    description: string;
    is_ai_suggested?: boolean;
}
