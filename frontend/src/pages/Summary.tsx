import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";

export default function Summary() {
  const { mid } = useParams();
  const [summary, setSummary] = useState("⏳ Waiting for summary…");
  const [transcript, setTranscript] = useState<string | null>(null);

  useEffect(() => {
    // poll until meeting is done
    const iv = setInterval(async () => {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${mid}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.done) {
        setSummary(data.summary_markdown || "No summary");
        setTranscript(data.transcript_text || null);
        clearInterval(iv);
      }
    }, 5_000);
    return () => clearInterval(iv);
  }, [mid]);

  // shared font style for this page
  const fontStyle: React.CSSProperties = {
    fontFamily: '"Inter", sans-serif',
    fontSize: 18,
    fontWeight: 400,
    fontFeatureSettings: '"ss01" "ss02"',
    lineHeight: 1.6,
  };

  return (
    <div style={{ ...fontStyle, maxWidth: 800, margin: "0 auto", padding: 24 }}>
      {/* <h1 style={{ marginTop: 0 }}>Meeting Summary</h1> */}

      {/* markdown summary */}
      <ReactMarkdown>{summary}</ReactMarkdown>

      {/* raw transcript */}
      {transcript && (
        <>
          <h2 style={{ marginTop: 32 }}>Full Transcript (raw)</h2>
          <pre
            style={{
              ...fontStyle,
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
