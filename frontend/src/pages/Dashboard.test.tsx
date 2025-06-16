// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom'; // Needed for <Link> or navigate if used
import { ThemeContext, ThemeContextType } from '../contexts/ThemeContext';
import { lightTheme, AppTheme } from '../styles/theme';
import Dashboard from './Dashboard';

// Mock fetch
global.fetch = vi.fn();

const mockThemeContext: ThemeContextType = {
  theme: 'light',
  setTheme: () => {},
  currentThemeColors: lightTheme as AppTheme, // Cast because the actual type includes darkTheme too
};

const renderDashboard = () => {
  return render(
    <MemoryRouter>
      <ThemeContext.Provider value={mockThemeContext}>
        <Dashboard />
      </ThemeContext.Provider>
    </MemoryRouter>
  );
};

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.resetAllMocks(); // Reset mocks before each test
  });

  it('shows loading state initially', () => {
    (fetch as vi.Mock).mockImplementationOnce(() => new Promise(() => {})); // Pending promise
    renderDashboard();
    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument();
  });

  it('shows error state if API call fails', async () => {
    (fetch as vi.Mock).mockRejectedValueOnce(new Error('API Error'));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/Error loading dashboard: API Error/i)).toBeInTheDocument();
    });
  });

  it('shows specific error for 404', async () => {
    (fetch as vi.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Not Found' }),
    });
    renderDashboard();
    await waitFor(() => {
        expect(screen.getByText(/Stats endpoint not found \(404\)/i)).toBeInTheDocument();
    });
  });

  it('displays statistics correctly with data', async () => {
    const mockData = {
      button_clicks: {
        spot_on: 5,
        too_short: 2,
      },
      feature_suggestions: [
        { id: 1, meeting_id: 'uuid-1', feature_suggestion: 'More cowbell', created_at: new Date().toISOString() },
        { id: 2, meeting_id: 'uuid-2', feature_suggestion: 'Sliding tables', created_at: new Date(Date.now() - 10000).toISOString() },
      ],
    };
    (fetch as vi.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderDashboard();

    await waitFor(() => {
      // Check button clicks (bar chart text representation)
      expect(screen.getByText(/Spot on:/i)).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument(); // Count for spot_on
      expect(screen.getByText(/Too short:/i)).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument(); // Count for too_short

      // Check feature suggestions
      expect(screen.getByText('More cowbell')).toBeInTheDocument();
      expect(screen.getByText('uuid-1')).toBeInTheDocument();
      expect(screen.getByText('Sliding tables')).toBeInTheDocument();
      expect(screen.getByText('uuid-2')).toBeInTheDocument();
    });
  });

  it('displays empty states if no data is available', async () => {
    const mockData = {
      button_clicks: {},
      feature_suggestions: [],
    };
    (fetch as vi.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('No button click data yet.')).toBeInTheDocument();
      expect(screen.getByText('No feature suggestions submitted yet.')).toBeInTheDocument();
    });
  });

  it('renders the bar chart elements for button clicks', async () => {
    const mockData = {
      button_clicks: {
        spot_on: 10,
        too_detailed: 3,
      },
      feature_suggestions: [],
    };
    (fetch as vi.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderDashboard();
    await waitFor(() => {
      const spotOnText = screen.getByText(/Spot on:/i);
      // The bar is a div sibling to the text "10"
      // This is a bit fragile, depends on DOM structure
      const spotOnBar = spotOnText.nextElementSibling; // The div for the bar
      const spotOnCount = spotOnBar?.nextElementSibling; // The span with the count

      expect(spotOnBar).toBeInTheDocument();
      expect(spotOnBar).toHaveStyle('background-color: var(--button-primary-background)'); // Check a style based on theme
      expect(spotOnBar).toHaveStyle('width: 70%'); // Max clicks gets 70%
      expect(spotOnCount?.textContent).toBe('10');

      const tooDetailedText = screen.getByText(/Too detailed:/i);
      const tooDetailedBar = tooDetailedText.nextElementSibling;
      const tooDetailedCount = tooDetailedBar?.nextElementSibling;
      expect(tooDetailedBar).toBeInTheDocument();
      // 10 is max, 3 is current, so width should be (3/10)*70% = 21%
      expect(tooDetailedBar).toHaveStyle('width: 21%');
      expect(tooDetailedCount?.textContent).toBe('3');
    });
  });
});
