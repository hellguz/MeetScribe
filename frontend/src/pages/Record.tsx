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
  const [localChunksCount, setLocalChunksCount] = useState(0); // Number of chunks sent by client
  const [uploadedChunks, setUploadedChunks] = useState(0); // Number of chunks confirmed received by backend
  const [expectedTotalChunks, setExpectedTotalChunks] = useState<number | null>(null); // From backend if final sent
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false); // True after stop, until summary is ready
  const [liveTranscript, setLiveTranscript] = useState("");

  const meetingId = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const firstChunkRef = useRef<boolean>(true);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Keep a ref for chunk index so it persists across recorder instances
  const chunkIndexRef = useRef(0);

  // Mirror isRecording into a ref to avoid stale closures
  const isRecordingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  /* ─── polling for meeting status, transcript, and summary ───────── */
  const pollMeetingStatus = useCallback(
    async () => {
      if (!meetingId.current) return;

      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId.current}`
        );
        if (!res.ok) {
          console.warn("Polling: Failed to fetch meeting status");
          return;
        }
        const data = await res.json();

        if (typeof data.received_chunks === "number") {
          setUploadedChunks(data.received_chunks);
        }
        if (data.expected_chunks !== null && typeof data.expected_chunks === "number") {
          setExpectedTotalChunks(data.expected_chunks);
        }

        if (data.transcript_text && data.transcript_text !== liveTranscript) {
          setLiveTranscript(data.transcript_text);
        }

        if (data.done) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setIsProcessing(false); // Stop showing "Processing..." on record page
          navigate(`/summary/${meetingId.current}`);
        } else {
          // If not done, but recording stopped, then we are processing
          if (!isRecording && meetingId.current) {
            setIsProcessing(true);
          }
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    },
    [navigate, liveTranscript, isRecording]
  );

  useEffect(() => {
    if (meetingId.current && (isRecording || isProcessing)) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(pollMeetingStatus, 3000);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isRecording, isProcessing, pollMeetingStatus]);

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
  const createMeetingOnBackend = useCallback(async () => {
    const title = `Recording ${new Date().toLocaleString()}`;
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }), // expected_chunks can be null initially
    });
    if (!res.ok) throw new Error("Failed to create meeting on backend");
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
      if (!meetingId.current) {
        console.error("No meeting ID, cannot upload chunk");
        return false;
      }

      const fd = new FormData();
      fd.append("meeting_id", meetingId.current);
      fd.append("chunk_index", String(index));
      fd.append("file", blob, `chunk-${index}.webm`);
      fd.append("is_final", String(isFinal));

      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/chunks`, {
          method: "POST",
          body: fd,
        });
        const result = await response.json();

        if (result.ok) {
          if (typeof result.received_chunks === "number") {
            setUploadedChunks(result.received_chunks);
          }
          if (result.expected_chunks !== null && typeof result.expected_chunks === "number") {
            setExpectedTotalChunks(result.expected_chunks);
          }
          // No live transcript text in immediate response anymore
        } else {
          console.error(`Failed to upload chunk ${index}:`, result.detail || "Unknown error");
        }
        return result.ok;
      } catch (error) {
        console.error(`Network or other error uploading chunk ${index}:`, error);
        return false;
      }
    },
    []
  );

  /* ─── recording control ─────────────────────────────────────────── */
  function createAndStartRecorder(timeSliceMs: number) {
    if (!streamRef.current) return;

    const recorderOptions: MediaRecorderOptions = {
      mimeType: "audio/webm; codecs=opus",
      audioBitsPerSecond: 128000,
    };
    // Check if mimeType is supported
    if (!MediaRecorder.isTypeSupported(recorderOptions.mimeType)) {
      console.warn(`${recorderOptions.mimeType} is not supported, trying default.`);
      try {
        const tempRec = new MediaRecorder(streamRef.current!);
        recorderOptions.mimeType = tempRec.mimeType;
        console.log("Using mimeType: ", recorderOptions.mimeType);
      } catch (e) {
        alert("MediaRecorder is not supported with any available audio format. Cannot record.");
        console.error("MediaRecorder init failed:", e);
        return;
      }
    }

    const recorder = new MediaRecorder(streamRef.current, recorderOptions);
    mediaRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        const idx = chunkIndexRef.current;
        setLocalChunksCount((prev) => prev + 1);
        uploadChunk(e.data, idx).catch(console.error);
        chunkIndexRef.current += 1;
      }

      // Only gate on firstChunkRef, not on isRecording directly
      if (firstChunkRef.current) {
        firstChunkRef.current = false;
        if (recorder.state === "recording") {
          recorder.stop(); // Stop the 1s recorder → triggers onstop
        }
      }
    };

    recorder.onstop = () => {
      // If this was the first short chunk, and we are still meant to be recording, start the longer slicer
      if (
        !firstChunkRef.current &&
        isRecordingRef.current &&
        mediaRef.current?.stream.active
      ) {
        createAndStartRecorder(20000); // Restart with 20s timeSlice
      }
    };

    recorder.start(timeSliceMs);
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Reset state
      setLocalChunksCount(0);
      setUploadedChunks(0);
      setExpectedTotalChunks(null);
      setRecordingTime(0);
      setLiveTranscript("");
      firstChunkRef.current = true;      // For 1s first chunk logic
      chunkIndexRef.current = 0;         // Reset chunk counter on each new start
      setIsProcessing(false);            // Not processing yet
      meetingId.current = null;          // Clear previous meeting ID

      startTimeRef.current = Date.now();

      await createMeetingOnBackend();    // Create meeting record on backend, get ID
      createAndStartRecorder(1000);      // Start with a 1-second chunk for header
      setRecording(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      alert("Failed to start recording. Please check microphone permissions and console for errors.");
    }
  }

  async function stop() {
    if (!mediaRef.current || !streamRef.current || !meetingId.current) return;

    setRecording(false); // Stop UI updates related to active recording
    setIsProcessing(true); // Now we are processing the finalization

    // Stop the recorder. This will trigger its 'onstop' and 'ondataavailable' for the last chunk.
    if (mediaRef.current.state === "recording") {
      mediaRef.current.stop();
    }
    // Stop all media tracks
    streamRef.current.getTracks().forEach((track) => track.stop());

    // Send a final "empty" chunk to signal end of stream to backend
    await new Promise((resolve) => setTimeout(resolve, 500)); // Wait a moment for the last real data chunk

    // The number of local chunks sent (localChunksCount) is the index for the next chunk
    const finalChunkIndex = localChunksCount;
    const finalBlob = new Blob([], { type: mediaRef.current.mimeType || "audio/webm" });
    await uploadChunk(finalBlob, finalChunkIndex, true);

    // Polling will detect final_received and eventually navigate to summary
  }

  /* ─── UI helpers ─────────────────────────────────────────────────── */
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getProgressPercentage = () => {
    if (expectedTotalChunks === null && localChunksCount === 0) return 0;
    const total = expectedTotalChunks ?? (localChunksCount > 0 ? localChunksCount : 1);
    if (total === 0) return 0;
    return Math.min(100, (uploadedChunks / total) * 100);
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
    width: `${getProgressPercentage()}%`,
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
      {(isRecording || isProcessing || localChunksCount > 0) && (
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
              {uploadedChunks} / {expectedTotalChunks ?? localChunksCount}{" "}
              chunks uploaded
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
            {liveTranscript || "Transcript will appear here as it's processed..."}
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
            ? "⚙️ Processing... Please wait."
            : "⚪ Ready to Record"}
        </div>
      </div>

      {/* Control button */}
      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        {!isRecording ? (
          <button
            onClick={start}
            disabled={isProcessing || isRecording}
            style={{
              ...startButtonStyle,
              opacity: isProcessing || isRecording ? 0.5 : 1,
              cursor: isProcessing || isRecording ? "not-allowed" : "pointer",
            }}
            onMouseOver={(e) =>
              ! (isProcessing || isRecording) && (e.currentTarget.style.transform = "scale(1.05)")
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
        {!isRecording && !isProcessing ? (
          <p>
            Click "Start Recording" to begin. The first audio chunk is 1 second
            (for WebM header compatibility), subsequent chunks are 20 seconds.
            Live transcript will appear as audio is processed by the backend.
          </p>
        ) : isRecording ? (
          <p>
            Recording in progress... Watch the live transcript (if available)
            update above.
          </p>
        ) : (
          <p>
            Finalizing recording and generating summary. You will be redirected
            shortly.
          </p>
        )}
      </div>

      {/* History list */}
      {history.length > 0 && !isRecording && !isProcessing && (
        <div style={{ marginTop: "40px", marginBottom: "40px" }}>
          <h2 style={{ margin: "24px 0 12px 0", fontSize: 16, textAlign: "center" }}>
            Previous Meetings
          </h2>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
            }}
          >
            {history.map((m, index) => (
              <li
                key={m.id}
                style={{
                  padding: "12px 16px",
                  borderBottom: index === history.length - 1 ? "none" : "1px solid #e5e7eb",
                  cursor: "pointer",
                  backgroundColor: index % 2 === 0 ? "#f9fafb" : "white",
                }}
                onClick={() => navigate(`/summary/${m.id}`)}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eff6ff")}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    index % 2 === 0 ? "#f9fafb" : "white")
                }
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 500, color: "#1f2937" }}>{m.title}</span>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    {m.status === "pending" && (
                      <span
                        style={{
                          marginRight: 8,
                          color: "#fbbf24",
                          backgroundColor: "#fffbeb",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: 12,
                          fontWeight: "500",
                        }}
                      >
                        Pending
                      </span>
                    )}
                    {m.status === "complete" && (
                      <span
                        style={{
                          marginRight: 8,
                          color: "#34d399",
                          backgroundColor: "#ecfdf5",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: 12,
                          fontWeight: "500",
                        }}
                      >
                        Complete
                      </span>
                    )}
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
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
