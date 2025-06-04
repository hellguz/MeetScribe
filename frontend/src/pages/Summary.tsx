import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import api from "../api/client";

export default function Summary() {
  const { mid } = useParams();
  const [md, setMd] = useState<string>("Loading…");

  useEffect(() => {
    (async () => {
      const { data } = await api.get(`/meetings/${mid}`);
      setMd(data.summary_markdown || "⏳ Summarising… refresh in a bit.");
    })();
  }, [mid]);

  return (
    <div className="prose mx-auto p-6">
      <ReactMarkdown>{md}</ReactMarkdown>
    </div>
  );
}


