/**
 * Enhanced API-related type definitions
 */

export interface ApiResponse<T = any> {
  data: T;
  message?: string;
  status: number;
}

export interface ApiError {
  detail: string;
  status: number;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface MeetingApiResponse {
  id: string;
  title: string;
  started_at: string;
  done: boolean;
  transcript_text?: string;
  summary_markdown?: string;
  summary_length: string;
  summary_language_mode: string;
  summary_custom_language?: string;
  context?: string;
  timezone?: string;
  word_count?: number;
  duration_seconds?: number;
  transcribed_chunks: number;
  feedback: string[];
}

export interface SectionCreateRequest {
  section_type: string;
  title: string;
  position: number;
}

export interface SectionUpdateRequest {
  title?: string;
  content?: string;
  position?: number;
}

export interface MeetingRegenerateRequest {
  summary_length?: string;
  summary_language_mode?: string;
  summary_custom_language?: string;
  context?: string;
}

export interface TranslationRequest {
  target_language: string;
  language_mode: string;
}