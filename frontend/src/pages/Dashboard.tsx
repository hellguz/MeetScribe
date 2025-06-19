import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../contexts/ThemeContext';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';
import { DashboardStats, FeatureSuggestion } from '../types';
import StatCard from '../components/dashboard/StatCard';
import BarChart from '../components/dashboard/BarChart';
import PieChart from '../components/dashboard/PieChart';
import FeedbackTable from '../components/dashboard/FeedbackTable';

export default function Dashboard() {
    const navigate = useNavigate();
    const themeContext = useContext(ThemeContext);
    if (!themeContext) throw new Error('ThemeContext not found');
    const { theme } = themeContext;
    const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;

    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [timeframe, setTimeframe] = useState<'all_time' | 'today'>('all_time');

    const fetchStats = useCallback(async () => {
        try {
            const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/dashboard/stats`);
            if (!response.ok) throw new Error('Failed to fetch dashboard stats.');
            setStats(await response.json());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        document.body.style.backgroundColor = currentThemeColors.background;
        fetchStats();
    }, [currentThemeColors.background, fetchStats]);

    const handleFeedbackAction = async (action: 'delete' | 'update_status', id: number, newStatus?: string) => {
        let url = `${import.meta.env.VITE_API_BASE_URL}/api/feedback/${id}`;
        let options: RequestInit = { method: 'DELETE' };

        if (action === 'update_status') {
            url += '/status';
            options = {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            };
        }

        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`Failed to ${action} feedback.`);
            // Refresh stats from server to show changes
            await fetchStats();
        } catch (err) {
            console.error(err);
            alert(`Could not perform action: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const cardColors = {
        green: { bg: theme === 'light' ? '#f0fdf4' : '#143623', border: theme === 'light' ? '#a7f3d0' : '#15803d', text: theme === 'light' ? '#15803d' : '#a7f3d0' },
        blue: { bg: theme === 'light' ? '#eff6ff' : '#1e3a8a', border: theme === 'light' ? '#bfdbfe' : '#1e40af', text: theme === 'light' ? '#1d4ed8' : '#bfdbfe' },
        amber: { bg: theme === 'light' ? '#fffbeb' : '#422006', border: theme === 'light' ? '#fde68a' : '#b45309', text: theme === 'light' ? '#b45309' : '#fde68a' },
        purple: { bg: theme === 'light' ? '#f5f3ff' : '#2c1e48', border: theme === 'light' ? '#ddd6fe' : '#5b21b6', text: theme === 'light' ? '#5b21b6' : '#ddd6fe' },
        pink: { bg: theme === 'light' ? '#fdf2f8' : '#571332', border: theme === 'light' ? '#fbcfe8' : '#db2777', text: theme === 'light' ? '#db2777' : '#fbcfe8' },
        sky: { bg: theme === 'light' ? '#f0f9ff' : '#0c2f4a', border: theme === 'light' ? '#bae6fd' : '#0ea5e9', text: theme === 'light' ? '#0ea5e9' : '#bae6fd' },
    };

    if (isLoading) return <div style={{ color: currentThemeColors.text, textAlign: 'center', paddingTop: '50px' }}>Loading Dashboard...</div>;
    if (error) return <div style={{ color: 'red', textAlign: 'center', paddingTop: '50px' }}>Error: {error}</div>;
    if (!stats) return <div style={{ color: currentThemeColors.text, textAlign: 'center', paddingTop: '50px' }}>No stats available.</div>;

    const displayStats = stats[timeframe];
    return (
        <div style={{ backgroundColor: currentThemeColors.background, color: currentThemeColors.text, padding: '24px', fontFamily: "'Inter', sans-serif", minHeight: '100vh' }}>
            <button onClick={() => navigate('/record')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: currentThemeColors.secondaryText, fontSize: '15px', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '0', marginBottom: '24px' }}>
                ← Back to Recordings
            </button>

            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1 style={{ margin: '0 0 4px 0', fontSize: '28px', fontWeight: 'bold' }}>Dashboard</h1>
                    <p style={{ margin: 0, color: currentThemeColors.secondaryText }}>Platform usage and feedback overview.</p>
                </div>
                <div style={{ display: 'flex', backgroundColor: currentThemeColors.backgroundSecondary, borderRadius: '8px', padding: '4px' }}>
                    <button onClick={() => setTimeframe('today')} style={{ padding: '6px 12px', border: 'none', borderRadius: '6px', backgroundColor: timeframe === 'today' ? currentThemeColors.body : 'transparent', color: currentThemeColors.text, cursor: 'pointer' }}>Today</button>
                    <button onClick={() => setTimeframe('all_time')} style={{ padding: '6px 12px', border: 'none', borderRadius: '6px', backgroundColor: timeframe === 'all_time' ? currentThemeColors.body : 'transparent', color: currentThemeColors.text, cursor: 'pointer' }}>All-Time</button>
                </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <StatCard title="Summaries Generated" value={displayStats.total_summaries} icon="📝" color={cardColors.blue} />
                <StatCard title="Words Transcribed" value={displayStats.total_words} icon="✍️" color={cardColors.amber} />
                <StatCard title="Total Hours Recorded" value={displayStats.total_duration_seconds} icon="⏱️" color={cardColors.green} />
            </div>

            <div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}`, marginBottom: '32px' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>Interesting Facts (All-Time)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px'}}>
                    <StatCard title="Avg. Summary Words" value={stats.interesting_facts.avg_summary_words} icon="📊" color={cardColors.purple} />
                    <StatCard title="Most Active Day" value={stats.interesting_facts.most_active_day} icon="🗓️" color={cardColors.pink} />
                    <StatCard title="Busiest Hour" value={stats.interesting_facts.busiest_hour} icon="⏰" color={cardColors.sky} />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginBottom: '32px', alignItems: 'flex-start' }}>
                <div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}` }}>
                    <BarChart title="Device Types" data={stats.device_distribution} theme={currentThemeColors} />
                </div>
                <div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}` }}>
                    <PieChart title="Feedback Distribution" data={stats.feedback_counts} theme={currentThemeColors} />
                </div>
            </div>

            <div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}`, marginBottom: '32px' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 500 }}>Feature Suggestions</h3>
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {stats.feature_suggestions.length > 0 ? (
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                            {stats.feature_suggestions.map((item: FeatureSuggestion) => (
                                <li key={item.id} style={{ padding: '12px', borderBottom: `1px solid ${currentThemeColors.backgroundSecondary}`, display: 'flex', alignItems: 'center', gap: '12px', transition: 'background-color 0.2s ease' }} onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = currentThemeColors.background)} onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>
                                    <input
                                        type="checkbox"
                                        checked={item.status === 'done'}
                                        onChange={(e) => handleFeedbackAction('update_status', item.id, e.target.checked ? 'done' : 'new')}
                                        style={{ flexShrink: 0, width: '18px', height: '18px', cursor: 'pointer' }}
                                    />
                                    <div onClick={() => navigate(`/summary/${item.meeting_id}`)} style={{ flexGrow: 1, cursor: 'pointer' }}>
                                        <p style={{ margin: 0, fontWeight: 500, textDecoration: item.status === 'done' ? 'line-through' : 'none', color: item.status === 'done' ? currentThemeColors.secondaryText : currentThemeColors.text }}>{item.suggestion}</p>
                                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: currentThemeColors.secondaryText }}>From: <span style={{ fontWeight: '500' }}>{item.meeting_title}</span></p>
                                    </div>
                                    <button onClick={() => handleFeedbackAction('delete', item.id)} title="Delete suggestion" style={{ background: 'none', border: 'none', cursor: 'pointer', color: currentThemeColors.secondaryText, fontSize: '16px' }}>
                                        ✕
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p style={{ color: currentThemeColors.secondaryText, textAlign: 'center', padding: '20px 0' }}>No feature suggestions submitted yet.</p>
                    )}
                </div>
            </div>

            <div style={{ backgroundColor: currentThemeColors.body, padding: '20px', borderRadius: '12px', border: `1px solid ${currentThemeColors.border}` }}>
                <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 'bold' }}>Feedback Log</h2>
                <FeedbackTable meetings={stats.meetings_with_feedback} theme={currentThemeColors} navigate={navigate} onDeleteFeedback={(id) => handleFeedbackAction('delete', id)} />
            </div>
        </div>
    );
}