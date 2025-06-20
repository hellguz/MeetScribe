import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import ThemeToggle from '../components/ThemeToggle';
import { useTheme } from '../contexts/ThemeContext';
import { lightTheme, darkTheme, AppTheme } from '../styles/theme';
import FeedbackComponent from '../components/FeedbackComponent';
import SummaryLengthSelector from '../components/SummaryLengthSelector';
import LanguageSelector from '../components/LanguageSelector';
import { useMeetingSummary } from '../hooks/useMeetingSummary';
import { useSummaryLanguage, SummaryLanguageState } from '../contexts/SummaryLanguageContext';

export default function Summary() {
    const { mid } = useParams<{ mid: string }>();
    const navigate = useNavigate();
    const { theme } = useTheme();
    const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;
    const { languageState, setLanguageState } = useSummaryLanguage();

    const {
        summary, transcript, isLoading, isProcessing, error, meetingTitle,
        currentMeetingLength, submittedFeedback, isRegenerating,
        handleFeedbackToggle, handleSuggestionSubmit, handleRegenerate, handleTitleUpdate,
        loadedFromCache
    } = useMeetingSummary({ mid, languageState, setLanguageState });

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editedTitle, setEditedTitle] = useState('');
    const [isTranscriptVisible, setIsTranscriptVisible] = useState(false);

    const handleTitleUpdateConfirm = useCallback(async () => {
        if (editedTitle.trim() && editedTitle.trim() !== meetingTitle) {
            await handleTitleUpdate(editedTitle.trim());
        }
        setIsEditingTitle(false);
    }, [editedTitle, meetingTitle, handleTitleUpdate]);

    const renderTitle = () => {
        if (isEditingTitle) {
            return (
                <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onBlur={handleTitleUpdateConfirm}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleTitleUpdateConfirm();
                        if (e.key === 'Escape') setIsEditingTitle(false);
                    }}
                    style={{ fontSize: '1.3em', fontWeight: 'bold', width: '100%', padding: '8px', border: `1px solid ${currentThemeColors.input.border}`, borderRadius: '6px', backgroundColor: currentThemeColors.input.background, color: currentThemeColors.input.text }}
                    autoFocus
                />
            );
        }
        return (
            <h1 onClick={() => { setEditedTitle(meetingTitle || ''); setIsEditingTitle(true); }} style={{ cursor: 'pointer' }}>
                {meetingTitle || (isLoading ? ' ' : `Summary for ${mid}`)}
                <span style={{ fontSize: '12px', marginLeft: '8px' }}>✏️</span>
            </h1>
        );
    };

    const onLanguageChange = (update: Partial<SummaryLanguageState>) => {
        // Create the full new state from the partial update
        const newState = { ...languageState, ...update };
        // Persist the change via the context
        setLanguageState(newState);
        // Trigger regeneration with the complete new state
        handleRegenerate(currentMeetingLength, newState);
    };

    return (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 24, color: currentThemeColors.text }}>
            <ThemeToggle />
            <button onClick={() => navigate('/record')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: currentThemeColors.secondaryText, marginBottom: '24px' }}>
                ← Back to Recordings
            </button>
            <div style={{ marginBottom: '24px' }}>{renderTitle()}</div>

            {isLoading && !loadedFromCache && <p>Loading summary...</p>}
            {error && <p style={{ color: currentThemeColors.button.danger }}>Error: {error}</p>}
            {(isProcessing || isRegenerating) && !summary && <p>⏳ Processing summary, please wait...</p>}

            {(!isLoading || loadedFromCache) && !error && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
                    <SummaryLengthSelector value={currentMeetingLength} disabled={isProcessing || isRegenerating} onSelect={(len) => handleRegenerate(len, languageState)} />
                    <LanguageSelector onSelectionChange={onLanguageChange} />
                </div>
            )}

            {summary && <ReactMarkdown children={summary} components={{ h1: ({...props}) => <h1 style={{color: currentThemeColors.text}} {...props}/>, h2: ({...props}) => <h2 style={{color: currentThemeColors.text}} {...props}/>, p: ({...props}) => <p style={{lineHeight: 1.6}} {...props}/> }} />}

            {summary && !isLoading && (
                <FeedbackComponent submittedTypes={submittedFeedback} onFeedbackToggle={handleFeedbackToggle} onSuggestionSubmit={handleSuggestionSubmit} theme={theme} />
            )}

            {transcript && (
                <div style={{ marginTop: 32 }}>
                    <h4 onClick={() => setIsTranscriptVisible(!isTranscriptVisible)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        <span style={{ display: 'inline-block', transform: isTranscriptVisible ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▶</span> 🎤 Transcript
                    </h4>
                    {isTranscriptVisible && <pre style={{ whiteSpace: 'pre-wrap', backgroundColor: currentThemeColors.backgroundSecondary, padding: 16, borderRadius: 4, border: `1px solid ${currentThemeColors.border}` }}>{transcript}</pre>}
                </div>
            )}
        </div>
    );
}