import React from 'react';
import { AppTheme } from '../styles/theme';
import { AudioSource } from '../types';
interface RecordingStatusProps {
    theme: AppTheme;
    isRecording: boolean;
    isProcessing: boolean;
    recordingTime: number;
    localChunksCount: number;
    uploadedChunks: number;
    expectedTotalChunks: number | null;
    transcribedChunks: number;
    transcriptionSpeedLabel: string | null;
    liveTranscript: string;
    canvasRef: React.RefObject<HTMLCanvasElement>;
    audioSource: AudioSource;
    wakeLockStatus: 'inactive' | 'active' | 'error';
}

const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};
const RecordingStatus: React.FC<RecordingStatusProps> = ({
    theme,
    isRecording,
    isProcessing,
    recordingTime,
    localChunksCount,
    uploadedChunks,
    expectedTotalChunks,
    transcribedChunks,
    transcriptionSpeedLabel,
    liveTranscript,
    canvasRef,
    audioSource,
    wakeLockStatus,
}) => {
    const realTotal = expectedTotalChunks !== null ? expectedTotalChunks : localChunksCount;
    const getUploadProgressPercentage = () => (realTotal === 0 ? 0 : Math.min(100, (uploadedChunks / realTotal) * 100));
    const getTranscriptionProgressPercentage = () => (realTotal === 0 ? 0 : Math.min(100, (transcribedChunks / realTotal) * 100));
    const allChunksUploaded = realTotal > 0 && uploadedChunks >= realTotal;
    const isUiLocked = isRecording || isProcessing;
    return (
        <>
            {isRecording && (
                <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 'bold', color: theme.button.danger, marginBottom: '16px' }}>
                    ⏱️ {formatTime(recordingTime)}
                </div>
            )}

            {isRecording && audioSource !== 'file' && wakeLockStatus !== 'inactive' && (
                <div
                    style={{
                        textAlign: 'center',
                        marginBottom: '16px',
                        padding: '10px 12px',
                        fontSize: '13px',
                        borderRadius: '8px',
                        backgroundColor: theme.backgroundSecondary,
                        color: wakeLockStatus === 'error' ? theme.button.danger : theme.secondaryText,
                        border: `1px solid ${wakeLockStatus === 'error' ? theme.button.danger : theme.border}`,
                    }}>
                    {wakeLockStatus === 'active' && '💡 The screen will remain on during this recording to ensure it isn\'t interrupted.'}
                    {wakeLockStatus === 'error' && '⚠️ Could not prevent screen from sleeping. To avoid interruptions, please keep the screen on.'}
                </div>
            )}

            {(isUiLocked || localChunksCount > 0) && (
                <div style={{ marginBottom: '24px' }}>
                    <div style={{ width: '100%', height: '20px', backgroundColor: theme.backgroundSecondary, borderRadius: '10px', overflow: 'hidden', position: 'relative', marginBottom: '8px' }}>
                        <div style={{ height: '100%', width: `${getUploadProgressPercentage()}%`, backgroundColor: theme.secondaryText, position: 'absolute', top: 0, left: 0, zIndex: 1, transition: 'width 0.3s' }} />
                        <div style={{ height: '100%', width: `${getTranscriptionProgressPercentage()}%`, backgroundColor: theme.text, position: 'absolute', top: 0, left: 0, zIndex: 2, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: theme.secondaryText }}>
                        <span>Uploaded: {uploadedChunks} / {realTotal}</span>
                        <span>Transcribed: {transcribedChunks} / {realTotal} {transcriptionSpeedLabel && `(${transcriptionSpeedLabel})`}</span>
                    </div>
                </div>
            )}

            {liveTranscript && (
                <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: theme.background, borderRadius: '8px', border: `1px solid ${theme.border}`, maxHeight: '200px', overflowY: 'auto', color: theme.text }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: theme.text, marginBottom: '8px' }}>🎤 Live transcript</div>
                    <div style={{ fontSize: '14px', lineHeight: '1.5' }}>{liveTranscript}</div>
                </div>
            )}

            <div style={{ position: 'relative', textAlign: 'center', marginBottom: '24px', padding: '16px', backgroundColor: isUiLocked ? theme.backgroundSecondary : theme.background, border: `2px solid ${isRecording ? theme.button.danger : isProcessing ? theme.secondaryText : theme.button.primary}`, borderRadius: '8px', overflow: 'hidden' }}>
                <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }} />
                <div style={{ position: 'relative', zIndex: 1, fontSize: '18px', fontWeight: 'bold', color: isRecording ? theme.button.danger : isProcessing ? theme.secondaryText : theme.button.primary, marginBottom: '8px' }}>
                    {isRecording ? '🔴 Recording...' : isProcessing ? '⚙️ Processing... Please wait.' : '⚪ Ready'}
                </div>
            </div>

            <div style={{ fontSize: '14px', color: theme.secondaryText, textAlign: 'center', lineHeight: '1.5', minHeight: '42px' }}>
                 {!isUiLocked ? (
                    audioSource === 'file' ? (
                        <p>Select a file and click “Start Transcription” to begin.</p>
                    ) : (
                        <p>Choose your audio source and click “Start Recording” to begin.</p>
                    )
                ) : isRecording ? (
                    <p>Recording in progress… a live transcript will appear above as the AI processes your audio.</p>
                ) : allChunksUploaded ? (
                    <p>
                        ✅ All audio has been uploaded! It is now safe to close this window. <br />
                        The server is finishing the transcription and summary. You will be redirected automatically.
                    </p>
                ) : (
                    <p>
                        Uploading and processing... Once all chunks are sent, you can safely close the window. <br />
                        You will be redirected to the summary page when it's ready.
                    </p>
                )}
            </div>
        </>
    );
};

export default RecordingStatus;


