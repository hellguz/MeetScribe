import React from "react";
import { useUploader } from "../hooks/useUploader";
import { ChunkMeta } from "../hooks/useRecorder";

export default function UploadProgress({
  meetingId,
  chunks
}: {
  meetingId: string;
  chunks: ChunkMeta[];
}) {
  const { sent, total } = useUploader(meetingId, chunks);
  return (
    <div>
      Uploaded {sent}/{total} chunks
    </div>
  );
}


