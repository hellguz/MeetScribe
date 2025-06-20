import React, { useState, useMemo } from 'react';
import { NavigateFunction } from 'react-router-dom';
import { AppTheme } from '../../styles/theme';
import { MeetingWithFeedback, Feedback } from '../../types';
import { getFeedbackColors } from '../../utils/feedbackColors';

interface FeedbackTableProps {
    meetings: MeetingWithFeedback[];
    theme: AppTheme;
    navigate: NavigateFunction;
    onDeleteFeedback: (feedbackId: number) => void;
}

const FeedbackTable: React.FC<FeedbackTableProps> = ({ meetings, theme, navigate, onDeleteFeedback }) => {
    const [activeFilters, setActiveFilters] = useState<string[]>([]);
    const feedbackColors = useMemo(() => getFeedbackColors(theme), [theme]);

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

    const FeedbackPill: React.FC<{ feedback: Feedback }> = ({ feedback }) => {
        const [isHovered, setIsHovered] = useState(false);
        const type = feedback.type === 'feature_suggestion' ? '💡 Suggestion' : feedback.type;
        const label = getLabel(type);
        const colors = (feedbackColors as any)[type] || { text: theme.text, bg: theme.backgroundSecondary, border: theme.border };

        return (
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    backgroundColor: colors.bg,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    whiteSpace: 'nowrap',
                    position: 'relative',
                }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                {label}
                {isHovered && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDeleteFeedback(feedback.id);
                        }}
                        style={{
                            background: 'rgba(0,0,0,0.5)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '16px',
                            height: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            marginLeft: '6px',
                            fontSize: '10px',
                            lineHeight: '16px'
                        }}
                        title={`Delete this feedback`}
                    >
                        ✕
                    </button>
                )}
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
                                            {meeting.feedback.map((f) => <FeedbackPill key={f.id} feedback={f} />)}
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
