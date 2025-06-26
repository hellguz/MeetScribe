import { useState, useEffect, useCallback } from 'react';
import { getCached, saveCached } from '../utils/summaryCache';
import { getHistory, saveMeeting } from '../utils/history';
import { SummaryLength } from '../contexts/SummaryLengthContext';
import { SummaryLanguageState } from '../contexts/SummaryLanguageContext';

interface UseMeetingSummaryProps {
    mid: string | undefined;
    languageState: SummaryLanguageState;
    setLanguageState: (update: Partial<SummaryLanguageState>) => void;
}

export const useMeetingSummary = ({ mid, languageState, setLanguageState }: UseMeetingSummaryProps) => {
    const [summary, setSummary] = useState<string | null>(null);
    const [transcript, setTranscript] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [meetingTitle, setMeetingTitle] = useState<string | null>(null);
    const [meetingStartedAt, setMeetingStartedAt] = useState<string>('');
    const [meetingTimezone, setMeetingTimezone] = useState<string | null>(null);
    const [context, setContext] = useState<string | null>(null);
    const [loadedFromCache, setLoadedFromCache] = useState(false);
    const [currentMeetingLength, setCurrentMeetingLength] = useState<SummaryLength>('auto');
    const [submittedFeedback, setSubmittedFeedback] = useState<string[]>([]);
    const [isRegenerating, setIsRegenerating] = useState(false);

    const fetchMeetingData = useCallback(async (isInitialFetch: boolean = false) => {
        if (!mid) return;

        if (isInitialFetch) {
            if (!loadedFromCache) setIsLoading(true);
            setError(null);
        }

        try {
            const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}`);
            
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Failed to fetch meeting data' }));
                throw new Error(errorData.detail || `HTTP error! status: ${res.status}`);
            }

            const data = await res.json();

            // --- Sync language state with the meeting's settings ---
            if (data.summary_language_mode) {
                setLanguageState({
                    mode: data.summary_language_mode,
                    // Use the meeting's custom language, but fall back to user's last known one if null
                    lastCustomLanguage: data.summary_custom_language || languageState.lastCustomLanguage,
                });
            }

            setContext(data.context || '');
            const trn = data.transcript_text || null;
            setTranscript(trn);
            setSubmittedFeedback(data.feedback || []);
            setMeetingTimezone(data.timezone || null);

            const lengthValue = data.summary_length || 'auto';
            if (['auto', 'quar_page', 'half_page', 'one_page', 'two_pages'].includes(lengthValue)) {
                setCurrentMeetingLength(lengthValue as SummaryLength);
            }

            if (data.title && data.title !== meetingTitle) {
                setMeetingTitle(data.title);
            }
            if (!meetingTitle) {
                setMeetingTitle(data.title || `Meeting ${mid}`);
            }
            if (!meetingStartedAt) {
                setMeetingStartedAt(data.started_at || new Date().toISOString());
            }

            if (data.done && data.summary_markdown) {
                setSummary(data.summary_markdown);
                setIsProcessing(false);
                setIsLoading(false);
                saveCached({ id: data.id, title: data.title, summary: data.summary_markdown, transcript: trn, updatedAt: new Date().toISOString() });
                const historyList = getHistory();
                const existingMeta = historyList.find((m) => m.id === data.id);
                saveMeeting({ id: data.id, title: data.title, started_at: existingMeta?.started_at || data.started_at, status: 'complete' });
            } else {
                setIsProcessing(true);
                setIsLoading(false);
            }
        } catch (err) {
            if (!loadedFromCache) {
                setError(err instanceof Error ? err.message : 'An unknown error occurred.');
            }
            setIsLoading(false);
            setIsProcessing(false);
        }
    }, [mid, loadedFromCache, meetingTitle, meetingStartedAt, languageState.lastCustomLanguage, setLanguageState]);

    const handleFeedbackToggle = async (type: string, isSelected: boolean) => {
        if (!mid) return;
        setSubmittedFeedback(prev => isSelected ? [...prev, type] : prev.filter(t => t !== type));
        try {
            await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/feedback`, {
                method: isSelected ? 'POST' : 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meeting_id: mid, feedback_type: type }),
            });
        } catch (error) {
            console.error('Failed to update feedback:', error);
            fetchMeetingData(false); // Re-fetch to revert
        }
    };

    const handleSuggestionSubmit = async (suggestionText: string) => {
        if (!mid || !suggestionText) return;
        try {
            await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meeting_id: mid, feedback_type: 'feature_suggestion', suggestion_text: suggestionText }),
            });
        } catch (error) {
            console.error('Failed to submit suggestion:', error);
            alert("Sorry, we couldn't submit your suggestion right now.");
        }
    };

    const handleRegenerate = useCallback(async (
        settings: {
            newLength?: SummaryLength;
            newLanguageState?: SummaryLanguageState;
            newContext?: string | null;
        }
    ) => {
        if (!mid) return;

        // Optimistically update UI state
        if(settings.newLength) setCurrentMeetingLength(settings.newLength);
        if(settings.newContext !== undefined) setContext(settings.newContext);

        setIsRegenerating(true);
        setError(null);
        try {
            const payload = {
                summary_length: settings.newLength ?? currentMeetingLength,
                summary_language_mode: settings.newLanguageState?.mode ?? languageState.mode,
                summary_custom_language: settings.newLanguageState?.lastCustomLanguage ?? languageState.lastCustomLanguage,
                context: settings.newContext ?? context,
            };
            const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}/regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error('Failed to start summary regeneration.');
            setSummary(null);
            setIsProcessing(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsRegenerating(false);
        }
    }, [mid, context, currentMeetingLength, languageState]);

    const handleTitleUpdate = useCallback(async (newTitle: string) => {
        if (!mid || !newTitle || newTitle === meetingTitle) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}/title`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle }),
            });
            if (!res.ok) throw new Error('Failed to update title');
            const updatedMeeting = await res.json();
            setMeetingTitle(updatedMeeting.title);
            saveMeeting({ id: mid, title: updatedMeeting.title, started_at: meetingStartedAt, status: 'complete' });
            if (summary) {
                saveCached({ id: mid, title: updatedMeeting.title, summary, transcript, updatedAt: new Date().toISOString() });
            }
        } catch (err) {
            console.error(err);
            alert('Failed to update title');
        }
    }, [mid, meetingTitle, meetingStartedAt, summary, transcript]);

    useEffect(() => {
        if (mid) {
            const cachedData = getCached(mid);
            if (cachedData) {
                setSummary(cachedData.summary);
                setTranscript(cachedData.transcript || null);
                setMeetingTitle(cachedData.title);
                setLoadedFromCache(true);
                setIsLoading(false);
            }
            fetchMeetingData(true);
        }
    }, [mid]);

    useEffect(() => {
        if (!isProcessing) return;
        const pollInterval = setInterval(() => fetchMeetingData(false), 5000);
        return () => clearInterval(pollInterval);
    }, [isProcessing, fetchMeetingData]);

    return {
        summary,
        transcript,
        isLoading,
        isProcessing,
        error,
        meetingTitle,
        meetingStartedAt,
        meetingTimezone,
        context,
        currentMeetingLength,
        submittedFeedback,
        isRegenerating,
        handleFeedbackToggle,
        handleSuggestionSubmit,
        handleRegenerate,
        handleTitleUpdate,
        loadedFromCache,
    };
};


