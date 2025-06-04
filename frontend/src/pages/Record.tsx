import React, { useRef, useState, useEffect } from "react";

export default function Record() {
  const [isRecording, setRecording] = useState(false);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [uploadedChunks, setUploadedChunks] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [chunkTexts, setChunkTexts] = useState<string[]>([]);

  const meetingId = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Update timer every second while recording
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingTime(elapsed);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  /* ───────────── helpers ─────────────────────────────────────────────── */

  async function createMeeting() {
    const res = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        title: `Recording ${new Date().toLocaleString()}`
      }),
    });
    if (!res.ok) throw new Error("failed to create meeting");
    const data = await res.json();
    meetingId.current = data.id;
    return data.id;
  }

  async function uploadChunk(blob: Blob, index: number, isFinal: boolean = false) {
    if (!meetingId.current) return false;
    
    const fd = new FormData();
    fd.append("meeting_id", meetingId.current);
    fd.append("chunk_index", String(index));
    fd.append("file", blob, `chunk-${index}.webm`);
    fd.append("is_final", String(isFinal));
    
    try {
      console.log(`Uploading chunk ${index}, size: ${blob.size} bytes, final: ${isFinal}`);
      const response = await fetch("/api/chunks", { method: "POST", body: fd });
      const result = await response.json();
      
      if (result.ok && !result.skipped) {
        setUploadedChunks(prev => Math.max(prev, result.received_chunks));
        
        // Update live transcript with new chunk text
        if (result.latest_chunk_text && result.latest_chunk_text.trim()) {
          const newText = result.latest_chunk_text.trim();
          setChunkTexts(prev => {
            const updated = [...prev];
            updated[index] = newText;
            return updated;
          });
          
          // Update live transcript
          setLiveTranscript(prev => {
            if (prev) {
              return prev + " " + newText;
            } else {
              return newText;
            }
          });
        }
      }
      
      return result.ok;
    } catch (error) {
      console.error(`Failed to upload chunk ${index}:`, error);
      return false;
    }
  }

  /* ───────────── recording control ───────────────────────────────────── */

  async function start() {
    try {
      // Get media stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        }
      });
      streamRef.current = stream;

      // Reset state
      setChunks([]);
      setUploadedChunks(0);
      setRecordingTime(0);
      setLiveTranscript("");
      setChunkTexts([]);
      startTimeRef.current = Date.now();

      // Create meeting first
      await createMeeting();

      // Create MediaRecorder
      const recorder = new MediaRecorder(stream, { 
        mimeType: "audio/webm; codecs=opus",
        audioBitsPerSecond: 128000
      });
      
      mediaRef.current = recorder;

      // Set up event handlers
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          console.log(`Received chunk with size: ${e.data.size} bytes`);
          setChunks(prev => {
            const newChunks = [...prev, e.data];
            // Upload immediately for real-time transcription
            uploadChunk(e.data, prev.length, false).catch(console.error);
            return newChunks;
          });
        }
      };

      recorder.onerror = (e) => {
        console.error("MediaRecorder error:", e);
      };

      // Start recording with 30-second slices
      recorder.start(30000);
      setRecording(true);
      
      console.log("Recording started successfully");
      
    } catch (error) {
      console.error("Failed to start recording:", error);
      alert("Failed to start recording. Please check microphone permissions.");
    }
  }

  async function stop() {
    const recorder = mediaRef.current;
    const stream = streamRef.current;
    
    if (!recorder || !stream) return;

    console.log("Stopping recording...");
    setIsProcessing(true);

    // Stop the recorder and get final chunk
    recorder.stop();
    
    // Stop all tracks
    stream.getTracks().forEach(track => track.stop());
    
    // Wait a moment for final chunk processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send final signal
    if (chunks.length > 0) {
      console.log(`Finalizing recording with ${chunks.length} chunks`);
      const finalBlob = new Blob([], { type: "audio/webm" });
      await uploadChunk(finalBlob, chunks.length, true);
    }

    setRecording(false);
    
    // Navigate to summary
    setTimeout(() => {
      window.location.href = `/summary/${meetingId.current}`;
    }, 2000);
  }

  /* ───────────── UI helpers ─────────────────────────────────────────── */

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgressPercentage = () => {
    if (chunks.length === 0) return 0;
    return Math.min(100, (uploadedChunks / chunks.length) * 100);
  };

  /* ───────────── UI ──────────────────────────────────────────────────── */

  const buttonStyle = {
    padding: "16px 32px",
    fontSize: "18px",
    fontWeight: "bold",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.3s ease",
    minWidth: "140px",
  };

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

  return (
    <div style={{ 
      padding: 24, 
      maxWidth: 800, 
      margin: "0 auto",
      fontFamily: '"Inter", sans-serif'
    }}>
      <h1 style={{ textAlign: "center", marginBottom: "32px" }}>
        🎙️ MeetScribe Real-Time Recorder
      </h1>

      {/* Recording Timer */}
      {isRecording && (
        <div style={{ 
          textAlign: "center", 
          fontSize: "24px", 
          fontWeight: "bold",
          color: "#ef4444",
          marginBottom: "16px"
        }}>
          ⏱️ {formatTime(recordingTime)}
        </div>
      )}

      {/* Progress Bar */}
      {chunks.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            marginBottom: "8px",
            fontSize: "14px",
            color: "#6b7280"
          }}>
            <span>Upload Progress</span>
            <span>{uploadedChunks} / {chunks.length} chunks</span>
          </div>
          <div style={progressBarStyle}>
            <div style={progressFillStyle}></div>
          </div>
        </div>
      )}

      {/* Live Transcript Display */}
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
          <div style={{ 
            fontSize: "14px", 
            fontWeight: "bold", 
            color: "#374151",
            marginBottom: "8px"
          }}>
            🎤 Live Transcript:
          </div>
          <div style={{ 
            fontSize: "14px", 
            lineHeight: "1.5",
            color: "#1f2937"
          }}>
            {liveTranscript}
          </div>
        </div>
      )}

      {/* Recording Status */}
      <div style={{ 
        textAlign: "center", 
        marginBottom: "24px",
        padding: "16px",
        backgroundColor: isRecording ? "#fef3f2" : isProcessing ? "#fefbf2" : "#f0fdf4",
        borderRadius: "8px",
        border: `2px solid ${isRecording ? "#fecaca" : isProcessing ? "#fed7aa" : "#bbf7d0"}`
      }}>
        <div style={{ 
          fontSize: "18px", 
          fontWeight: "bold",
          color: isRecording ? "#dc2626" : isProcessing ? "#d97706" : "#16a34a",
          marginBottom: "8px"
        }}>
          {isRecording ? "🔴 Recording..." : isProcessing ? "⚙️ Processing..." : "⚪ Ready to Record"}
        </div>
        
        {chunks.length > 0 && (
          <div style={{ fontSize: "14px", color: "#6b7280" }}>
            Chunks recorded: {chunks.length} | Uploaded: {uploadedChunks} | Transcribed: {chunkTexts.filter(t => t).length}
          </div>
        )}
      </div>

      {/* Control Button */}
      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        {!isRecording ? (
          <button 
            onClick={start}
            disabled={isProcessing}
            style={{
              ...startButtonStyle,
              opacity: isProcessing ? 0.5 : 1,
              cursor: isProcessing ? "not-allowed" : "pointer"
            }}
            onMouseOver={(e) => !isProcessing && (e.target.style.transform = "scale(1.05)")}
            onMouseOut={(e) => e.target.style.transform = "scale(1)"}
          >
            🎙️ Start Recording
          </button>
        ) : (
          <button 
            onClick={stop}
            style={stopButtonStyle}
            onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
            onMouseOut={(e) => e.target.style.transform = "scale(1)"}
          >
            ⏹️ Stop & Summarize
          </button>
        )}
      </div>

      {/* Instructions */}
      <div style={{ 
        fontSize: "14px", 
        color: "#6b7280", 
        textAlign: "center",
        lineHeight: "1.5"
      }}>
        {!isRecording ? (
          <p>Click "Start Recording" to begin real-time transcription. You'll see text appear as you speak!</p>
        ) : (
          <p>Recording in progress... Watch the live transcript appear above as you speak. Each 30-second chunk is transcribed immediately.</p>
        )}
      </div>
    </div>
  );
}
