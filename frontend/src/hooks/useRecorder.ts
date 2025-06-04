import { useCallback, useEffect, useRef, useState } from "react";
import { set, get } from "idb-keyval";

export interface ChunkMeta {
  id: string;
  blob: Blob;
}

export default function useRecorder(chunkMs = 30_000) {
  const [isRecording, setIsRecording] = useState(false);
  const [chunks, setChunks] = useState<ChunkMeta[]>([]);
  const mediaRef = useRef<MediaRecorder | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRef.current = rec;

    rec.ondataavailable = async e => {
      if (e.data.size === 0) return;
      const id = crypto.randomUUID();
      const meta: ChunkMeta = { id, blob: e.data };
      setChunks(prev => [...prev, meta]);
      await set(id, e.data); // persist
    };

    rec.start(chunkMs);
    setIsRecording(true);
  }, [chunkMs]);

  const stop = useCallback(() => {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setIsRecording(false);
  }, []);

  const clearPersisted = useCallback(async () => {
    for (const c of chunks) await set(c.id, undefined);
    setChunks([]);
  }, [chunks]);

  useEffect(() => {
    // restore chunks from previous session
    (async () => {
      const keys = await get<any>("__keys__").catch(() => []);
      if (keys?.length) {
        const restored: ChunkMeta[] = [];
        for (const k of keys) {
          const blob = await get<Blob>(k);
          if (blob) restored.push({ id: k, blob });
        }
        setChunks(restored);
      }
    })();
  }, []);

  return { isRecording, chunks, start, stop, clearPersisted };
}


