import React, { useState } from "react";
import useRecorder from "../hooks/useRecorder";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import RecorderButton from "../components/RecorderButton";
import UploadProgress from "../components/UploadProgress";

export default function Record() {
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const rec = useRecorder();
  const navigate = useNavigate();

  const handleStart = async () => {
    const { data } = await api.post("/meetings", { title: "Untitled" });
    setMeetingId(data.id);
    rec.start();
  };

  const handleStop = () => {
    rec.stop();
    if (meetingId) navigate(`/summary/${meetingId}`);
  };

  return (
    <div className="p-6 space-y-6 max-w-xl mx-auto">
      <h1 className="text-3xl font-bold">MeetScribe Recorder</h1>
      {!rec.isRecording ? (
        <RecorderButton label="Start" onClick={handleStart} />
      ) : (
        <RecorderButton label="Stop" onClick={handleStop} danger />
      )}
      {meetingId && (
        <UploadProgress meetingId={meetingId} chunks={rec.chunks} />
      )}
      <button
        className="border px-3 py-1 rounded"
        onClick={() => rec.clearPersisted()}
        disabled={rec.isRecording}
      >
        Clear saved chunks
      </button>
    </div>
  );
}


