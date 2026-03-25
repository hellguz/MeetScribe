# Pause Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pause/resume button to live recording that freezes the timer and waveform, stops chunk uploads, with a heartbeat keeping the backend alive, and graceful recovery if the tab closes while paused.

**Architecture:** `MediaRecorder.pause()/resume()` handles the browser-side audio suspension. A 90-second heartbeat interval POSTs to a new `/api/meetings/{id}/heartbeat` endpoint that refreshes `last_activity`, preventing the janitor's 5-minute inactivity auto-finalizer from firing. The timer tracks accumulated paused duration separately so elapsed time stays accurate across multiple pause/resume cycles. The waveform animation (`requestAnimationFrame` loop in `Record.tsx`) is cancelled on pause and restarted on resume.

**Tech Stack:** FastAPI (backend endpoint), React + TypeScript (hook + UI), MediaRecorder Web API (pause/resume)

> **Note on button placement:** The spec listed `RecordingStatus.tsx` as the home for the pause button, but `RecordingStatus` is a pure display component — action handlers live in `Record.tsx`. The button is placed in `Record.tsx` (consistent with the Stop button pattern). `RecordingStatus.tsx` only receives `isPaused` to render the timer indicator.

---

## File Map

| File | Change |
|---|---|
| `backend/app/main.py` | Add `POST /api/meetings/{mid}/heartbeat` endpoint |
| `frontend/src/hooks/useRecording.ts` | Add pause/resume functions, heartbeat, accurate timer, chunkTimerRef |
| `frontend/src/components/RecordingStatus.tsx` | Accept `isPaused` prop, show paused indicator on timer |
| `frontend/src/pages/Record.tsx` | Pause/Resume button; waveform freeze/resume on `isPaused` change |

---

### Task 1: Backend heartbeat endpoint

**Files:**
- Modify: `backend/app/main.py` (insert before the `regenerate` endpoint, around line 408)

The endpoint is dead simple — find meeting, touch `last_activity`, done. Follow the exact same pattern as `update_meeting_context` (line 365).

- [ ] **Step 1: Add the endpoint**

Find the `@app.post("/api/meetings/{mid}/regenerate"` block (around line 408). Insert **before** it:

```python
@app.post("/api/meetings/{mid}/heartbeat", status_code=200)
def heartbeat_meeting(mid: uuid.UUID):
    """Refreshes last_activity for a paused meeting to prevent janitor auto-finalization."""
    with Session(engine) as db:
        mtg = db.get(Meeting, mid)
        if not mtg:
            raise HTTPException(status_code=404, detail="Meeting not found")
        mtg.last_activity = dt.datetime.utcnow()
        db.add(mtg)
        db.commit()
    return {"ok": True}
```

- [ ] **Step 2: Manually verify endpoint works**

Start the backend (`uvicorn app.main:app --reload` from `backend/`) and run:
```bash
curl -X POST http://localhost:8000/api/meetings/00000000-0000-0000-0000-000000000000/heartbeat
```
Expected: `{"detail":"Meeting not found"}` with 404 — confirms the route is registered.

