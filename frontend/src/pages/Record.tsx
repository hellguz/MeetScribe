// ./frontend/src/pages/Record.tsx
import React, { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getHistory, MeetingMeta, saveMeeting } from "../utils/history";

export default function Record() {
  const navigate = useNavigate();

  /* ─── history list ──────────────────────────────────────────────── */
  const [history, setHistory] = useState<MeetingMeta[]>([]);
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  /* ─── recording state ───────────────────────────────────────────── */
  const [isRecording, setRecording] = useState(false);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [uploadedChunks, setUploadedChunks] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");

  const meetingId = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const firstChunkRef = useRef<boolean>(true);

  /* ─── poll only for “done” and updated received_chunks ───────────── */
  useEffect(() => {
    if (!meetingId.current || !isProcessing) return;

    const poll = setInterval(async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId.current}`
        );
        if (!res.ok) return;
        const data = await res.json();

        if (typeof data.received_chunks === "number") {
          setUploadedChunks(data.received_chunks);
        }
        if (data.done) {
          clearInterval(poll);
          navigate(`/summary/${meetingId.current}`);
        }
      } catch {
        // ignore errors
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [isProcessing, navigate]);

  /* ─── timer effect ──────────────────────────────────────────────── */
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  /* ─── helpers ───────────────────────────────────────────────────── */
  const createMeeting = useCallback(async () => {
    const title = `Recording ${new Date().toLocaleString()}`;
    const res = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/api/meetings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }
    );
    if (!res.ok) throw new Error("Failed to create meeting");
    const data = await res.json();
    meetingId.current = data.id;

    saveMeeting({
      id: data.id,
      title,
      started_at: new Date().toISOString(),
      status: "pending",
    });
    setHistory(getHistory());
    return data.id;
  }, []);

  const uploadChunk = useCallback(
    async (blob: Blob, index: number, isFinal = false) => {
      if (!meetingId.current) return false;

      const fd = new FormData();
      fd.append("meeting_id", meetingId.current);
      fd.append("chunk_index", String(index));
      fd.append("file", blob, `chunk-${index}.webm`);
      fd.append("is_final", String(isFinal));

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE_URL}/api/chunks`,
          { method: "POST", body: fd }
        );
        const result = await response.json();

        if (result.ok && !result.skipped) {
          // Update upload progress
          if (typeof result.received_chunks === "number") {
            setUploadedChunks(result.received_chunks);
          }
          // Append live transcript chunk
          if (result.latest_chunk_text) {
            setLiveTranscript((prev) =>
              prev ? prev + " " + result.latest_chunk_text : result.latest_chunk_text
            );
          }
        }
        return result.ok;
      } catch (error) {
        console.error(`Failed to upload chunk ${index}:`, error);
        return false;
      }
    },
    []
  );

  /* ─── recording control ─────────────────────────────────────────── */
  function createAndStartRecorder(timeSliceMs: number) {
    if (!streamRef.current) return;

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: "audio/webm; codecs=opus",
      audioBitsPerSecond: 128000,
    });
    mediaRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        setChunks((prev) => {
          const newIndex = prev.length;
          const newChunks = [...prev, e.data];
          uploadChunk(e.data, newIndex).catch(console.error);
          return newChunks;
        });
      }

      // Once the first 1 s chunk arrives, switch to 20 s slices
      if (firstChunkRef.current) {
        firstChunkRef.current = false;
        recorder.stop();
        setTimeout(() => createAndStartRecorder(20000), 0);
      }
    };

    recorder.start(timeSliceMs);
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100,
        },
      });
      streamRef.current = stream;

      // Reset state
      setChunks([]);
      setUploadedChunks(0);
      setRecordingTime(0);
      setLiveTranscript("");
      firstChunkRef.current = true;
      startTimeRef.current = Date.now();

      await createMeeting();
      createAndStartRecorder(1000);
      setRecording(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      alert("Failed to start recording. Please check microphone permissions.");
    }
  }

  async function stop() {
    const recorder = mediaRef.current;
    const stream = streamRef.current;
    if (!recorder || !stream) return;

    setRecording(false);
    setIsProcessing(true);

    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());

    // Wait so the final ondataavailable fires
    await new Promise((r) => setTimeout(r, 1000));

    const finalBlob = new Blob([], { type: "audio/webm" });
    await uploadChunk(finalBlob, chunks.length, true);
  }

  /* ─── UI helpers ─────────────────────────────────────────────────── */
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  /* ─── styling snippets ───────────────────────────────────────────── */
  const buttonStyle = {
    padding: "16px 32px",
    fontSize: "18px",
    fontWeight: "bold",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.3s ease",
    minWidth: "140px",
  } as const;

  const startButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#22c55e",
    color: "white",
    boxShadow: "0 4px 6px rgba(34, 197, 94, 0.3)",
  };

  const stopButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#ef4444",
    color: "white",
    boxShadow: "0 4px 6px rgba(239, 68, 68, 0.3)",
  };

  const progressBarStyle = {
    width: "100%",
    height: "20px",
    backgroundColor: "#e5e7eb",
    borderRadius: "10px",
    overflow: "hidden",
    marginBottom: "16px",
  };

  const progressFillStyle = {
    height: "100%",
    backgroundColor: "#3b82f6",
    width: `${
      chunks.length === 0
        ? 0
        : Math.min(100, (uploadedChunks / chunks.length) * 100)
    }%`,
    transition: "width 0.3s ease",
    borderRadius: "10px",
  };

  /* ─── render ─────────────────────────────────────────────────────── */
  return (
    <div
      style={{
        padding: 24,
        maxWidth: 800,
        margin: "0 auto",
        fontFamily: '"Inter", sans-serif',
      }}
    >
      <h1 style={{ textAlign: "center", marginBottom: "24px" }}>
        🎙️ MeetScribe Recorder
      </h1>

      {/* Timer */}
      {isRecording && (
        <div
          style={{
            textAlign: "center",
            fontSize: "24px",
            fontWeight: "bold",
            color: "#ef4444",
            marginBottom: "16px",
          }}
        >
          ⏱️ {formatTime(recordingTime)}
        </div>
      )}

      {/* Upload Progress */}
      {chunks.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
              fontSize: "14px",
              color: "#6b7280",
            }}
          >
            <span>Upload Progress</span>
            <span>
              {uploadedChunks} / {chunks.length} chunks
            </span>
          </div>
          <div style={progressBarStyle}>
            <div style={progressFillStyle}></div>
          </div>
        </div>
      )}

      {/* Live Transcript */}
      {liveTranscript && (
        <div
          style={{
            marginBottom: "24px",
            padding: "16px",
            backgroundColor: "#f8fafc",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: "14px",
              fontWeight: "bold",
              color: "#374151",
              marginBottom: "8px",
            }}
          >
            🎤 Live Transcript:
          </div>
          <div
            style={{
              fontSize: "14px",
              lineHeight: "1.5",
              color: "#1f2937",
            }}
          >
            {liveTranscript}
          </div>
        </div>
      )}

      {/* Status card */}
      <div
        style={{
          textAlign: "center",
          marginBottom: "24px",
          padding: "16px",
          backgroundColor: isRecording
            ? "#fef3f2"
            : isProcessing
            ? "#fefbf2"
            : "#f0fdf4",
          borderRadius: "8px",
          border: `2px solid ${
            isRecording ? "#fecaca" : isProcessing ? "#fed7aa" : "#bbf7d0"
          }`,
        }}
      >
        <div
          style={{
            fontSize: "18px",
            fontWeight: "bold",
            color: isRecording
              ? "#dc2626"
              : isProcessing
              ? "#d97706"
              : "#16a34a",
            marginBottom: "8px",
          }}
        >
          {isRecording
            ? "🔴 Recording..."
            : isProcessing
            ? "⚙️ Processing..."
            : "⚪ Ready to Record"}
        </div>
        {chunks.length > 0 && (
          <div style={{ fontSize: "14px", color: "#6b7280" }}>
            Chunks recorded: {chunks.length} | Uploaded: {uploadedChunks}
          </div>
        )}
      </div>

      {/* Control button */}
      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        {!isRecording ? (
          <button
            onClick={start}
            disabled={isProcessing}
            style={{
              ...startButtonStyle,
              opacity: isProcessing ? 0.5 : 1,
              cursor: isProcessing ? "not-allowed" : "pointer",
            }}
            onMouseOver={(e) =>
              !isProcessing && (e.currentTarget.style.transform = "scale(1.05)")
            }
            onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            🎙️ Start Recording
          </button>
        ) : (
          <button
            onClick={stop}
            style={stopButtonStyle}
            onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
            onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            ⏹️ Stop & Summarize
          </button>
        )}
      </div>

      {/* Instructions */}
      <div
        style={{
          fontSize: "14px",
          color: "#6b7280",
          textAlign: "center",
          lineHeight: "1.5",
        }}
      >
        {!isRecording ? (
          <p>
            Click "Start Recording" to begin real-time transcription. You'll see
            text appear as you speak!
          </p>
        ) : (
          <p>
            Recording in progress... Watch the live transcript appear above as
            you speak. The very first chunk lasts 1 second (just for header),
            then each chunk is 20 seconds long.
          </p>
        )}
      </div>

      {/* History list */}
      {history.length > 0 && (
        <div style={{ marginBottom: "40px" }}>
          <h2 style={{ margin: "24px 0 12px 0", fontSize: 16 }}>
            Previous meetings
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {history.map((m) => (
              <li
                key={m.id}
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid #e5e7eb",
                  cursor: "pointer",
                }}
                onClick={() => navigate(`/summary/${m.id}`)}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>
                    {m.title}
                    {m.status === "pending" && (
                      <span
                        style={{ marginLeft: 8, color: "#6b7280", fontSize: 12 }}
                      >
                        (Pending...)
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontStyle: "italic",
                      color: "#6b7280",
                      fontSize: 14,
                    }}
                  >
                    {new Date(m.started_at).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
