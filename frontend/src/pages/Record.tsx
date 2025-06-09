import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getHistory, MeetingMeta, saveMeeting } from "../utils/history";

type AudioSource = "mic" | "system";

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
  const [audioSource, setAudioSource] = useState<AudioSource>("mic");
  const [isSystemAudioSupported, setIsSystemAudioSupported] = useState(true);

  /* ─── waveform metering ─────────────────────────────────────────── */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  /* ─── resize canvas on mount & window resize ──────────────────── */
  useEffect(() => {
    const resize = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = c.clientWidth;
      c.height = c.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); };
  }, []);

  /* ─── draw waveform loop ───────────────────────────────────────── */
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(239,68,68,0.3)"; // light red
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    const centerY = canvas.height / 2;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const deviation = (v - 1) * centerY * 4; // 4× vertical amplification
      const y = centerY + deviation;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(canvas.width, centerY);
    ctx.stroke();

    animationFrameRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  // Track when the first chunk was transcribed (for speed calculation)
  const [transcriptionStartTime, setTranscriptionStartTime] = useState<number | null>(null);
  const [firstChunkProcessedTime, setFirstChunkProcessedTime] = useState<number | null>(null);
  const CHUNK_DURATION = 30; // seconds per non-header chunk

  const meetingId = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null); // Will hold the stream for the recorder (can be audio-only)
  const displayStreamRef = useRef<MediaStream | null>(null); // Will hold the original getDisplayMedia stream
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const firstChunkRef = useRef<boolean>(true);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const chunkIndexRef = useRef(0);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      setIsSystemAudioSupported(false);
      return;
    }
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    if (isIOS) {
      setIsSystemAudioSupported(false);
    }
  }, []);

  /* ─── detect first transcribed chunk ───────────────────────────── */
  useEffect(() => {
    if (transcribedChunks === 1 && firstChunkProcessedTime === null) {
      setFirstChunkProcessedTime(Date.now());
    } else if (
      transcribedChunks > 1 &&
      transcriptionStartTime === null &&
      firstChunkProcessedTime !== null
    ) {
      setTranscriptionStartTime(firstChunkProcessedTime);
    }
  }, [transcribedChunks, firstChunkProcessedTime, transcriptionStartTime]);

  /* ─── compute transcription speed ───────────────────────────────── */
  const transcriptionSpeed = useMemo(() => {
    if (transcriptionStartTime === null || transcribedChunks < 2) return null;
    const elapsedSec = (Date.now() - transcriptionStartTime) / 1000;
    if (elapsedSec <= 0) return null;
    const audioDurationProcessedSinceStartTime = (transcribedChunks - 1) * CHUNK_DURATION;
    return audioDurationProcessedSinceStartTime / elapsedSec;
  }, [transcriptionStartTime, transcribedChunks]);

  const transcriptionSpeedLabel = useMemo(() => {
    if (transcriptionSpeed === null) return null;
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

      if (typeof data.received_chunks === "number") {
        setUploadedChunks(data.received_chunks);
      }
      if (data.expected_chunks !== null && typeof data.expected_chunks === "number") {
        setExpectedTotalChunks(data.expected_chunks);
      }
      if (data.transcript_text && data.transcript_text !== liveTranscript) {
        setLiveTranscript(data.transcript_text);
      }
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
      audioBitsPerSecond: 192000,
    };
    if (!MediaRecorder.isTypeSupported(recorderOptions.mimeType ?? "")) {
      console.warn(`${recorderOptions.mimeType} is not supported, trying default.`);
      try {
        const tempRec = new MediaRecorder(streamRef.current!);
        recorderOptions.mimeType = tempRec.mimeType;
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
        uploadChunk(e.data, chunkIndexRef.current++).catch(console.error);
        setLocalChunksCount((prev) => prev + 1);
      }
      if (firstChunkRef.current) {
        firstChunkRef.current = false;
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }
    };

    recorder.onstop = () => {
      if (isRecordingRef.current && mediaRef.current?.stream.active) {
        createAndStartRecorder(30000);
      }
    };

    recorder.start(timeSliceMs);
  }

  function clearWaveformCanvas() {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  async function start() {
    let audioStream: MediaStream;
    try {
      if (audioSource === "system") {
        if (!isSystemAudioSupported) {
          alert("System audio recording is not supported on your device or browser.");
          return;
        }
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
        });
        displayStreamRef.current = displayStream;

        if (displayStream.getAudioTracks().length === 0) {
          displayStream.getTracks().forEach((track) => track.stop());
          displayStreamRef.current = null;
          alert(
            "System audio access was not granted. Please check the 'Share system audio' or 'Share tab audio' box in the prompt and try again."
          );
          return;
        }

        displayStream.getVideoTracks()[0].addEventListener("ended", () => {
          if (isRecordingRef.current) stop();
        });

        // **THE FIX**: Create a new stream with only the audio tracks for the recorder.
        audioStream = new MediaStream(displayStream.getAudioTracks());
      } else {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
        });
      }

      // ─── setup audio context & analyser for waveform ─────────────
      audioCtxRef.current = new AudioContext();
      const sourceNode = audioCtxRef.current.createMediaStreamSource(audioStream);
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      sourceNode.connect(analyserRef.current);

      streamRef.current = audioStream;

      setLocalChunksCount(0);
      setUploadedChunks(0);
      setExpectedTotalChunks(null);
      setTranscribedChunks(0);
      setRecordingTime(0);
      setLiveTranscript("");
      setTranscriptionStartTime(null);
      setFirstChunkProcessedTime(null);
      firstChunkRef.current = true;
      chunkIndexRef.current = 0;
      setIsProcessing(false);
      meetingId.current = null;
      setPollingStarted(false);

      setRecording(true);
      startTimeRef.current = Date.now();
      const newId = await createMeetingOnBackend();
      meetingId.current = newId;

      await pollMeetingStatus();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(pollMeetingStatus, 3000);
      setPollingStarted(true);

      // ─── start drawing waveform & recording ───────────────────────
      drawWaveform();
      createAndStartRecorder(500);
    } catch (error) {
      console.error("Failed to start recording:", error);
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        alert("Recording permission was denied. Please allow access and try again.");
      } else {
        alert("Failed to start recording. Please check the console for errors.");
      }
      setRecording(false);
    }
  }

  async function stop() {
    if (!mediaRef.current || !meetingId.current) return;
    setRecording(false);
    setIsProcessing(true);

    if (mediaRef.current.state === "recording") {
      mediaRef.current.stop();
    }
    // Stop the recorder's stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    // Also stop the original display stream tracks (video)
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => track.stop());
      displayStreamRef.current = null;
    }

    // ─── teardown waveform ────────────────────────────────────────
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioCtxRef.current) {
      await audioCtxRef.current.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
    }

    clearWaveformCanvas(); // <-- Add this line

    await new Promise((resolve) => setTimeout(resolve, 500));
    const finalBlob = new Blob([], { type: mediaRef.current.mimeType || "audio/webm" });
    await uploadChunk(finalBlob, chunkIndexRef.current, true);
  }



  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const realLocal = localChunksCount > 1 ? localChunksCount - 1 : 0;
  const realUploaded = uploadedChunks;
  const realTotal = expectedTotalChunks !== null ? expectedTotalChunks : realLocal;

  const getUploadProgressPercentage = () => (realTotal === 0 ? 0 : Math.min(100, (realUploaded / realTotal) * 100));
  const getTranscriptionProgressPercentage = () => (realTotal === 0 ? 0 : Math.min(100, (transcribedChunks / realTotal) * 100));
  const allChunksUploaded = realTotal > 0 && realUploaded >= realTotal;

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto", fontFamily: '"Inter", sans-serif' }}>
      <h1 style={{ textAlign: "center", marginBottom: "24px" }}>🎙️ MeetScribe Recorder</h1>

      {!isRecording && !isProcessing && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{ textAlign: "center", marginBottom: "16px" }}>
            <label htmlFor="audio-source-select" style={{ marginRight: "10px", fontWeight: 500, color: "#374151" }}>
              Audio Source:
            </label>
            <select
              id="audio-source-select"
              value={audioSource}
              onChange={(e) => setAudioSource(e.target.value as AudioSource)}
              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "16px" }}
            >
              <option value="mic">Microphone</option>
              <option value="system">System Audio (Speakers)</option>
            </select>
          </div>
          {audioSource === "system" && !isSystemAudioSupported && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#fffbeb",
                border: "1px solid #fde68a",
                color: "#b45309",
                borderRadius: "8px",
                textAlign: "center"
              }}
            >
              ⚠️ System audio recording is not supported on your device or browser (e.g., iPhones/iPads). This option is unlikely to work.
            </div>
          )}
          {audioSource === "system" && isSystemAudioSupported && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#eff6ff",
                border: "1px solid #93c5fd",
                color: "#1e40af",
                borderRadius: "8px",
                textAlign: "center",
                fontSize: "14px",
                lineHeight: 1.5
              }}
            >
              ℹ️ When prompted, choose a screen, window, or tab to share. <br />
              <b>Crucially, ensure you check the "Share system audio" or "Share tab audio" box</b> to record sound.
            </div>
          )}
        </div>
      )}

      {isRecording && (
        <div style={{ textAlign: "center", fontSize: "24px", fontWeight: "bold", color: "#ef4444", marginBottom: "16px" }}>
          ⏱️ {formatTime(recordingTime)}
        </div>
      )}

      {(isRecording || isProcessing || localChunksCount > 0) && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{
            width: "100%",
            height: "20px",
            backgroundColor: "#e5e7eb",
            borderRadius: "10px",
            overflow: "hidden",
            position: "relative",
            marginBottom: "8px"
          }}>
            <div style={{
              height: "100%",
              width: `${getUploadProgressPercentage()}%`,
              backgroundColor: "#bdbdbd", // light gray
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: 1,
              transition: "width 0.3s"
            }} />
            <div style={{
              height: "100%",
              width: `${getTranscriptionProgressPercentage()}%`,
              backgroundColor: "#424242", // dark gray
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: 2,
              transition: "width 0.3s"
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", color: "#6b7280" }}>
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

      {liveTranscript && (
        <div style={{
          marginBottom: "24px",
          padding: "16px",
          backgroundColor: "#f8fafc",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
          maxHeight: "200px",
          overflowY: "auto"
        }}>
          <div style={{ fontSize: "14px", fontWeight: "bold", color: "#374151", marginBottom: "8px" }}>
            🎤 Live Transcript:
          </div>
          <div style={{ fontSize: "14px", lineHeight: "1.5", color: "#1f2937" }}>
            {liveTranscript}
          </div>
        </div>
      )}

      <div style={{
        position: "relative",
        textAlign: "center",
        marginBottom: "24px",
        padding: "16px",
        backgroundColor: isRecording ? "#fef3f2" : isProcessing ? "#fefbf2" : "#f0fdf4",
        borderRadius: "8px",
        border: `2px solid ${isRecording ? "#fecaca" : isProcessing ? "#fed7aa" : "#bbf7d0"}`,
        overflow: "hidden"
      }}>
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
            pointerEvents: "none"
          }}
        />
        <div style={{
          position: "relative",
          zIndex: 1,
          fontSize: "18px",
          fontWeight: "bold",
          color: isRecording ? "#dc2626" : isProcessing ? "#d97706" : "#16a34a",
          marginBottom: "8px"
        }}>
          {isRecording
            ? "🔴 Recording..."
            : isProcessing
              ? "⚙️ Processing... Please wait."
              : "⚪ Ready to Record"}
        </div>
      </div>

      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        {!isRecording ? (
          <button
            onClick={start}
            disabled={isProcessing || isRecording}
            style={{
              padding: "16px 32px",
              fontSize: "18px",
              fontWeight: "bold",
              border: "none",
              borderRadius: "8px",
              cursor: isProcessing || isRecording ? "not-allowed" : "pointer",
              transition: "all 0.3s ease",
              minWidth: "140px",
              backgroundColor: "#22c55e",
              color: "white",
              boxShadow: "0 4px 6px rgba(34, 197, 94, 0.3)",
              opacity: isProcessing || isRecording ? 0.5 : 1
            }}
            onMouseOver={(e) => !(isProcessing || isRecording) && (e.currentTarget.style.transform = "scale(1.05)")}
            onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            🎙️ Start Recording
          </button>
        ) : (
          <button
            onClick={stop}
            style={{
              padding: "16px 32px",
              fontSize: "18px",
              fontWeight: "bold",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "all 0.3s ease",
              minWidth: "140px",
              backgroundColor: "#ef4444",
              color: "white",
              boxShadow: "0 4px 6px rgba(239, 68, 68, 0.3)"
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
            onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            ⏹️ Stop & Summarize
          </button>
        )}
      </div>

      <div style={{ fontSize: "14px", color: "#6b7280", textAlign: "center", lineHeight: "1.5" }}>
        {!isRecording && !isProcessing ? (
          <p>Choose your audio source and click “Start Recording” to begin.</p>
        ) : isRecording ? (
          <p>Recording in progress… a live transcript will appear above as the AI processes your audio.</p>
        ) : allChunksUploaded ? (
          <p>
            ✅ All audio has been uploaded! It is now safe to close this window. <br />
            The server is finishing the transcription and summary. You will be redirected automatically.
          </p>
        ) : (
          <p>
            Finalizing upload… Once all chunks are sent, you can safely close the window. <br />
            You will be redirected to the summary page when it's ready.
          </p>
        )}
      </div>

      {history.length > 0 && !isRecording && !isProcessing && (
        <div style={{ marginTop: "40px", marginBottom: "40px" }}>
          <h2 style={{ margin: "24px 0 12px 0", fontSize: 16, textAlign: "center" }}>Previous Meetings</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            {history.map((m, index) => (
              <li
                key={m.id}
                style={{
                  padding: "12px 16px",
                  borderBottom: index === history.length - 1 ? "none" : "1px solid #e5e7eb",
                  cursor: "pointer",
                  backgroundColor: index % 2 === 0 ? "#f9fafb" : "white"
                }}
                onClick={() => navigate(`/summary/${m.id}`)}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eff6ff")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = index % 2 === 0 ? "#f9fafb" : "white")}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
                          fontWeight: "500"
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
                          fontWeight: "500"
                        }}
                      >
                        Complete
                      </span>
                    )}
                    <span style={{ fontStyle: "italic", color: "#6b7280", fontSize: 14 }}>
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
