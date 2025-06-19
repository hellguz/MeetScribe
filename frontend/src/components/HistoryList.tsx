import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MeetingMeta } from '../utils/history';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';
import { useTheme } from '../contexts/ThemeContext';

interface HistoryListProps {
    history: MeetingMeta[];
    onTitleUpdate: (id: string, newTitle: string) => Promise<void>;
}

const HistoryList: React.FC<HistoryListProps> = ({ history, onTitleUpdate }) => {
    const navigate = useNavigate();
    const { theme } = useTheme();
    const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;

    const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState<string>('');
    const [hoveredMeetingId, setHoveredMeetingId] = useState<string | null>(null);

    const handleTitleChangeConfirm = async () => {
        if (!editingMeetingId || !editingTitle.trim()) {
            setEditingMeetingId(null);
            setEditingTitle('');
            return;
        }
        await onTitleUpdate(editingMeetingId, editingTitle.trim());
        setEditingMeetingId(null);
        setEditingTitle('');
    };

    if (history.length === 0) {
        return null;
    }

    return (
        <div style={{ marginTop: '40px', marginBottom: '40px' }}>
            <h2 style={{ margin: '24px 0 12px 0', fontSize: 16, textAlign: 'center', color: currentThemeColors.text }}>Previous Meetings</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, border: `1px solid ${currentThemeColors.border}`, borderRadius: '8px' }}>
                {history.map((m, index) => (
                    <li
                        key={m.id}
                        style={{
                            padding: '12px 16px',
                            borderBottom: index === history.length - 1 ? 'none' : `1px solid ${currentThemeColors.border}`,
                            backgroundColor: index % 2 === 0 ? currentThemeColors.listItem.background : currentThemeColors.body,
                            color: currentThemeColors.text,
                        }}
                        onClick={(e) => {
                            if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'SPAN' || (e.target as HTMLElement).tagName === 'DIV') {
                                navigate(`/summary/${m.id}`);
                            }
                        }}
                        onMouseEnter={() => setHoveredMeetingId(m.id)}
                        onMouseLeave={() => setHoveredMeetingId(null)}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            {editingMeetingId === m.id ? (
                                <input
                                    type="text"
                                    value={editingTitle}
                                    onChange={(e) => setEditingTitle(e.target.value)}
                                    onBlur={handleTitleChangeConfirm}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleTitleChangeConfirm();
                                        else if (e.key === 'Escape') setEditingMeetingId(null);
                                        e.stopPropagation();
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        flexGrow: 1,
                                        padding: '4px 8px',
                                        fontSize: '1em',
                                        marginRight: '10px',
                                        border: `1px solid ${currentThemeColors.input.border}`,
                                        borderRadius: '4px',
                                        backgroundColor: currentThemeColors.input.background,
                                        color: currentThemeColors.input.text,
                                    }}
                                    autoFocus
                                />
                            ) : (
                                <>
                                    <span
                                        style={{ fontWeight: 500, flexGrow: 1, cursor: 'pointer', fontSize: '0.9em' }}
                                        onClick={() => navigate(`/summary/${m.id}`)}
                                    >
                                        {m.title}
                                    </span>
                                    <span
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingMeetingId(m.id);
                                            setEditingTitle(m.title);
                                        }}
                                        style={{
                                            fontSize: '15px',
                                            cursor: 'pointer',
                                            marginRight: '10px',
                                            visibility: hoveredMeetingId === m.id ? 'visible' : 'hidden',
                                        }}
                                        title="Edit title"
                                    >
                                        ✏️
                                    </span>
                                </>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', marginLeft: '10px' }}>
                                {m.status === 'pending' && (
                                    <span style={{
                                        marginRight: 8,
                                        color: theme === 'light' ? '#b45309' : '#fde047',
                                        backgroundColor: theme === 'light' ? '#fef3c7' : '#422006',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: 12,
                                        fontWeight: '500',
                                    }}>
                                        Pending
                                    </span>
                                )}
                                {m.status === 'complete' && (
                                    <span style={{
                                        marginRight: 8,
                                        color: theme === 'light' ? '#057a55' : '#34d399',
                                        backgroundColor: theme === 'light' ? '#def7ec' : '#047481',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: 12,
                                        fontWeight: '500',
                                    }}>
                                        Complete
                                    </span>
                                )}
                                <span
                                    style={{ fontStyle: 'italic', color: currentThemeColors.secondaryText, fontSize: 14, cursor: 'pointer' }}
                                    onClick={() => navigate(`/summary/${m.id}`)}
                                >
                                    {new Date(m.started_at).toLocaleDateString()}
                                </span>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default HistoryList;