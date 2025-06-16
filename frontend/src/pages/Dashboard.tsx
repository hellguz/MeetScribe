import React, { useEffect, useState, useContext } from 'react';
import { ThemeContext } from '../contexts/ThemeContext';
import { lightTheme, darkTheme, AppTheme } from '../styles/theme';
import { useNavigate }  from 'react-router-dom'; // For back button

// Define interfaces for the expected data structure
interface ButtonClicks {
  [key: string]: number;
}

interface FeatureSuggestion {
  id: number;
  meeting_id: string; // Assuming UUID is string here
  feature_suggestion: string;
  created_at: string;
}

interface StatsData {
  button_clicks: ButtonClicks;
  feature_suggestions: FeatureSuggestion[];
}

export default function Dashboard() {
  const themeContext = useContext(ThemeContext);
  if (!themeContext) throw new Error('ThemeContext not found');
  const { theme } = themeContext;
  const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;
  const navigate = useNavigate();

  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // This endpoint doesn't exist yet, so this will likely fail.
        // Replace with actual endpoint when available.
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/feedback/stats`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Stats endpoint not found (404). Please ensure backend is updated.');
          }
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }
        const data: StatsData = await response.json();
        setStatsData(data);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred while fetching stats.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, []);

  const pageContainerStyles: React.CSSProperties = {
    fontFamily: currentThemeColors.fontFamily,
    color: currentThemeColors.text,
    backgroundColor: currentThemeColors.background,
    minHeight: '100vh',
    padding: '24px',
    maxWidth: '1200px',
    margin: '0 auto',
  };

  const sectionStyles: React.CSSProperties = {
    backgroundColor: currentThemeColors.backgroundSecondary,
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '24px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  };

  const tableStyles: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '10px',
  };

  const thStyles: React.CSSProperties = {
    borderBottom: `2px solid ${currentThemeColors.border}`,
    padding: '12px 8px',
    textAlign: 'left',
    color: currentThemeColors.text,
  };

  const tdStyles: React.CSSProperties = {
    borderBottom: `1px solid ${currentThemeColors.border}`,
    padding: '10px 8px',
    color: currentThemeColors.secondaryText,
  };

  const backButtonStyles: React.CSSProperties = {
    background: 'none',
    border: `1px solid ${currentThemeColors.border}`,
    color: currentThemeColors.text,
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '15px',
    fontFamily: 'inherit',
    marginBottom: '24px',
    transition: 'background-color 0.2s, color 0.2s',
  };


  if (isLoading) {
    return <div style={pageContainerStyles}><p>Loading dashboard...</p></div>;
  }

  // Error display will be prominent if API doesn't work
  if (error) {
    return (
      <div style={pageContainerStyles}>
        <button onClick={() => navigate(-1)} style={backButtonStyles}>← Back</button>
        <h1 style={{ color: currentThemeColors.text }}>Dashboard</h1>
        <p style={{ color: currentThemeColors.button.danger }}>Error loading dashboard: {error}</p>
        <p><i>This page requires a backend endpoint at `/api/feedback/stats` which might not be implemented yet.</i></p>
      </div>
    );
  }

  if (!statsData) {
    return <div style={pageContainerStyles}><p>No statistics data available.</p></div>;
  }

  // Simple bar chart representation for button clicks
  const renderBarChart = (clicks: ButtonClicks) => {
    const maxClicks = Math.max(...Object.values(clicks), 0);
    if (Object.keys(clicks).length === 0) return <p>No button click data yet.</p>;

    return (
      <div style={{ marginTop: '10px' }}>
        {Object.entries(clicks).map(([type, count]) => (
          <div key={type} style={{ marginBottom: '8px' }}>
            <span style={{ display: 'inline-block', width: '120px', textTransform: 'capitalize' }}>
              {type.replace(/_/g, ' ')}:
            </span>
            <div style={{
              display: 'inline-block',
              width: maxClicks > 0 ? `${(count / maxClicks) * 70}%` : '0%', // Max 70% width for bar
              minWidth: '10px', // Minimum width for tiny bars
              height: '20px',
              backgroundColor: currentThemeColors.button.primaryBackground, // Use a theme color
              borderRadius: '4px',
              marginRight: '8px',
              verticalAlign: 'middle',
            }}></div>
            <span style={{ color: currentThemeColors.text }}>{count}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={pageContainerStyles}>
      <button
        onClick={() => navigate(-1)} // Or a specific path like '/record'
        style={backButtonStyles}
        onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = currentThemeColors.button.hoverBackground;
            e.currentTarget.style.color = currentThemeColors.button.hoverText;
        }}
        onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = currentThemeColors.text;
        }}
      >
        ← Back
      </button>
      <h1 style={{ color: currentThemeColors.text, marginBottom: '24px' }}>Feedback Dashboard</h1>

      <div style={sectionStyles}>
        <h2 style={{ color: currentThemeColors.text, marginTop: 0 }}>Button Click Counts</h2>
        {renderBarChart(statsData.button_clicks)}
      </div>

      <div style={sectionStyles}>
        <h2 style={{ color: currentThemeColors.text, marginTop: 0 }}>Feature Suggestions</h2>
        {statsData.feature_suggestions.length > 0 ? (
          <table style={tableStyles}>
            <thead>
              <tr>
                <th style={thStyles}>Suggestion</th>
                <th style={thStyles}>Meeting ID</th>
                <th style={thStyles}>Date</th>
              </tr>
            </thead>
            <tbody>
              {statsData.feature_suggestions.map((suggestion) => (
                <tr key={suggestion.id}>
                  <td style={tdStyles}>{suggestion.feature_suggestion}</td>
                  <td style={{...tdStyles, fontFamily: 'monospace', fontSize: '13px' }}>{suggestion.meeting_id}</td>
                  <td style={tdStyles}>{new Date(suggestion.created_at).toLocaleDateString()} {new Date(suggestion.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No feature suggestions submitted yet.</p>
        )}
      </div>
    </div>
  );
}
