import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FeedbackComponent from './FeedbackComponent';

// Mock the onSubmit prop
const mockOnSubmit = jest.fn();

// Mock timers for setTimeout
jest.useFakeTimers();

describe('FeedbackComponent', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockOnSubmit.mockClear();
    // Render the component with default props for most tests
    render(<FeedbackComponent onSubmit={mockOnSubmit} theme="light" />);
  });

  afterEach(() => {
    // Clear any pending timers
    jest.clearAllTimers();
  });

  describe('Chip Selection', () => {
    test('calls onSubmit with the correct type and displays thank you message when a chip is selected', async () => {
      const chipButton = screen.getByText('On the spot'); // Assumes 'accurate' type
      fireEvent.click(chipButton);

      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      expect(mockOnSubmit).toHaveBeenCalledWith(['accurate'], '');

      // Check for thank you message
      expect(await screen.findByText('Thanks for your feedback! ✨')).toBeVisible();

      // Optional: Check for selected styling (can be complex)
      // For example, if a class or ARIA attribute is added:
      // expect(chipButton).toHaveClass('selected'); // This depends on actual implementation
      // expect(chipButton).toHaveAttribute('aria-pressed', 'true');

      // Fast-forward timers to hide the message
      jest.runAllTimers();
      await waitFor(() => {
        expect(screen.queryByText('Thanks for your feedback! ✨')).not.toBeInTheDocument();
      });
    });

    test('does NOT call onSubmit when a selected chip is deselected', async () => {
      const chipButton = screen.getByText('Too short'); // Assumes 'too_short' type

      // Select
      fireEvent.click(chipButton);
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      expect(mockOnSubmit).toHaveBeenCalledWith(['too_short'], '');

      // Wait for the first "Thanks" message to appear and disappear to avoid interference
      expect(await screen.findByText('Thanks for your feedback! ✨')).toBeVisible();
      jest.runAllTimers();
      await waitFor(() => {
        expect(screen.queryByText('Thanks for your feedback! ✨')).not.toBeInTheDocument();
      });

      // Deselect
      fireEvent.click(chipButton);
      // mockOnSubmit should still have been called only once
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);

      // Ensure no new "Thanks" message for deselection
      expect(screen.queryByText('Thanks for your feedback! ✨')).not.toBeInTheDocument();
    });
  });

  describe('Text Suggestion', () => {
    test('calls onSubmit with suggestion text and displays thank you message', async () => {
      const input = screen.getByPlaceholderText('Have a feature suggestion or other comment?');
      const submitButtonQuery = () => screen.queryByText('Submit Feedback');

      fireEvent.change(input, { target: { value: 'Great work!' } });
      expect(submitButtonQuery()).toBeVisible(); // Button should be visible now

      if (submitButtonQuery()) {
        fireEvent.click(submitButtonQuery()!);
      }

      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      expect(mockOnSubmit).toHaveBeenCalledWith([], 'Great work!');

      expect(await screen.findByText('Thanks for your feedback! ✨')).toBeVisible();
      expect(input).toHaveValue(''); // Input field should be cleared

      // Fast-forward timers
      jest.runAllTimers();
      await waitFor(() => {
        expect(screen.queryByText('Thanks for your feedback! ✨')).not.toBeInTheDocument();
      });
    });

    test('does not call onSubmit if suggestion is empty', () => {
      // The button should not even be visible if the suggestion is empty
      const submitButton = screen.queryByText('Submit Feedback');
      expect(submitButton).not.toBeInTheDocument();

      // Attempt to submit via form if somehow possible (though button isn't there)
      // This test primarily relies on the button not being there.
      // If there was a form element to target:
      // const form = screen.getByRole('form'); // Assuming the form has a role or accessible name
      // fireEvent.submit(form);

      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  describe('Submit Button UI', () => {
    test('submit button is not visible initially', () => {
      expect(screen.queryByText('Submit Feedback')).not.toBeInTheDocument();
    });

    test('submit button becomes visible when text is entered', () => {
      const input = screen.getByPlaceholderText('Have a feature suggestion or other comment?');
      fireEvent.change(input, { target: { value: 'test' } });
      expect(screen.getByText('Submit Feedback')).toBeVisible();
    });

    test('submit button hides if text is cleared', () => {
      const input = screen.getByPlaceholderText('Have a feature suggestion or other comment?');

      // Type then clear
      fireEvent.change(input, { target: { value: 'test' } });
      expect(screen.getByText('Submit Feedback')).toBeVisible();
      fireEvent.change(input, { target: { value: '' } });
      expect(screen.queryByText('Submit Feedback')).not.toBeInTheDocument();
    });

    test('submit button is disabled during submission and re-enabled (or hidden)', async () => {
      // For this test, we need to control the promise resolution
      mockOnSubmit.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

      // Re-render with the new mock for this specific test if needed, or ensure the top-level render uses this mock.
      // The beforeEach already renders, but if we need a specific onSubmit for this test:
      // render(<FeedbackComponent onSubmit={mockOnSubmit} theme="light" />);
      // However, mockOnSubmit is already in scope and modified.

      const input = screen.getByPlaceholderText('Have a feature suggestion or other comment?');
      fireEvent.change(input, { target: { value: 'Long submission' } });

      const submitButton = screen.getByText('Submit Feedback');
      expect(submitButton).toBeVisible();

      fireEvent.click(submitButton);

      // During submission
      expect(submitButton).toBeDisabled();
      expect(screen.getByText('Submitting...')).toBeVisible(); // Check for submitting text
      expect(mockOnSubmit).toHaveBeenCalledWith([], 'Long submission');

      // Fast-forward ONLY the mock timer for the promise, not Jest's fake timers for UI
      // This requires more advanced timer mocking if jest.useFakeTimers() is too broad.
      // For simplicity, we'll advance all timers and then check state.
      // A more robust way would be to manage promise resolution manually outside of Jest timers.

      jest.runAllTimers(); // This will resolve the setTimeout in mockOnSubmit and UI timers

      await waitFor(() => {
        // After submission, input is cleared, so button should be hidden
        expect(screen.queryByText('Submit Feedback')).not.toBeInTheDocument();
      });
      // And "Thanks" message should have appeared
      expect(screen.getByText('Thanks for your feedback! ✨')).toBeVisible();

      // Fast-forward timers again to hide the "Thanks" message
      jest.runAllTimers();
      await waitFor(() => {
        expect(screen.queryByText('Thanks for your feedback! ✨')).not.toBeInTheDocument();
      });
    });
  });
});

// Clean up fake timers
afterAll(() => {
  jest.useRealTimers();
});
