import React, { useState, useCallback, useEffect } from 'react';
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
        context, currentMeetingLength, submittedFeedback, isRegenerating,
        handleFeedbackToggle, handleSuggestionSubmit, handleRegenerate, handleTitleUpdate,
        loadedFromCache
    } = useMeetingSummary({ mid, languageState, setLanguageState });

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editedTitle, setEditedTitle] = useState('');
    const [editedContext, setEditedContext] = useState('');
    const [isTranscriptVisible, setIsTranscriptVisible] = useState(false);

    useEffect(() => {
        if (context !== null) {
            setEditedContext(context);
        }
    }, [context]);

    const handleTitleUpdateConfirm = useCallback(async () => {
        if (editedTitle.trim() && editedTitle.trim() !== meetingTitle) {
            await handleTitleUpdate(editedTitle.trim());
        }
        setIsEditingTitle(false);
    }, [editedTitle, meetingTitle, handleTitleUpdate]);

    const handleContextUpdateConfirm = () => {
        if (editedContext !== context) {
            handleRegenerate({ newContext: editedContext });
        }
    };

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
                    style={{ fontSize: '1.5em', fontWeight: 'bold', width: '100%', padding: '8px', border: `1px solid ${currentThemeColors.input.border}`, borderRadius: '6px', backgroundColor: currentThemeColors.input.background, color: currentThemeColors.input.text }}
                    autoFocus
                />
            );
        }
        return (
            <h1 onClick={() => { setEditedTitle(meetingTitle || ''); setIsEditingTitle(true); }} style={{ cursor: 'pointer', fontSize: '1.5em', margin: 0 }}>
                {meetingTitle || (isLoading ? ' ' : `Summary for ${mid}`)}
                <span style={{ fontSize: '14px', marginLeft: '10px' }}>✏️</span>
            </h1>
        );
    };

    const onLanguageChange = (update: Partial<SummaryLanguageState>) => {
        const newState = { ...languageState, ...update };
        setLanguageState(newState);
        handleRegenerate({ newLanguageState: newState });
    };

    const contextHasChanged = editedContext !== context;
    const showControls = summary && !isProcessing;

    return (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 24, color: currentThemeColors.text }}>
            <ThemeToggle />
            <button onClick={() => navigate('/record')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: currentThemeColors.secondaryText, marginBottom: '24px' }}>
                ← Back to Recordings
            </button>

            <div style={{
                backgroundColor: currentThemeColors.background,
                padding: '24px',
                borderRadius: '12px',
                border: `1px solid ${currentThemeColors.border}`,
                marginBottom: '32px'
            }}>
                {renderTitle()}

                {showControls && (
                    <div style={{display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px'}}>
                        <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', justifyContent: 'space-between', alignItems: 'center' }}>
                            <SummaryLengthSelector value={currentMeetingLength} disabled={isRegenerating} onSelect={(len) => handleRegenerate({ newLength: len })} />
                            <LanguageSelector disabled={isRegenerating} onSelectionChange={onLanguageChange} />
                        </div>

                        <div>
                            <label htmlFor="context-editor" style={{ display: 'block', fontWeight: 500, marginBottom: '8px', fontSize: '14px' }}>
                                Context
                            </label>
                            <textarea
                                id="context-editor"
                                value={editedContext}
                                onChange={(e) => setEditedContext(e.target.value)}
                                placeholder="Add participant names, project codes, or key terms here to improve summary accuracy. Changes will trigger a regeneration."
                                disabled={isRegenerating}
                                style={{
                                    width: '100%',
                                    minHeight: '60px',
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${currentThemeColors.input.border}`,
                                    backgroundColor: currentThemeColors.input.background,
                                    color: currentThemeColors.input.text,
                                    fontFamily: 'inherit',
                                    fontSize: '14px',
                                    resize: 'vertical',
                                    boxSizing: 'border-box',
                                    opacity: isRegenerating ? 0.7 : 1,
                                }}
                            />
                            {contextHasChanged && (
                                <button
                                    onClick={handleContextUpdateConfirm}
                                    disabled={isRegenerating}
                                    style={{
                                        marginTop: '12px',
                                        padding: '8px 16px',
                                        border: 'none',
                                        borderRadius: '8px',
                                        backgroundColor: currentThemeColors.button.primary,
                                        color: currentThemeColors.button.primaryText,
                                        fontSize: '14px',
                                        fontWeight: '500',
                                        cursor: isRegenerating ? 'not-allowed' : 'pointer',
                                        opacity: isRegenerating ? 0.6 : 1,
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    Apply & Regenerate Summary
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {summary ? (
                <ReactMarkdown children={summary} components={{ h1: ({...props}) => <h1 style={{color: currentThemeColors.text}} {...props}/>, h2: ({...props}) => <h2 style={{color: currentThemeColors.text}} {...props}/>, p: ({...props}) => <p style={{lineHeight: 1.6}} {...props}/> }} />
            ) : (
                <>
                    {isLoading && !loadedFromCache && <p>Loading summary...</p>}
                    {error && <p style={{ color: currentThemeColors.button.danger }}>Error: {error}</p>}
                    {(isProcessing || isRegenerating) && <p>⏳ Processing summary, please wait...</p>}
                </>
            )}

            {summary && !isLoading && (
                <FeedbackComponent submittedTypes={submittedFeedback} onFeedbackToggle={handleFeedbackToggle} onSuggestionSubmit={handleSuggestionSubmit} theme={theme} />
            )}

            {transcript && (
                <div style={{
                    marginTop: '32px',
                    backgroundColor: currentThemeColors.background,
                    padding: '16px 24px',
                    borderRadius: '12px',
                    border: `1px solid ${currentThemeColors.border}`
                }}>
                    <h4 onClick={() => setIsTranscriptVisible(!isTranscriptVisible)} style={{ cursor: 'pointer', userSelect: 'none', margin: 0, display: 'flex', alignItems: 'center' }}>
                        <span style={{ display: 'inline-block', transform: isTranscriptVisible ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', marginRight: '8px' }}>▶</span> 🎤 Transcript
                    </h4>
                    {isTranscriptVisible && (
                        <pre style={{ 
                            marginTop: '16px', 
                            whiteSpace: 'pre-wrap', 
                            color: currentThemeColors.text, 
                            fontSize: '14px',
                            lineHeight: '1.6'
                        }}>
                            {transcript}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}