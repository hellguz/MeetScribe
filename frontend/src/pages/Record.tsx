import React, { useRef, useState } from "react";

/**
 * Simple recorder page:
 *  – records mic in 30 000 ms chunks
 *  – flushes the final <30 s fragment on stop()
 *  – uploads sequentially to the backend
 */
export default function Record() {
  const [isRecording, setRecording] = useState(false);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const meetingId = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data.size) setChunks((prev) => [...prev, e.data]);
    };
    rec.start(30_000);
    setRecording(true);

    // create meeting on backend
    const res = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled", expected_chunks: null }),
    });
    const data = await res.json();
    meetingId.current = data.id;
  }

  async function stop() {
    const rec = mediaRef.current;
    if (!rec) return;

    // wait until final <30 s slice is emitted
    const stopped = new Promise<void>((resolve) =>
      rec.addEventListener("stop", () => resolve())
    );
    rec.stop();
    await stopped;
    setRecording(false);

    if (!meetingId.current) return;

    // upload chunks sequentially
    for (const [idx, blob] of chunks.entries()) {
      const fd = new FormData();
      fd.append("meeting_id", meetingId.current);
      fd.append("chunk_id", String(idx));
      fd.append("file", blob, `chunk-${idx}.webm`);
      await fetch("/api/chunks", { method: "POST", body: fd });
    }

    window.location.href = `/summary/${meetingId.current}`;
  }

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: "0 auto" }}>
      <h1>MeetScribe Recorder</h1>

      {!isRecording ? (
        <button onClick={start}>Start</button>
      ) : (
        <button onClick={stop}>Stop</button>
      )}

      <p>Recorded chunks: {chunks.length}</p>
    </div>
  );
}
