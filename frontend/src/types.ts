export type AudioSource = 'mic' | 'system' | 'file';

export type CopyStatus = 'idle' | 'copied' | 'copied_md';

export type FeedbackType = 
  | 'helpful' 
  | 'accurate' 
  | 'complete' 
  | 'clear' 
  | 'feature_suggestion';

export type MeetingStatus = 'pending' | 'processing' | 'complete' | 'error';

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
    // Enhanced context for more human context
    start_timestamp?: number | null;  // Seconds from meeting start
    end_timestamp?: number | null;    // Seconds from meeting start  
    speakers?: string | null;         // JSON array of speaker names when available
    extra_data?: string | null;       // JSON for additional context (tags, confidence, etc.)
}

export type SectionType = 
  | 'executive_summary'
  | 'action_items'
  | 'decisions_made'
  | 'questions_raised'
  | 'next_steps'
  | 'timeline'
  | 'participants'
  | 'technical_details'
  | 'risks_challenges'
  | 'feedback_given'
  | 'budget_resources'
  | 'alternatives_considered'
  | 'custom'
  | string; // for AI-generated types

export interface SectionTemplate {
    type: SectionType;
    title: string;
    icon: string;
    description: string;
    is_ai_suggested?: boolean;
}
