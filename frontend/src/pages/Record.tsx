import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHistory, MeetingMeta, syncHistory, saveMeeting, removeMeeting } from '../utils/history';
import ThemeToggle from '../components/ThemeToggle';
import { useTheme } from '../contexts/ThemeContext';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';
import SummaryLengthSelector from '../components/SummaryLengthSelector';
import { useSummaryLength, SummaryLength } from '../contexts/SummaryLengthContext';
import { useRecording } from '../hooks/useRecording';
import AudioSourceSelector from '../components/AudioSourceSelector';
import FileUpload from '../components/FileUpload';
import RecordingStatus from '../components/RecordingStatus';
import HistoryList from '../components/HistoryList';
import { AudioSource } from '../types';
import LanguageSelector from '../components/LanguageSelector';
import { useSummaryLanguage, SummaryLanguageState } from '../contexts/SummaryLanguageContext';

export default function Record() {
    const { theme } = useTheme();
    const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;
    const { summaryLength, setSummaryLength } = useSummaryLength();
    const { languageState, setLanguageState } = useSummaryLanguage();

    const {
        isRecording, isProcessing, localChunksCount, uploadedChunks, expectedTotalChunks,
        recordingTime, liveTranscript, transcribedChunks, audioSource, setAudioSource,
        includeMic, setIncludeMic, selectedFile, setSelectedFile, startLiveRecording,
        stopRecording, startFileProcessing, transcriptionSpeedLabel, analyserRef,
        animationFrameRef,
        wakeLockStatus,
    } = useRecording(summaryLength, languageState);
    const [history, setHistory] = useState<MeetingMeta[]>([]);
    const [isSystemAudioSupported, setIsSystemAudioSupported] = useState(true);
    const [meetingContext, setMeetingContext] = useState(''); // Added state for meeting context
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const isUiLocked = isRecording || isProcessing;

    useEffect(() => {
        const fetchAndSyncHistory = async () => {
            const localHistory = getHistory();
            if (localHistory.length > 0) {
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/sync`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: localHistory.map(m => m.id) }),
                    });
                    if (res.ok) syncHistory(await res.json());
                } catch (error) {
                    console.warn('Could not sync history with server:', error);
                }
            }
            setHistory(getHistory());
        };
        fetchAndSyncHistory();
    }, [isProcessing]);
    useEffect(() => {
        setIsSystemAudioSupported(typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !/iPad|iPhone|iPod/.test(navigator.userAgent));
    }, []);
    const drawWaveform = useCallback(() => {
        if (!analyserRef.current || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const analyser = analyserRef.current;
        if (!ctx) return;

        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2;
        ctx.strokeStyle = theme === 'light' ? 'rgba(239,68,68,0.3)' : 'rgba(255, 100, 100, 0.4)';
        ctx.beginPath();

        const sliceWidth = canvas.width / bufferLength;
        let x = 0;
        const centerY = canvas.height / 2;

        for (let i = 0; i < bufferLength; i++) {
			const v = dataArray[i] / 128.0;
			const y = v * (canvas.height / 2);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
        }
        ctx.lineTo(canvas.width, centerY);
        ctx.stroke();

        animationFrameRef.current = requestAnimationFrame(drawWaveform);
    }, [theme, analyserRef, animationFrameRef]);
    const handleStart = () => {
        if (audioSource === 'file') {
            startFileProcessing(meetingContext);
        } else {
            startLiveRecording(audioSource, drawWaveform, meetingContext);
        }
    };

    const handleStop = () => stopRecording(true);
    const handleLengthChange = (newLength: SummaryLength) => {
        setSummaryLength(newLength);
    };
    const handleLanguageChange = (update: Partial<SummaryLanguageState>) => {
        setLanguageState(update);
    };
    const handleTitleUpdate = async (id: string, newTitle: string) => {
        const originalTitle = history.find(m => m.id === id)?.title;
        if (!originalTitle || newTitle === originalTitle) return;

        setHistory(prev => prev.map(m => m.id === id ? { ...m, title: newTitle } : m));
        try {
            const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${id}/title`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle }),
            });
            if (!response.ok) throw new Error('Failed to update title on server');
            const updatedMeeting = await response.json();
            saveMeeting({ id: updatedMeeting.id, title: updatedMeeting.title, started_at: updatedMeeting.started_at, status: 'complete' });
        } catch (error) {
            console.error(error);
            setHistory(prev => prev.map(m => m.id === id ? { ...m, title: originalTitle } : m)); // Revert on error
        }
    };
    const handleMeetingDelete = async (id: string) => {
        // Optimistically remove from UI
        setHistory(prev => prev.filter(m => m.id !== id));
        removeMeeting(id);
        try {
            const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${id}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                // If deletion fails, re-fetch history to revert UI state
                setHistory(getHistory());
                throw new Error('Failed to delete meeting on server.');
            }
        } catch (error) {
            console.error(error);
            alert('Could not delete the meeting. It has been restored to your list.');
            // Revert optimistic removal
            setHistory(getHistory());
        }
    };

    return (
        <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
            <ThemeToggle />
            <h1 style={{ textAlign: 'center', marginBottom: '16px', color: currentThemeColors.text }}>🎙️ MeetScribe</h1>

            {isUiLocked && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                    <SummaryLengthSelector value={summaryLength} onSelect={handleLengthChange} disabled={isProcessing} />
                    <LanguageSelector disabled={isProcessing} onSelectionChange={handleLanguageChange} />
                </div>
            )}

            {!isUiLocked && (
                <div style={{ marginBottom: '24px' }}>
                    <textarea
                        value={meetingContext}
                        onChange={(e) => setMeetingContext(e.target.value)}
                        placeholder="Enter meeting context (optional: topic, participants, project...)"
                        disabled={isUiLocked}
                        style={{
                            width: '100%',
                            minHeight: '60px',
                            padding: '10px',
                            borderRadius: '6px',
                            border: `1px solid ${currentThemeColors.border}`,
                            backgroundColor: currentThemeColors.input.background,
                            color: currentThemeColors.input.text,
                            fontSize: '15px',
                            marginBottom: '16px',
                            boxSizing: 'border-box'
                        }}
                    />
                    <AudioSourceSelector audioSource={audioSource} setAudioSource={(s) => { setAudioSource(s); setSelectedFile(null); }} includeMic={includeMic} setIncludeMic={setIncludeMic} isSystemAudioSupported={isSystemAudioSupported} disabled={isUiLocked} theme={currentThemeColors} />
                    {audioSource === 'file' && (
                        <div style={{ marginTop: '16px', marginBottom: '24px' }}>
                            <FileUpload selectedFile={selectedFile} onFileSelect={setSelectedFile} disabled={isUiLocked} theme={currentThemeColors} />
                        </div>
                    )}
                </>
            )}

            <RecordingStatus
                theme={currentThemeColors}
                isRecording={isRecording}
                isProcessing={isProcessing}
                recordingTime={recordingTime}
                localChunksCount={localChunksCount}
                uploadedChunks={uploadedChunks}
                expectedTotalChunks={expectedTotalChunks}
                transcribedChunks={transcribedChunks}
                transcriptionSpeedLabel={transcriptionSpeedLabel}
                liveTranscript={liveTranscript}
                canvasRef={canvasRef}
                audioSource={audioSource}
                wakeLockStatus={wakeLockStatus}
            />
            
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                {!isRecording ? (
                    <button onClick={handleStart} disabled={isUiLocked || (audioSource === 'file' && !selectedFile)} style={{ padding: '16px 32px', fontSize: '18px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', backgroundColor: currentThemeColors.button.primary, color: currentThemeColors.button.primaryText, opacity: (isUiLocked || (audioSource === 'file' && !selectedFile)) ? 0.5 : 1 }}>
                        {audioSource === 'file' ? '📄 Start Transcription' : '🎙️ Start Recording'}
                    </button>
                ) : (
                    <button onClick={handleStop} style={{ padding: '16px 32px', fontSize: '18px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', backgroundColor: currentThemeColors.button.danger, color: currentThemeColors.button.dangerText }}>
                        ⏹️ Stop & Summarize
                    </button>
                )}
            </div>

            {!isUiLocked && <HistoryList history={history} onTitleUpdate={handleTitleUpdate} onDelete={handleMeetingDelete} />}
        </div>
    );
}