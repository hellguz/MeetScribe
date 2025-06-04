import { useEffect, useState } from "react";
import useWebSocket from "react-use-websocket";
import api from "../api/client";
import { ChunkMeta } from "./useRecorder";

export function useUploader(meetingId: string, chunks: ChunkMeta[]) {
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(
    `/api/ws?meeting_id=${meetingId}`,
    { share: true, shouldReconnect: () => true }
  );

  // fallback REST upload when WS not ready
  useEffect(() => {
    (async () => {
      if (readyState !== 1) return;
      for (const c of chunks) {
        if (sentIds.has(c.id)) continue;
        sendJsonMessage({ id: c.id, size: c.blob.size });
        await api.postForm(
          "/chunks",
          { meeting_id: meetingId, chunk_id: c.id, file: c.blob },
          { headers: { "Content-Type": "multipart/form-data" } }
        );
        setSentIds(prev => new Set(prev).add(c.id));
      }
    })();
  }, [chunks, readyState, sentIds, meetingId, sendJsonMessage]);

  useEffect(() => {
    if (lastJsonMessage?.acked) {
      setSentIds(prev => new Set([...prev, ...lastJsonMessage.acked]));
    }
  }, [lastJsonMessage]);

  return { sent: sentIds.size, total: chunks.length };
}


