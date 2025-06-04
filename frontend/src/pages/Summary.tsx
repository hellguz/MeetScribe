// ./frontend/src/pages/Summary.tsx
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { saveMeeting } from "../utils/history";
import { getCached, saveCached } from "../utils/summaryCache";

export default function Summary() {
  const { mid } = useParams<{ mid: string }>();
  const [summary, setSummary] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  /* ─── try local cache first ─────────────────────────────────────── */
  useEffect(() => {
    if (!mid) return;
    const cached = getCached(mid);
    if (cached) {
      setSummary(cached.summary);
      setTranscript(cached.transcript ?? null);
    } else {
      setWaiting(true);
    }
  }, [mid]);

  /* ─── poll backend until finished, then cache ───────────────────── */
  useEffect(() => {
    if (!mid || !waiting) return;

    const poll = setInterval(async () => {
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}`
      );
      if (!res.ok) return;
      const data = await res.json();

      if (data.done) {
        const sum = data.summary_markdown || "No summary";
        const trn = data.transcript_text || null;
        setSummary(sum);
        setTranscript(trn);

        // Cache summary for offline use
        saveCached({
          id: data.id,
          summary: sum,
          transcript: trn,
          updatedAt: new Date().toISOString(),
        });

        // Ensure meta list entry exists / is up-to-date
        saveMeeting({
          id: data.id,
          title: data.title,
          started_at: data.started_at,
        });

        clearInterval(poll);
        setWaiting(false);
      }
    }, 5000);

    return () => clearInterval(poll);
  }, [mid, waiting]);

  /* ─── styling ───────────────────────────────────────────────────── */
  const font: React.CSSProperties = {
    fontFamily: '"Inter", sans-serif',
    fontSize: 18,
    lineHeight: 1.6,
  };

  return (
    <div style={{ ...font, maxWidth: 800, margin: "0 auto", padding: 24 }}>
      {/* <h1 style={{ marginTop: 0 }}>Meeting Summary</h1> */}

      {summary ? (
        <ReactMarkdown>{summary}</ReactMarkdown>
      ) : (
        <p>⏳ Waiting for summary…</p>
      )}

      {transcript && (
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
