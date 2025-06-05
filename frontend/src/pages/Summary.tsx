// ./frontend/src/pages/Summary.tsx
import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { saveMeeting, getHistory, MeetingMeta } from "../utils/history"; // Added getHistory and MeetingMeta
import { getCached, saveCached } from "../utils/summaryCache";

export default function Summary() {
  const { mid } = useParams<{ mid: string }>();
  const [summary, setSummary] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meetingTitle, setMeetingTitle] = useState<string>(""); // To store title for history update
  const [meetingStartedAt, setMeetingStartedAt] = useState<string>(""); // To store started_at for history update

  const fetchMeetingData = useCallback(async (isInitialFetch: boolean = false) => {
    if (!mid) return;

    if (isInitialFetch) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}`
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: "Failed to fetch meeting data" }));
        throw new Error(errorData.message || `HTTP error! status: ${res.status}`);
      }

      const data = await res.json();

      if (isInitialFetch) {
        // Store title and started_at from the first successful fetch
        // These might be needed if the meeting is not yet in local history (e.g., opened via direct link)
        setMeetingTitle(data.title || `Meeting ${mid}`);
        setMeetingStartedAt(data.started_at || new Date().toISOString());
      }

      if (data.done && data.summary_markdown) {
        const sum = data.summary_markdown;
        const trn = data.transcript_text || null;
        setSummary(sum);
        setTranscript(trn);
        setIsProcessing(false);
        setIsLoading(false);

        saveCached({
          id: data.id,
          summary: sum,
          transcript: trn,
          updatedAt: new Date().toISOString(),
        });

        // Update history with status 'complete'
        // Try to get existing history meta to preserve title if it was set by Record page
        const history = getHistory();
        const existingMeta = history.find(m => m.id === data.id);

        saveMeeting({
          id: data.id,
          title: existingMeta?.title || data.title || `Meeting ${data.id}`,
          started_at: existingMeta?.started_at || data.started_at || new Date().toISOString(),
          status: "complete",
        });

      } else {
        // Not done or no summary markdown yet
        setIsProcessing(true);
        setIsLoading(false); // No longer initial loading, now it's processing
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred.");
      }
      setIsLoading(false);
      setIsProcessing(false);
    }
  }, [mid]);

  // Initial fetch
  useEffect(() => {
    fetchMeetingData(true);
  }, [fetchMeetingData]);

  // Polling mechanism
  useEffect(() => {
    if (!mid || !isProcessing) return;

    const pollInterval = setInterval(() => {
      fetchMeetingData(false); // Not an initial fetch
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [mid, isProcessing, fetchMeetingData]);

  /* ─── styling ───────────────────────────────────────────────────── */
  const font: React.CSSProperties = {
    fontFamily: '"Inter", sans-serif',
    fontSize: 18,
    lineHeight: 1.6,
  };

  return (
    <div style={{ ...font, maxWidth: 800, margin: "0 auto", padding: 24 }}>
      {isLoading && <p>Loading summary...</p>}
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {!isLoading && !error && isProcessing && !summary && (
        <p>⏳ Processing summary, please wait...</p>
      )}
      {summary && <ReactMarkdown>{summary}</ReactMarkdown>}

      {!isLoading && !error && transcript && (
        <>
          <h2 style={{ marginTop: 32 }}>Full Transcript (raw)</h2>
          <pre
            style={{
              ...font,
              whiteSpace: "pre-wrap",
              background: "#f5f5f5",
              padding: 16,
              borderRadius: 4,
              overflowX: "auto",
            }}
          >
            {transcript}
          </pre>
        </>
      )}
    </div>
  );
}
