// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveMeeting, getHistory, MeetingMeta } from './history';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

const FIVE_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 5;

describe('Meeting History', () => {
  beforeEach(() => {
    localStorageMock.clear();
    // vi.useFakeTimers(); // Use fake timers for date-sensitive tests
  });

  afterEach(() => {
    // vi.useRealTimers(); // Restore real timers
  });

  const meeting1: MeetingMeta = {
    id: '1',
    title: 'Meeting 1',
    started_at: new Date(Date.now() - 10000).toISOString(),
    status: 'pending',
  };
  const meeting2: MeetingMeta = {
    id: '2',
    title: 'Meeting 2',
    started_at: new Date(Date.now() - 20000).toISOString(),
    status: 'complete',
  };
  const oldMeeting: MeetingMeta = {
    id: 'old',
    title: 'Old Meeting',
    started_at: new Date(Date.now() - FIVE_YEARS_MS - 100000).toISOString(),
    status: 'complete',
  };

  describe('saveMeeting', () => {
    it('should save a new meeting correctly', () => {
      saveMeeting(meeting1);
      const history = JSON.parse(localStorageMock.getItem('meetscribe_history') || '[]');
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(meeting1);
    });

    it('should add a new meeting to an existing list', () => {
      localStorageMock.setItem('meetscribe_history', JSON.stringify([meeting1]));
      saveMeeting(meeting2);
      const history = JSON.parse(localStorageMock.getItem('meetscribe_history') || '[]');
      expect(history).toHaveLength(2);
      expect(history.find(m => m.id === meeting1.id)).toEqual(meeting1);
      expect(history.find(m => m.id === meeting2.id)).toEqual(meeting2);
    });

    it('should update an existing meeting by id (e.g. status change)', () => {
      localStorageMock.setItem('meetscribe_history', JSON.stringify([meeting1, meeting2]));
      const updatedMeeting1: MeetingMeta = { ...meeting1, status: 'complete', title: "Updated Meeting 1" };
      saveMeeting(updatedMeeting1);

      const history = JSON.parse(localStorageMock.getItem('meetscribe_history') || '[]');
      expect(history).toHaveLength(2);
      const foundMeeting = history.find(m => m.id === meeting1.id);
      expect(foundMeeting).toEqual(updatedMeeting1);
      expect(history.find(m => m.id === meeting2.id)).toEqual(meeting2); // Ensure other meeting is untouched
    });
  });

  describe('getHistory', () => {
    it('should return an empty array if no history exists', () => {
      expect(getHistory()).toEqual([]);
    });

    it('should retrieve meetings with their correct statuses', () => {
      localStorageMock.setItem('meetscribe_history', JSON.stringify([meeting1, meeting2]));
      const history = getHistory();
      expect(history).toHaveLength(2);
      expect(history.find(m => m.id === meeting1.id)?.status).toBe('pending');
      expect(history.find(m => m.id === meeting2.id)?.status).toBe('complete');
    });

    it('should sort meetings by started_at date descending', () => {
      // meeting1 is newer than meeting2
      localStorageMock.setItem('meetscribe_history', JSON.stringify([meeting2, meeting1]));
      const history = getHistory();
      expect(history[0].id).toBe(meeting1.id);
      expect(history[1].id).toBe(meeting2.id);
    });

    it('should filter out meetings older than 5 years', () => {
      localStorageMock.setItem('meetscribe_history', JSON.stringify([meeting1, oldMeeting, meeting2]));
      const history = getHistory();
      expect(history).toHaveLength(2);
      expect(history.find(m => m.id === 'old')).toBeUndefined();
      expect(history.find(m => m.id === meeting1.id)).toBeDefined();
      expect(history.find(m => m.id === meeting2.id)).toBeDefined();
    });

    it('should handle malformed JSON in localStorage gracefully', () => {
      localStorageMock.setItem('meetscribe_history', 'this is not json');
      // Suppress console.warn for this test
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const history = getHistory();
      expect(history).toEqual([]);
      consoleWarnSpy.mockRestore();
    });
  });
});
