import React, { useRef, useState } from "react";

export default function Record() {
  const [isRecording, setRecording] = useState(false);
  const [chunks, setChunks] = useState<Blob[]>([]);

  const meetingId = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);

  /* ───────────── helpers ─────────────────────────────────────────────── */

  async function createMeeting() {
    const res = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }), // no expected_chunks yet
    });
    if (!res.ok) throw new Error("failed to create meeting");
    const data = await res.json();
    meetingId.current = data.id;
  }

  async function uploadAllChunks() {
    if (!meetingId.current) return;
    for (const [idx, blob] of chunks.entries()) {
      const fd = new FormData();
      fd.append("meeting_id", meetingId.current);
      fd.append("chunk_id", String(idx));
      fd.append("file", blob, `chunk-${idx}.webm`);
      await fetch("/api/chunks", { method: "POST", body: fd });
    }
  }

  /* ───────────── recording control ───────────────────────────────────── */

  async function start() {
    await createMeeting();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data.size) setChunks((prev) => [...prev, e.data]);
    };

    rec.start(30_000); // slice every 30 s
    setRecording(true);
  }

  async function stop() {
    const rec = mediaRef.current;
    if (!rec) return;

    /* Ask MediaRecorder to flush the partial chunk that’s <30 s long. */
    rec.requestData();

    /* Wait one tick for ondataavailable to fire before we proceed. */
    await new Promise((r) => setTimeout(r, 100));

    rec.stop();
    setRecording(false);

    await uploadAllChunks();
    window.location.href = `/summary/${meetingId.current}`;
  }

  /* ───────────── UI ──────────────────────────────────────────────────── */

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
