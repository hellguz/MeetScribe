# Pause Recording — Design Spec

**Date:** 2026-03-25
**Branch:** essense-mode (targeting main)

---

## Overview

Add a pause/resume button to the live recording UI. When paused, no new audio chunks are captured or uploaded, but live transcript polling continues uninterrupted. A heartbeat keeps the backend meeting alive during the pause so the janitor does not auto-finalize it. If the tab is closed or connection drops while paused, the janitor naturally finalizes the meeting after 5 minutes of inactivity — producing a summary from whatever was recorded.

---

## Requirements

- User can pause and resume a live recording at any time.
- Timer freezes while paused and resumes accurately (does not count paused time).
- Live transcript polling continues at normal cadence (3s) while paused.
- A 2-hour pause does not trigger backend auto-finalization.
- If the page closes or connection drops (paused or not), the meeting is recovered and summarized within ~5 minutes via the existing janitor.
- No changes to the backend data model or database migrations.

---

## Architecture

### Backend — 1 new endpoint

`POST /api/meetings/{meeting_id}/heartbeat`

- Requires: `meeting_id` path param (UUID)
- Action: load the meeting from DB, update `last_activity = utcnow()`, commit
- Returns: `{"ok": true}`
- Error: 404 if meeting not found
- No auth beyond the existing pattern (meeting ID is effectively the token)

This resets the 5-minute inactivity clock, preventing the janitor from auto-finalizing an actively-paused meeting.

### Frontend — `useRecording.ts`

**New state:**
- `isPaused: boolean` — drives UI
- `isPausedRef: MutableRefObject<boolean>` — used inside callbacks (mirrors `isRecordingRef` pattern)
- `pausedDurationRef: MutableRefObject<number>` — accumulated milliseconds spent paused, used for accurate timer
- `pausedAtRef: MutableRefObject<number | null>` — timestamp when current pause started
- `chunkTimerRef: MutableRefObject<NodeJS.Timeout | null>` — holds the active 30s chunk-rotation timeout so it can be cancelled on pause
- `heartbeatIntervalRef: MutableRefObject<NodeJS.Timeout | null>` — 2-minute heartbeat interval, active only while paused

**`createAndStartRecorder` changes:**
- After `recorder.start()`, store the `setTimeout(..., CHUNK_DURATION_MS)` handle in `chunkTimerRef` instead of leaving it anonymous.

**`pauseRecording()`:**
1. `mediaRef.current.pause()` — suspends audio capture; no `ondataavailable` fires
2. Set `isPaused = true` / `isPausedRef.current = true`
3. Record `pausedAtRef.current = Date.now()`
4. `clearInterval(timerRef.current)` — freeze the displayed timer
5. `clearTimeout(chunkTimerRef.current)` — cancel the pending 30s chunk rotation
6. Start `heartbeatIntervalRef`: every 2 minutes, `POST /api/meetings/{id}/heartbeat`

**`resumeRecording()`:**
1. `mediaRef.current.resume()` — audio capture resumes on the same recorder
2. Accumulate paused time: `pausedDurationRef.current += Date.now() - pausedAtRef.current`
3. Clear `pausedAtRef.current`
4. Set `isPaused = false` / `isPausedRef.current = false`
5. `clearInterval(heartbeatIntervalRef.current)` — stop heartbeat
6. Restart `timerRef` — timer now accounts for paused duration via `startTimeRef` offset
7. Restart a fresh `chunkTimerRef` timeout for `CHUNK_DURATION_MS` — when it fires, `recorder.stop()` triggers the normal `onstop` → `createAndStartRecorder` cycle

**Timer accuracy:**
The elapsed time shown is:
```
elapsed = (Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000
```
`setRecordingTime` is updated in `timerRef` using this formula.

**`stopRecording` changes:**
- Clear `heartbeatIntervalRef` if active (user stops while paused — valid action)
- Clear `chunkTimerRef` if active
- Reset `isPaused = false`, `pausedDurationRef.current = 0`, `pausedAtRef.current = null`

**`resetState` changes:**
- Reset all new refs/state to initial values

**Exported value:**
- Add `isPaused`, `pauseRecording`, `resumeRecording` to the hook's return object

### Frontend — `RecordingStatus.tsx`

- Add a **Pause / Resume toggle button** in the recording controls, positioned between the waveform and the Stop button.
- When paused:
  - Button label/icon switches to "Resume"
  - Timer display shows a visual indicator (e.g., dimmed or with a "paused" label)
  - Waveform animation stops (no new audio data)
- When recording:
  - Button label/icon shows "Pause"
- Button is only visible when `isRecording === true` (hidden during processing/idle)

---

## Data Flow

```
User clicks Pause
  → mediaRef.current.pause()         # no audio captured
  → isPaused = true
  → timerRef cleared                 # timer freezes
  → chunkTimerRef cleared            # no chunk rotation
  → heartbeat starts (2 min interval)
    → POST /heartbeat                 # updates last_activity
    → repeat every 2 min

User clicks Resume
  → mediaRef.current.resume()        # audio resumes on same recorder
  → pausedDuration accumulated
  → isPaused = false
  → heartbeat cleared
  → timerRef restarted (accurate elapsed)
  → chunkTimerRef restarted (fresh 30s)

Tab closed while paused
  → heartbeat stops
  → no more chunk uploads
  → backend janitor fires after 5 min
  → meeting finalized, summary generated
```

---

## Edge Cases

| Scenario | Handling |
|---|---|
| User pauses then immediately stops | `stopRecording` clears heartbeat and chunk timer, uploads final empty blob as normal |
| MediaRecorder already stopped when pause called | Guard: only call `.pause()` if `mediaRef.current.state === 'recording'` |
| Heartbeat request fails (network blip) | Silently ignored — a single missed heartbeat within a 2-min window is fine; the 5-min janitor threshold gives 2+ misses of buffer |
| Resume called when not paused | Guard: only resume if `isPausedRef.current === true` |
| Page reload while paused | State lost; heartbeat stops; janitor finalizes in ~5 min |
| System audio source (screen share) | No changes needed — `mediaRef.current` is the same regardless of source |

---

## Files Changed

| File | Change |
|---|---|
| `backend/app/main.py` | Add `POST /api/meetings/{id}/heartbeat` endpoint |
| `frontend/src/hooks/useRecording.ts` | Add pause/resume logic, heartbeat, accurate timer |
| `frontend/src/components/RecordingStatus.tsx` | Add pause/resume button and paused visual state |

No DB migrations. No new dependencies.
