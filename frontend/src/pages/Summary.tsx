import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function Summary() {
  const { mid } = useParams();
  const [md, setMd] = useState("⏳ Waiting for summary…");

  useEffect(() => {
    const iv = setInterval(async () => {
      const res = await fetch(`/api/meetings/${mid}`);
      if (res.ok) {
        const data = await res.json();
        if (data.done) {
          setMd(data.summary_markdown || "No summary");
          clearInterval(iv);
        }
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [mid]);

  return (
    <div style={{ whiteSpace: "pre-wrap", padding: 24 }}>{md}</div>
  );
}
