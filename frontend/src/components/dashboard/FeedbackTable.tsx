import React, { useState, useMemo } from 'react';
import { useNavigate, NavigateFunction } from 'react-router-dom';
import { AppTheme, lightTheme, darkTheme } from '../../styles/theme';
import { MeetingWithFeedback, Feedback } from '../../types';

interface FeedbackTableProps {
    meetings: MeetingWithFeedback[];
    theme: AppTheme;
    navigate: NavigateFunction;
}

const FeedbackTable: React.FC<FeedbackTableProps> = ({ meetings, theme, navigate }) => {
    const [activeFilters, setActiveFilters] = useState<string[]>([]);

    const feedbackColors = useMemo(() => {
        const light = {
            accurate: { text: '#057a55', bg: '#def7ec', border: '#a7f3d0' },
            inaccurate: { text: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
            too_short: { text: '#b45309', bg: '#fffbeb', border: '#fde68a' },
            too_detailed: { text: '#b45309', bg: '#fffbeb', border: '#fde68a' },
            well_structured: { text: '#057a55', bg: '#def7ec', border: '#a7f3d0' },
            confusing: { text: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
            missed_key_points: { text: '#b45309', bg: '#fffbeb', border: '#fde68a' },
            hallucinated: { text: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
            '💡 Suggestion': { text: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
        };
        const dark = {
            accurate: { text: '#a7f3d0', bg: '#143623', border: '#15803d' },
            inaccurate: { text: '#fecaca', bg: '#451a1a', border: '#b91c1c' },
            too_short: { text: '#fde68a', bg: '#422006', border: '#b45309' },
            too_detailed: { text: '#fde68a', bg: '#422006', border: '#b45309' },
            well_structured: { text: '#a7f3d0', bg: '#143623', border: '#15803d' },
            confusing: { text: '#fecaca', bg: '#451a1a', border: '#b91c1c' },
            missed_key_points: { text: '#fde68a', bg: '#422006', border: '#b45309' },
            hallucinated: { text: '#fecaca', bg: '#451a1a', border: '#b91c1c' },
            '💡 Suggestion': { text: '#bfdbfe', bg: '#1e3a8a', border: '#1e40af' },
        };
        return theme.text === lightTheme.text ? light : dark;
    }, [theme]);

    const allFeedbackTypes = useMemo(() => {
        const types = new Set<string>();
        meetings.forEach((m) => m.feedback.forEach((f) => f.type !== 'feature_suggestion' && types.add(f.type)));
        return Array.from(types).sort();
    }, [meetings]);

    const filteredMeetings = useMemo(() => {
        if (activeFilters.length === 0) return meetings;
        return meetings.filter((m) => m.feedback.some((f) => activeFilters.includes(f.type)));
    }, [meetings, activeFilters]);

    const toggleFilter = (type: string) => {
        setActiveFilters((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
    };

    const getLabel = (type: string) => type.replace(/_/g, ' ');

    const feedbackPill = (type: string, key: number | string) => {
        const label = getLabel(type);
        const colors = (feedbackColors as any)[type] || { text: theme.text, bg: theme.backgroundSecondary, border: theme.border };
        return (
            <span key={key} style={{ display: 'inline-block', padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 500, backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }}>
                {label}
            </span>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 500 }}>Filter by Feedback</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {allFeedbackTypes.map((type) => {
                        const isActive = activeFilters.includes(type);
                        const colors = (feedbackColors as any)[type] || { text: theme.text, bg: theme.backgroundSecondary, border: theme.border };
                        return (
                            <button key={type} onClick={() => toggleFilter(type)} style={{ padding: '6px 12px', border: `1.5px solid ${colors.border}`, borderRadius: '16px', cursor: 'pointer', backgroundColor: isActive ? colors.bg : 'transparent', color: isActive ? colors.text : theme.text, fontWeight: isActive ? 600 : 400, transition: 'all 0.2s ease' }}>
                                {getLabel(type)}
                            </button>
                        );
                    })}
                    {activeFilters.length > 0 && (
                        <button onClick={() => setActiveFilters([])} style={{ border: 'none', background: 'none', color: theme.secondaryText, cursor: 'pointer', textDecoration: 'underline' }}>
                            Clear
                        </button>
                    )}
                </div>
            </div>
            <div style={{ maxHeight: '600px', overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: theme.background, backdropFilter: 'blur(5px)' }}>
                        <tr>
                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: `1px solid ${theme.border}` }}>Meeting</th>
                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: `1px solid ${theme.border}` }}>Date</th>
                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: `1px solid ${theme.border}` }}>Feedback Received</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredMeetings.length > 0 ? (
                            filteredMeetings.map((meeting) => (
                                <tr key={meeting.id} onClick={() => navigate(`/summary/${meeting.id}`)} style={{ cursor: 'pointer', backgroundColor: theme.body, transition: 'background-color 0.2s ease' }} onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.background)} onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.body)}>
                                    <td style={{ padding: '12px', fontWeight: 500, borderBottom: `1px solid ${theme.border}` }}>{meeting.title}</td>
                                    <td style={{ padding: '12px', whiteSpace: 'nowrap', borderBottom: `1px solid ${theme.border}` }}>{new Date(meeting.started_at).toLocaleDateString()}</td>
                                    <td style={{ padding: '12px', borderBottom: `1px solid ${theme.border}` }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                            {meeting.feedback.map((f, i) => f.type === 'feature_suggestion' ? feedbackPill('💡 Suggestion', `sugg-${i}`) : feedbackPill(f.type, i))}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={3} style={{ textAlign: 'center', padding: '20px', color: theme.secondaryText }}>No meetings match the selected filters.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default FeedbackTable;

