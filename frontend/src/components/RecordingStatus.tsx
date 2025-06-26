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
    // --- NEW: Custom progress bar colors for dark mode ---
    const isDarkMode = theme.body === '#18181b';
    const transcribedColor = isDarkMode ? '#ef4444' : theme.text; // Light Red for top bar
    const uploadedColor = isDarkMode ? '#f87171' : theme.secondaryText; // Red for bottom bar

    const instructionStyle: React.CSSProperties = {
        fontSize: '13px',
        color: theme.secondaryText,
        textAlign: 'center',
        margin: '0 0 8px 0',
        lineHeight: 1.5
    };

    return (
        <>
            {isRecording && (
                <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 'bold', color: theme.button.danger, marginBottom: '16px' }}>
                    ⏱️ {formatTime(recordingTime)}
                </div>
            )}

            {(isUiLocked || localChunksCount > 0) && (
                <div style={{ marginBottom: '24px' }}>
                    <div style={{ width: '100%', height: '20px', backgroundColor: theme.backgroundSecondary, borderRadius: '10px', overflow: 'hidden', position: 'relative', marginBottom: '8px' }}>
                        <div style={{ height: '100%', width: `${getUploadProgressPercentage()}%`, backgroundColor: uploadedColor, position: 'absolute', top: 0, left: 0, zIndex: 1, transition: 'width 0.3s' }} />
                        <div style={{ height: '100%', width: `${getTranscriptionProgressPercentage()}%`, backgroundColor: transcribedColor, position: 'absolute', top: 0, left: 0, zIndex: 2, transition: 'width 0.3s' }} />
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

            <div style={{ minHeight: '42px' }}>
                 {!isUiLocked ? (
                    <p style={instructionStyle}>Choose your audio source and click “Start Recording” to begin.</p>
                ) : isRecording ? (
                    <>
                        <p style={instructionStyle}>Live transcript will appear above as audio is processed.</p>
                        {audioSource !== 'file' && wakeLockStatus === 'active' && (
                            <p style={{...instructionStyle, opacity: 0.8, margin: 0}}>The screen will stay on during recording.</p>
                        )}
                        {audioSource !== 'file' && wakeLockStatus === 'error' && (
                            <p style={{...instructionStyle, color: theme.button.danger, margin: 0 }}>⚠️ Could not keep screen on. Please keep it awake manually.</p>
                        )}
                    </>
                ) : allChunksUploaded ? (
                    <p style={instructionStyle}>
                        ✅ Upload complete. You can safely close this window. <br />
                        You will be redirected when the summary is ready.
                    </p>
                ) : (
                    <p style={instructionStyle}>
                        Uploading... Once all chunks are sent, you can close this window. <br />
                        You will be redirected when it's ready.
                    </p>
                )}
            </div>
        </>
    );
};

export default RecordingStatus;
