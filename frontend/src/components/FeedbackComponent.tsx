import React, { useState, useMemo } from 'react';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';

interface FeedbackComponentProps {
    onSubmit: (feedbackType: string, suggestionText?: string) => void;
    theme: 'light' | 'dark';
    submitted: boolean;
}

type FeedbackType = 'too_short' | 'too_detailed' | 'accurate' | 'inaccurate' | 'general';

const FeedbackComponent: React.FC<FeedbackComponentProps> = ({ onSubmit, theme, submitted }) => {
    const [suggestion, setSuggestion] = useState('');
    const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;

    // --- UPDATE: Removed emojis from labels as requested ---
    const feedbackOptions = useMemo(() => [
        { type: 'accurate', label: 'On the spot', color: 'green' },
        { type: 'too_short', label: 'Too short', color: 'yellow' },
        { type: 'too_detailed', label: 'Too detailed', color: 'yellow' },
        { type: 'general', label: 'Too general', color: 'yellow' },
        { type: 'inaccurate', label: 'Inaccurate', color: 'red' },
    ], []);

    // --- UPDATE: Defined more saturated colors for borders and text ---
    const chipColors = useMemo(() => ({
        green: {
            border: theme === 'light' ? '#22c55e' : '#4ade80', // Saturated green
            hoverBg: theme === 'light' ? '#f0fdf4' : '#143623',
        },
        yellow: {
            border: theme === 'light' ? '#f59e0b' : '#fabc05', // Saturated amber/yellow
            hoverBg: theme === 'light' ? '#fffbeb' : '#422006',
        },
        red: {
            border: theme === 'light' ? '#ef4444' : '#f87171', // Saturated red
            hoverBg: theme === 'light' ? '#fef2f2' : '#450a0a',
        },
    }), [theme]);

    const handleSimpleFeedback = (type: FeedbackType) => {
        onSubmit(type);
    };

    const handleSuggestionSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (suggestion.trim()) {
            onSubmit('feature_suggestion', suggestion.trim());
            setSuggestion('');
        }
    };
    
    if (submitted) {
        return (
            <div style={{ 
                textAlign: 'center', 
                padding: '20px', 
                margin: '24px 0',
                // --- UPDATE: Main container background is transparent ---
                backgroundColor: 'transparent',
                border: `1px solid ${currentThemeColors.border}`,
                borderRadius: '8px'
            }}>
                <p style={{ margin: 0, fontWeight: 500, color: currentThemeColors.text }}>Thanks for your feedback! ✨</p>
            </div>
        )
    }

    return (
        // --- UPDATE: Main container background is transparent, outline remains ---
        <div style={{ 
            padding: '16px',
            margin: '24px 0',
            backgroundColor: 'transparent', 
            border: `1px solid ${currentThemeColors.border}`,
            borderRadius: '8px' 
        }}>
            <p style={{ margin: '0 0 12px 0', fontWeight: '500', fontSize: '15px', color: currentThemeColors.text }}>Was this summary helpful?</p>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                {feedbackOptions.map(opt => {
                    const colorSet = chipColors[opt.color];
                    return (
                        <button
                            key={opt.type}
                            onClick={() => handleSimpleFeedback(opt.type as FeedbackType)}
                            style={{
                                padding: '6px 12px',
                                // --- UPDATE: Thicker (2px), saturated border ---
                                border: `solid ${colorSet.border}`,
                                borderRadius: '16px',
                                // --- UPDATE: Button background is transparent ---
                                backgroundColor: 'transparent',
                                // --- UPDATE: Text color matches saturated border color ---
                                color: colorSet.border, 
                                fontWeight: '500',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s ease, color 0.2s ease',
                            }}
                            // On hover, we apply a subtle background and make text darker for readability
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = colorSet.hoverBg;
                                e.currentTarget.style.color = currentThemeColors.text;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = colorSet.border;
                            }}
                        >
                            {opt.label}
                        </button>
                    )
                })}
            </div>

            <form onSubmit={handleSuggestionSubmit} style={{ display: 'flex', gap: '8px' }}>
                <input
                    type="text"
                    value={suggestion}
                    onChange={(e) => setSuggestion(e.target.value)}
                    placeholder="Have a feature suggestion?"
                    style={{
                        flexGrow: 1,
                        padding: '8px 12px',
                        border: `1px solid ${currentThemeColors.input.border}`,
                        borderRadius: '8px',
                        backgroundColor: currentThemeColors.input.background,
                        color: currentThemeColors.text,
                        fontSize: '14px',
                    }}
                />
                <button
                    type="submit"
                    style={{
                        padding: '8px 16px',
                        border: 'none',
                        borderRadius: '8px',
                        backgroundColor: suggestion.trim() ? currentThemeColors.button.primary : currentThemeColors.backgroundSecondary,
                        color: suggestion.trim() ? currentThemeColors.button.primaryText : currentThemeColors.secondaryText,
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: suggestion.trim() ? 'pointer' : 'not-allowed',
                        transition: 'background-color 0.2s, color 0.2s',
                    }}
                    disabled={!suggestion.trim()}
                >
                    Send
                </button>
            </form>
        </div>
    );
};

export default FeedbackComponent;
