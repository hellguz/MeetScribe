// ./frontend/src/pages/Record.tsx
import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
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
  const [localChunksCount, setLocalChunksCount] = useState(0); // includes header chunk
  const [uploadedChunks, setUploadedChunks] = useState(0); // counts only non-header chunks from backend
  const [expectedTotalChunks, setExpectedTotalChunks] = useState<number | null>(null); // counts only non-header
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [transcribedChunks, setTranscribedChunks] = useState(0);
  const [pollingStarted, setPollingStarted] = useState(false);

  // Track when the first chunk was transcribed (for speed calculation)
  const [transcriptionStartTime, setTranscriptionStartTime] = useState<number | null>(null);
  const [firstChunkProcessedTime, setFirstChunkProcessedTime] = useState<number | null>(null);
  const CHUNK_DURATION = 30; // seconds per non-header chunk

  const meetingId = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const firstChunkRef = useRef<boolean>(true);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const chunkIndexRef = useRef(0);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  /* ─── detect first transcribed chunk ───────────────────────────── */
  useEffect(() => {
    if (transcribedChunks === 1 && firstChunkProcessedTime === null) {
      setFirstChunkProcessedTime(Date.now());
    } else if (transcribedChunks > 1 && transcriptionStartTime === null && firstChunkProcessedTime !== null) {
      setTranscriptionStartTime(firstChunkProcessedTime);
    }
  }, [transcribedChunks, firstChunkProcessedTime, transcriptionStartTime, setFirstChunkProcessedTime, setTranscriptionStartTime]);

  /* ─── compute transcription speed ───────────────────────────────── */
  const transcriptionSpeed = useMemo(() => {
    if (transcriptionStartTime === null || transcribedChunks < 2) { // Ensures at least two chunks processed and startTime is set
      return null;
    }
    const elapsedSec = (Date.now() - transcriptionStartTime) / 1000;
    if (elapsedSec <= 0) {
      return null;
    }
    // Calculate audio processed since transcriptionStartTime was set (i.e., after the first chunk)
    const audioDurationProcessedSinceStartTime = (transcribedChunks - 1) * CHUNK_DURATION;
    return audioDurationProcessedSinceStartTime / elapsedSec;
  }, [transcriptionStartTime, transcribedChunks, CHUNK_DURATION]);

  const transcriptionSpeedLabel = useMemo(() => {
    if (transcriptionSpeed === null) return null;
    // Round to one decimal place
    const rounded = (Math.round(transcriptionSpeed * 10) / 10).toFixed(1);
    return `${rounded}x`;
  }, [transcriptionSpeed]);

  /* ─── polling for meeting status, transcript, summary ───────── */
  const pollMeetingStatus = useCallback(async () => {
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

      // backend now sends "received_chunks" = number of non-header chunks
      if (typeof data.received_chunks === "number") {
        setUploadedChunks(data.received_chunks);
      }
      if (data.expected_chunks !== null && typeof data.expected_chunks === "number") {
        setExpectedTotalChunks(data.expected_chunks);
      }

      // Update live transcript
      if (data.transcript_text && data.transcript_text !== liveTranscript) {
        setLiveTranscript(data.transcript_text);
      }

      // backend also sends how many non-header chunks are already transcribed
      if (typeof data.transcribed_chunks === "number") {
        setTranscribedChunks(data.transcribed_chunks);
      }

      if (data.done) {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setIsProcessing(false);
        navigate(`/summary/${meetingId.current}`);
      } else {
        if (!isRecording && meetingId.current) {
          setIsProcessing(true);
        }
      }
    } catch (error) {
      console.error("Polling error:", error);
    }
  }, [navigate, liveTranscript, isRecording]);

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
      body: JSON.stringify({ title }),
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
    if (!MediaRecorder.isTypeSupported(recorderOptions.mimeType ?? "")) {
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

      if (firstChunkRef.current) {
        firstChunkRef.current = false;
        if (recorder.state === "recording") {
          recorder.stop(); // Stop the short header recorder → triggers onstop
        }
      }
    };

    recorder.onstop = () => {
      if (
        !firstChunkRef.current &&
        isRecordingRef.current &&
        mediaRef.current?.stream.active
      ) {
        createAndStartRecorder(30000); // Restart with 30s chunks
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

      // Reset everything
      setLocalChunksCount(0);
      setUploadedChunks(0);
      setExpectedTotalChunks(null);
      setTranscribedChunks(0);
      setRecordingTime(0);
      setLiveTranscript("");
      setTranscriptionStartTime(null);
      setFirstChunkProcessedTime(null); // Reset for new recording
      firstChunkRef.current = true;
      chunkIndexRef.current = 0;
      setIsProcessing(false);
      meetingId.current = null;
      setPollingStarted(false);

      // IMPORTANT: set isRecording *before* calling createMeeting/recorder
      setRecording(true);

      startTimeRef.current = Date.now();
      const newId = await createMeetingOnBackend();

      // ─── START POLLING IMMEDIATELY ───────────────────────────
      meetingId.current = newId;
      await pollMeetingStatus(); // fetch right away
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      pollIntervalRef.current = setInterval(pollMeetingStatus, 3000);
      setPollingStarted(true);

      createAndStartRecorder(100); // Start with a 0.1s header chunk
    } catch (error) {
      console.error("Failed to start recording:", error);
      alert("Failed to start recording. Please check microphone permissions and console for errors.");
    }
  }

  async function stop() {
    if (!mediaRef.current || !streamRef.current || !meetingId.current) return;

    setRecording(false);
    setIsProcessing(true);

    if (mediaRef.current.state === "recording") {
      mediaRef.current.stop();
    }
    streamRef.current.getTracks().forEach((track) => track.stop());

    // Let the last “real” chunk flush
    await new Promise((resolve) => setTimeout(resolve, 500));

    const finalChunkIndex = localChunksCount;
    const finalBlob = new Blob([], { type: mediaRef.current.mimeType || "audio/webm" });
    await uploadChunk(finalBlob, finalChunkIndex, true);
  }

  /* ─── clean up polling on unmount ───────────────────────────────── */
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  /* ─── UI helpers ─────────────────────────────────────────────────── */
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Backend’s `uploadedChunks` is already “real” (non-header) count.
  // For local total, we subtract 1 to hide the header chunk.
  const realLocal = localChunksCount > 1 ? localChunksCount - 1 : 0;
  const realUploaded = uploadedChunks; // direct from backend
  const realTotal =
    expectedTotalChunks !== null ? expectedTotalChunks : realLocal;

  const getUploadProgressPercentage = () => {
    if (realTotal === 0) return 0;
    return Math.min(100, (realUploaded / realTotal) * 100);
  };
  const getTranscriptionProgressPercentage = () => {
    if (realTotal === 0) return 0;
    return Math.min(100, (transcribedChunks / realTotal) * 100);
  };

  const allChunksUploaded = realTotal > 0 && realUploaded >= realTotal;

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
    marginBottom: "8px",
    position: "relative",
  } as const;

  const progressFillStyle = (percent: number, color: string, zIndex: number) => ({
    height: "100%",
    backgroundColor: color,
    width: `${percent}%`,
    transition: "width 0.3s ease",
    borderRadius: "10px",
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: zIndex,
  } as const);

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

      {/* Upload/Transcription Progress */}
      {(isRecording || isProcessing || localChunksCount > 0) && (
        <div style={{ marginBottom: "24px" }}>
          <div style={progressBarStyle}>
            <div style={progressFillStyle(getUploadProgressPercentage(), "#93c5fd", 1)}></div>
            <div style={progressFillStyle(getTranscriptionProgressPercentage(), "#3b82f6", 2)}></div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "14px",
              color: "#6b7280",
            }}
          >
            <span>Uploaded: {realUploaded} / {realTotal}</span>
            <span>
              Transcribed: {transcribedChunks} / {realTotal}{" "}
              {transcriptionSpeedLabel && (
                <span style={{ fontSize: "12px", color: "#9ca3af" }}>
                  ({transcriptionSpeedLabel})
                </span>
              )}
            </span>
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
              !(isProcessing || isRecording) &&
              (e.currentTarget.style.transform = "scale(1.05)")
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
            Click “Start Recording” to begin. Your audio will be sent to the server in 30-second chunks for processing.
          </p>
        ) : isRecording ? (
          <p>
            Recording in progress… a live transcript will appear above as the AI processes your audio.
          </p>
        ) : allChunksUploaded ? (
          <p>
            ✅ All audio has been uploaded! It is now safe to close this window. <br/>
            The server is finishing the transcription and summary. You will be redirected automatically.
          </p>
        ) : (
          <p>
            Finalizing upload… Once all chunks are sent, you can safely close the window. <br/>
            You will be redirected to the summary page when it's ready.
          </p>
        )}
      </div>

      {/* History list */}
      {history.length > 0 && !isRecording && !isProcessing && (
        <div style={{ marginTop: "40px", marginBottom: "40px" }}>
          <h2
            style={{
              margin: "24px 0 12px 0",
              fontSize: 16,
              textAlign: "center",
            }}
          >
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
                  borderBottom:
                    index === history.length - 1 ? "none" : "1px solid #e5e7eb",
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