Create a real meeting via the UI, grab its UUID, and repeat. Expected: `{"ok":true}` with 200.

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: add heartbeat endpoint to keep paused meetings alive"
```

---

### Task 2: Hook — new refs and updated `createAndStartRecorder`

**Files:**
- Modify: `frontend/src/hooks/useRecording.ts`

This task adds the new refs and promotes the anonymous `setTimeout` to a stored ref — groundwork for pause/resume.

- [ ] **Step 1: Add new refs and state**

After the existing `isRecordingRef` + its `useEffect` (around line 72–75), add:

```typescript
const [isPaused, setIsPaused] = useState(false)
const isPausedRef = useRef(false)
// Note: isPausedRef is also set directly in pauseRecording/resumeRecording for synchronous access in callbacks.
// The useEffect keeps it in sync for any reads that happen after a re-render cycle.
useEffect(() => { isPausedRef.current = isPaused }, [isPaused])
const pausedDurationRef = useRef<number>(0)
const pausedAtRef = useRef<number | null>(null)
const chunkTimerRef = useRef<NodeJS.Timeout | null>(null)
const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)
```

- [ ] **Step 2: Reset new refs in `resetState`**

Inside `resetState()` (around line 93), after the existing resets, add:

```typescript
setIsPaused(false)
isPausedRef.current = false
pausedDurationRef.current = 0
pausedAtRef.current = null
if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current)
chunkTimerRef.current = null
if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current)
heartbeatIntervalRef.current = null
```

- [ ] **Step 3: Store chunk timer in `createAndStartRecorder`**

Inside `startLiveRecording`, the `createAndStartRecorder` inner function currently has an anonymous `setTimeout` (around line 331):

```typescript
// BEFORE:
setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop()
}, CHUNK_DURATION_MS)
```

Replace with:

```typescript
// AFTER:
chunkTimerRef.current = setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop()
}, CHUNK_DURATION_MS)
```

- [ ] **Step 4: Update cleanup `useEffect`**

The cleanup effect (around line 432) tears down intervals on unmount. Replace it with:

```typescript
useEffect(() => {
    return () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
        if (timerRef.current) clearInterval(timerRef.current)
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
        if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current)
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current)
        if (wakeLockSentinelRef.current) {
            wakeLockSentinelRef.current.release()
        }
    }
}, [])
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useRecording.ts
git commit -m "refactor: add pause refs and store chunk timer handle in useRecording"
```

---

### Task 3: Hook — `pauseRecording`, `resumeRecording`, and updated `stopRecording`

**Files:**
- Modify: `frontend/src/hooks/useRecording.ts`

- [ ] **Step 1: Add `pauseRecording`**

Add after `stopRecording` (around line 251):

```typescript
const pauseRecording = useCallback(() => {
    if (!isPausedRef.current && mediaRef.current && mediaRef.current.state === 'recording') {
        mediaRef.current.pause()
        setIsPaused(true)
        isPausedRef.current = true
        pausedAtRef.current = Date.now()
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
        if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current)
        chunkTimerRef.current = null
        // Heartbeat every 90s to keep last_activity fresh on the backend.
        // 90s interval gives a 1-missed-heartbeat buffer within the 5-min janitor threshold.
        heartbeatIntervalRef.current = setInterval(async () => {
            if (!meetingId.current) return
            try {
                await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId.current}/heartbeat`, { method: 'POST' })
            } catch {
                // Silently ignore — one missed heartbeat is within the safety margin
            }
        }, 90_000)
    }
}, [])
```

- [ ] **Step 2: Add `resumeRecording`**

Add immediately after `pauseRecording`:

```typescript
const resumeRecording = useCallback(() => {
    if (isPausedRef.current && mediaRef.current && mediaRef.current.state === 'paused') {
        mediaRef.current.resume()
        // Accumulate paused duration. Do NOT touch startTimeRef — it must remain
        // the original recording-start timestamp for the timer formula to work.
        if (pausedAtRef.current !== null) {
            pausedDurationRef.current += Date.now() - pausedAtRef.current
            pausedAtRef.current = null
        }
        setIsPaused(false)
        isPausedRef.current = false
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current)
            heartbeatIntervalRef.current = null
        }
        // Restart timer: elapsed = (now - recordingStart - totalPausedMs) / 1000
        timerRef.current = setInterval(() => {
            setRecordingTime(Math.floor((Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000))
        }, 1000)
        // Restart chunk rotation with a fresh 30s window
        chunkTimerRef.current = setTimeout(() => {
            if (mediaRef.current && mediaRef.current.state === 'recording') mediaRef.current.stop()
        }, CHUNK_DURATION_MS)
    }
}, [])
```

- [ ] **Step 3: Replace `stopRecording` to handle paused state and clear new refs**

The existing `stopRecording` (lines 213–251) only calls `.stop()` when `state === 'recording'`, which misses the `'paused'` state. Replace the entire function:

```typescript
const stopRecording = useCallback(
    async (isFinal: boolean = true) => {
        // Clear pause-related timers first
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current)
            heartbeatIntervalRef.current = null
        }
        if (chunkTimerRef.current) {
            clearTimeout(chunkTimerRef.current)
            chunkTimerRef.current = null
        }
        // Stop recorder regardless of whether it's recording or paused
        if (mediaRef.current && mediaRef.current.state !== 'inactive') {
            mediaRef.current.stop()
        }
        if (isFinal) {
            setIsPaused(false)
            isPausedRef.current = false
            pausedDurationRef.current = 0
            pausedAtRef.current = null
            setRecording(false)
            setIsProcessing(true)

            if (wakeLockSentinelRef.current) {
                await wakeLockSentinelRef.current.release()
                wakeLockSentinelRef.current = null
            }
            setWakeLockStatus('inactive')

            streamRef.current?.getTracks().forEach((track) => track.stop())
            displayStreamRef.current?.getTracks().forEach((track) => track.stop())
            micStreamRef.current?.getTracks().forEach((track) => track.stop())
            streamRef.current = null
            displayStreamRef.current = null
            micStreamRef.current = null

            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
            if (audioCtxRef.current) {
                await audioCtxRef.current.close()
                audioCtxRef.current = null
            }
            animationFrameRef.current = null
            analyserRef.current = null

            if (timerRef.current) {
                clearInterval(timerRef.current)
                timerRef.current = null
            }
            await new Promise((resolve) => setTimeout(resolve, 500))
            const finalBlob = new Blob([], { type: mediaRef.current?.mimeType || 'audio/webm' })
            await uploadChunk(finalBlob, chunkIndexRef.current, true)
        }
    },
    [uploadChunk],
)
```

- [ ] **Step 4: Update the timer in `startLiveRecording` to use the paused-duration formula**

Find the timer setup in `startLiveRecording` (around line 315):

```typescript
// BEFORE:
timerRef.current = setInterval(() => setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000)
```

Replace with:

```typescript
// AFTER:
timerRef.current = setInterval(() => {
    setRecordingTime(Math.floor((Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000))
}, 1000)
```

- [ ] **Step 5: Export the new values from the hook**

In the return object at the bottom of the hook (around line 444), add:

```typescript
isPaused,
pauseRecording,
resumeRecording,
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useRecording.ts
git commit -m "feat: implement pauseRecording and resumeRecording in useRecording hook"
```

---

### Task 4: UI — paused indicator in `RecordingStatus.tsx`

**Files:**
- Modify: `frontend/src/components/RecordingStatus.tsx`

`RecordingStatus` is a pure display component. Add `isPaused` to its props and update the timer display.

- [ ] **Step 1: Add `isPaused` to the props interface and destructuring**

In the `RecordingStatusProps` interface (around line 5), add:

```typescript
isPaused: boolean
```

Add `isPaused` to the destructured props in the component function signature.

- [ ] **Step 2: Update the timer display to show paused state**

The timer block (around line 62–66) currently is:

```tsx
{isRecording && (
    <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 'bold', color: theme.button.danger, marginBottom: '6px' }}>
        ⏱️ {formatTime(recordingTime)}
    </div>
)}
```

Replace with:

```tsx
{isRecording && (
    <div style={{
        textAlign: 'center',
        fontSize: '24px',
        fontWeight: 'bold',
        color: isPaused ? theme.secondaryText : theme.button.danger,
        marginBottom: '6px',
        opacity: isPaused ? 0.6 : 1,
    }}>
        {isPaused ? '⏸' : '⏱️'} {formatTime(recordingTime)}
        {isPaused && (
            <span style={{ fontSize: '13px', fontWeight: 'normal', marginLeft: '8px', letterSpacing: '0.05em' }}>
                PAUSED
            </span>
        )}
    </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/RecordingStatus.tsx
git commit -m "feat: show paused indicator on recording timer"
```

---

### Task 5: UI — pause/resume button and waveform freeze in `Record.tsx`

**Files:**
- Modify: `frontend/src/pages/Record.tsx`

- [ ] **Step 1: Destructure new values from the hook**

Find the `useRecording` destructuring (around line 25). Add to the list:

```typescript
isPaused,
pauseRecording,
resumeRecording,
```

- [ ] **Step 2: Add waveform freeze/resume effect**

The waveform animation is a `requestAnimationFrame` loop started by `drawWaveform()`. When paused, the underlying `MediaStream` still flows data to the analyser, so the canvas would keep animating. Cancel and restart based on `isPaused`. Add this `useEffect` after the existing effects (e.g., after the `isSystemAudioSupported` effect):

```typescript
useEffect(() => {
    if (isPaused) {
        // Cancel the animation loop and clear the canvas
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d')
            if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        }
    } else if (isRecording) {
        // Resume the animation loop
        drawWaveform()
    }
}, [isPaused, isRecording, drawWaveform, animationFrameRef])
```

- [ ] **Step 3: Pass `isPaused` to `RecordingStatus`**

Find the `<RecordingStatus` JSX (around line 258) and add the prop:

```tsx
<RecordingStatus
    {/* ...existing props... */}
    isPaused={isPaused}
/>
```

- [ ] **Step 4: Replace the Stop-button-only branch with Pause + Stop buttons**

Find this ternary branch in the JSX (around line 282–296) — the `else` branch that currently renders a single Stop button:

```tsx
) : (
    <button
        onClick={handleStop}
        style={{
            padding: '16px 32px',
            fontSize: '18px',
            fontWeight: 'bold',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            backgroundColor: currentThemeColors.button.danger,
            color: currentThemeColors.button.dangerText,
        }}>
        ⏹️ Stop & Summarize
    </button>
)}
```

Replace the **entire** `) : ( <button>...</button> )}` branch with:

```tsx
) : (
    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        {isRecording && (
            <button
                onClick={isPaused ? resumeRecording : pauseRecording}
                style={{
                    padding: '16px 24px',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: currentThemeColors.backgroundSecondary,
                    color: currentThemeColors.text,
                }}>
                {isPaused ? '▶️ Resume' : '⏸️ Pause'}
            </button>
        )}
        <button
            onClick={handleStop}
            style={{
                padding: '16px 32px',
                fontSize: '18px',
                fontWeight: 'bold',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                backgroundColor: currentThemeColors.button.danger,
                color: currentThemeColors.button.dangerText,
            }}>
            ⏹️ Stop & Summarize
        </button>
    </div>
)}
```

- [ ] **Step 5: Manual smoke test**

Start both backend and frontend (`npm run dev` from root). Then:

1. Click **Start Recording** — timer counts up, waveform animates
2. Click **Pause** — timer freezes with "⏸ PAUSED" label, waveform canvas clears, button shows "▶️ Resume"
3. Wait 10+ seconds — timer stays frozen; live transcript panel still updates as the server processes already-uploaded chunks
4. Click **Resume** — timer continues from where it froze (not wall-clock elapsed), waveform resumes, button shows "⏸️ Pause"
5. Pause and resume multiple times — timer accumulates correctly each time
6. Click **Stop & Summarize** — navigates to summary page, summary generated from all recorded audio
7. Repeat: Start → Pause → Stop immediately (paused state) — should still produce a summary

- [ ] **Step 6: Final commit**

```bash
git add frontend/src/pages/Record.tsx
git commit -m "feat: add pause/resume button and waveform freeze to recording UI"
```
