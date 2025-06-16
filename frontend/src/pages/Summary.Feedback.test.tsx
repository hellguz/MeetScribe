// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom'; // Needed for useParams and navigate
import { ThemeContext, ThemeContextType } from '../contexts/ThemeContext';
import { lightTheme, AppTheme } from '../styles/theme';
import Summary from './Summary'; // The component we're testing

// Mock fetch
global.fetch = vi.fn();

// Mock useParams
const mockMeetingId = 'test-meeting-123';
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ mid: mockMeetingId }),
  };
});

const mockThemeContext: ThemeContextType = {
  theme: 'light',
  setTheme: () => {},
  currentThemeColors: lightTheme as AppTheme,
};

const renderSummaryPage = () => {
  // Summary page fetches data on mount, mock this initial fetch
  (fetch as vi.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: mockMeetingId,
      title: 'Test Meeting',
      summary_markdown: 'This is a summary.', // Needed to show feedback buttons
      transcript_text: 'This is a transcript.',
      done: true,
      started_at: new Date().toISOString(),
      received_chunks: 1,
      expected_chunks: 1,
      transcribed_chunks:1,
    }),
  });

  return render(
    <MemoryRouter initialEntries={[`/summary/${mockMeetingId}`]}>
      <ThemeContext.Provider value={mockThemeContext}>
        <Routes>
          <Route path="/summary/:mid" element={<Summary />} />
        </Routes>
      </ThemeContext.Provider>
    </MemoryRouter>
  );
};

describe('Summary Page - Feedback Buttons', () => {
  beforeEach(() => {
    vi.resetAllMocks(); // Reset mocks before each test
    // Clear any timers from previous tests if feedbackMessage uses setTimeout
    vi.clearAllTimers();
    vi.useFakeTimers(); // Use fake timers for controlling setTimeout in feedbackMessage
  });

  const feedbackTypes = [
    { label: /Spot on!/i, type: 'spot_on' },
    { label: /Too short/i, type: 'too_short' },
    { label: /Too detailed/i, type: 'too_detailed' },
    { label: /Too general/i, type: 'too_general' },
    { label: /Not accurate/i, type: 'not_accurate' },
  ];

  feedbackTypes.forEach(({ label, type }) => {
    it(`sends correct payload when "${label}" button is clicked`, async () => {
      renderSummaryPage();
      // Wait for summary to load so feedback buttons appear
      await waitFor(() => expect(screen.getByText('This is a summary.')).toBeInTheDocument());

      const feedbackButton = screen.getByRole('button', { name: label });

      // Mock the POST /api/feedback response
      (fetch as vi.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, meeting_id: mockMeetingId, feedback_type: type, created_at: new Date().toISOString() }),
      });

      fireEvent.click(feedbackButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/api/feedback`),
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              meeting_id: mockMeetingId,
              feedback_type: type,
            }),
          })
        );
      });

      // Check for success message
      expect(await screen.findByText(`Feedback "${type}" submitted successfully!`)).toBeInTheDocument();
      vi.advanceTimersByTime(3000); // Advance timer to hide message
      await waitFor(() => {
        expect(screen.queryByText(`Feedback "${type}" submitted successfully!`)).not.toBeInTheDocument();
      });
    });
  });

  it('handles "Suggest a feature" flow correctly', async () => {
    renderSummaryPage();
    await waitFor(() => expect(screen.getByText('This is a summary.')).toBeInTheDocument());

    const suggestButton = screen.getByRole('button', { name: /Suggest a feature/i });
    fireEvent.click(suggestButton);

    const inputField = await screen.findByPlaceholderText('Your feature suggestion...');
    const sendButton = screen.getByRole('button', { name: /Send/i });

    expect(inputField).toBeInTheDocument();
    expect(sendButton).toBeInTheDocument();
    expect(sendButton).toBeDisabled(); // Send button should be disabled initially

    const suggestionText = 'Enable dark mode by default.';
    fireEvent.change(inputField, { target: { value: suggestionText } });
    expect(inputField).toHaveValue(suggestionText);
    expect(sendButton).not.toBeDisabled(); // Should be enabled after typing

    // Mock the POST /api/feedback response
    (fetch as vi.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 2, meeting_id: mockMeetingId, feedback_type: 'feature_suggestion', feature_suggestion: suggestionText, created_at: new Date().toISOString() }),
    });

    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/feedback`),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meeting_id: mockMeetingId,
            feedback_type: 'feature_suggestion',
            feature_suggestion: suggestionText,
          }),
        })
      );
    });

    // Check for success message
    expect(await screen.findByText(`Feedback "feature_suggestion" submitted successfully!`)).toBeInTheDocument();

    // Input field should be hidden and cleared
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Your feature suggestion...')).not.toBeInTheDocument();
    });

    vi.advanceTimersByTime(3000); // Advance timer to hide success message
     await waitFor(() => {
        expect(screen.queryByText(`Feedback "feature_suggestion" submitted successfully!`)).not.toBeInTheDocument();
    });
  });

  it('shows error message on feedback submission failure', async () => {
    renderSummaryPage();
    await waitFor(() => expect(screen.getByText('This is a summary.')).toBeInTheDocument());

    const spotOnButton = screen.getByRole('button', { name: /Spot on!/i });

    (fetch as vi.Mock).mockRejectedValueOnce(new Error('Network failure'));

    fireEvent.click(spotOnButton);

    await waitFor(() => {
      expect(screen.getByText(/Error: Network failure/i)).toBeInTheDocument();
    });

    vi.advanceTimersByTime(5000); // Advance timer to hide error message
    await waitFor(() => {
      expect(screen.queryByText(/Error: Network failure/i)).not.toBeInTheDocument();
    });
  });
});
