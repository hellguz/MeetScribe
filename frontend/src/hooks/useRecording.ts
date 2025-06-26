import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SummaryLength } from '../contexts/SummaryLengthContext';
import { saveMeeting, getHistory } from '../utils/history';
import { AudioSource } from '../types';
import { SummaryLanguageState } from '../contexts/SummaryLanguageContext';

const CHUNK_DURATION_MS = 30_000;

const encodeAudioChunk = (chunkBuffer: AudioBuffer): Promise<Blob> => {
	return new Promise((resolve, reject) => {
		const audioCtx = new AudioContext({ sampleRate: chunkBuffer.sampleRate });
		const source = audioCtx.createBufferSource();
		source.buffer = chunkBuffer;

		const dest = audioCtx.createMediaStreamDestination();
		source.connect(dest);

		const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm; codecs=opus' });
		const chunks: Blob[] = [];

		recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
		recorder.onstop = () => {
			const blob = new Blob(chunks, { type: 'audio/webm; codecs=opus' });
			resolve(blob);
			audioCtx.close().catch(console.error);
		};
		recorder.onerror = (e) => {
			reject(e);
			audioCtx.close().catch(console.error);
		};
		source.onended = () => recorder.stop();

		recorder.start();
		source.start(0);
	});
};

export const useRecording = (summaryLength: SummaryLength, languageState: SummaryLanguageState) => {
    const navigate = useNavigate();
    const [isRecording, setRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [localChunksCount, setLocalChunksCount] = useState(0);
    const [uploadedChunks, setUploadedChunks] = useState(0);
    const [expectedTotalChunks, setExpectedTotalChunks] = useState<number | null>(null);
    const [recordingTime, setRecordingTime] = useState(0);
    const [liveTranscript, setLiveTranscript] = useState('');
    const [transcribedChunks, setTranscribedChunks] = useState(0);
    const [audioSource, setAudioSource] = useState<AudioSource>('mic');
    const [includeMic, setIncludeMic] = useState(() => JSON.parse(localStorage.getItem('meetscribe_include_mic') ?? 'true'));
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const [firstChunkProcessedTime, setFirstChunkProcessedTime] = useState<number | null>(null);
    const [transcriptionStartTime, setTranscriptionStartTime] = useState<number | null>(null);

    // --- NEW: Wake Lock state ---
    const [wakeLockStatus, setWakeLockStatus] = useState<'inactive' | 'active' | 'error'>('inactive');
    const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);


    const meetingId = useRef<string | null>(null);
    const mediaRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const displayStreamRef = useRef<MediaStream | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const chunkIndexRef = useRef(0);
    const isRecordingRef = useRef(false);
    useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
    useEffect(() => { localStorage.setItem('meetscribe_include_mic', JSON.stringify(includeMic)); }, [includeMic]);

    const transcriptionSpeed = useMemo(() => {
        if (!transcriptionStartTime || transcribedChunks < 2) return null;
        const elapsedSec = (Date.now() - transcriptionStartTime) / 1000;
        if (elapsedSec <= 0) return null;
        const audioDurationProcessed = (transcribedChunks - 1) * (CHUNK_DURATION_MS / 1000);
        return audioDurationProcessed / elapsedSec;
    }, [transcriptionStartTime, transcribedChunks]);

    const transcriptionSpeedLabel = useMemo(() => {
        if (!transcriptionSpeed) return null;
        return `${transcriptionSpeed.toFixed(1)}x`;
    }, [transcriptionSpeed]);

    const resetState = () => {
        setRecording(false);
        setIsProcessing(false);
        setLocalChunksCount(0);
        setUploadedChunks(0);
        setExpectedTotalChunks(null);
        setRecordingTime(0);
        setLiveTranscript('');
        setTranscribedChunks(0);
        setFirstChunkProcessedTime(null);
        setTranscriptionStartTime(null);
        chunkIndexRef.current = 0;
        meetingId.current = null;
        setWakeLockStatus('inactive');
    };

    const pollMeetingStatus = useCallback(async () => {
        if (!meetingId.current) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId.current}`);
            if (!res.ok) return;
            const data = await res.json();

            setUploadedChunks(data.received_chunks ?? 0);
            setExpectedTotalChunks(data.expected_chunks ?? null);
            setLiveTranscript(data.transcript_text ?? '');
            setTranscribedChunks(data.transcribed_chunks ?? 0);

            if (data.transcribed_chunks === 1 && !firstChunkProcessedTime) {
                setFirstChunkProcessedTime(Date.now());
            } else if (data.transcribed_chunks > 1 && firstChunkProcessedTime && !transcriptionStartTime) {
                setTranscriptionStartTime(firstChunkProcessedTime);
            }

            if (data.done) {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                const finalMeetingId = meetingId.current; // Grab the ID before we reset state
                resetState();
                if (finalMeetingId) {
                    navigate(`/summary/${finalMeetingId}`, { replace: true });
                }
            } else if (!isRecordingRef.current) {
                setIsProcessing(true);
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }, [navigate, firstChunkProcessedTime, transcriptionStartTime]);

    const createMeetingOnBackend = useCallback(async (title: string, context: string) => {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                title, 
                summary_length: summaryLength,
                summary_language_mode: languageState.mode,
                summary_custom_language: languageState.lastCustomLanguage,
                context: context,
            }),
        });
        if (!res.ok) throw new Error('Failed to create meeting');
        const data = await res.json();
        meetingId.current = data.id;
        saveMeeting({ id: data.id, title, started_at: new Date().toISOString(), status: 'pending' });
        return data.id;
    }, [summaryLength, languageState]);

    const uploadChunk = useCallback(async (blob: Blob, index: number, isFinal = false) => {
        if (!meetingId.current) return;
        const fd = new FormData();
        fd.append('meeting_id', meetingId.current);
        fd.append('chunk_index', String(index));
        fd.append('file', blob, `chunk-${index}.webm`);
        fd.append('is_final', String(isFinal));
        try {
            await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/chunks`, { method: 'POST', body: fd });
        } catch (error) {
            console.error(`Failed to upload chunk ${index}:`, error);
        }
    }, []);

    const updateContext = useCallback(async (newContext: string) => {
        if (!meetingId.current) return;
        try {
            await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId.current}/context`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: newContext }),
            });
        } catch (error) {
            console.error('Failed to update context:', error);
        }
    }, []);

    const updateMeetingConfig = useCallback(async (config: Partial<SummaryLanguageState & { summaryLength: SummaryLength }>) => {
        if (!meetingId.current) return;
        
        const payload = {
            summary_length: config.summaryLength,
            summary_language_mode: config.mode,
            summary_custom_language: config.lastCustomLanguage,
        };

        try {
            await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId.current}/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (error) {
            console.error('Failed to update meeting config:', error);
        }
    }, []);

    const stopRecording = useCallback(async (isFinal: boolean = true) => {
        if (mediaRef.current && mediaRef.current.state === 'recording') {
            mediaRef.current.stop();
        }
        if (isFinal) {
            setRecording(false);
            setIsProcessing(true);

            // --- NEW: Release wake lock ---
            if (wakeLockSentinelRef.current) {
                await wakeLockSentinelRef.current.release();
                wakeLockSentinelRef.current = null;
            }
            setWakeLockStatus('inactive');

            streamRef.current?.getTracks().forEach(track => track.stop());
            displayStreamRef.current?.getTracks().forEach(track => track.stop());
            micStreamRef.current?.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            displayStreamRef.current = null;
            micStreamRef.current = null;

            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            if (audioCtxRef.current) {
                await audioCtxRef.current.close();
                audioCtxRef.current = null;
            }
            animationFrameRef.current = null;
            analyserRef.current = null;

            if (timerRef.current) clearInterval(timerRef.current);
            await new Promise(resolve => setTimeout(resolve, 500));
            const finalBlob = new Blob([], { type: mediaRef.current?.mimeType || 'audio/webm' });
            await uploadChunk(finalBlob, chunkIndexRef.current, true);
        }
    }, [uploadChunk]);

    const startLiveRecording = useCallback(async (source: 'mic' | 'system', drawWaveform: () => void, initialContext: string) => {
        resetState();
        let finalStream: MediaStream;
        try {
            // --- NEW: Request Wake Lock ---
            if ('wakeLock' in navigator) {
                try {
                    wakeLockSentinelRef.current = await navigator.wakeLock.request('screen');
                    setWakeLockStatus('active');
                    wakeLockSentinelRef.current.onrelease = () => {
                        // The lock was released by the browser (e.g., user switched tabs).
                        // It will be re-acquired on visibility change if recording is still active.
                        wakeLockSentinelRef.current = null;
                        if (isRecordingRef.current) {
                            console.log('Screen Wake Lock was released, will try to reacquire on visibility change.');
                        }
                    };
                } catch (err: any) {
                    // This can happen if the document is not visible, etc.
                    console.error(`Failed to acquire screen wake lock: ${err.name}`, err);
                    setWakeLockStatus('error');
                }
            } else {
                console.warn('Screen Wake Lock API not supported on this browser.');
                setWakeLockStatus('error');
            }

            if (source === 'system') {
                const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false } });
                displayStreamRef.current = displayStream;
                displayStream.getVideoTracks()[0].onended = () => { if (isRecordingRef.current) stopRecording(); };

                const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                micStreamRef.current = micStream;
                micStream.getAudioTracks()[0].enabled = includeMic;

                audioCtxRef.current = new AudioContext();
                const dest = audioCtxRef.current.createMediaStreamDestination();
                if (displayStream.getAudioTracks().length > 0) {
                    audioCtxRef.current.createMediaStreamSource(displayStream).connect(dest);
                }
                audioCtxRef.current.createMediaStreamSource(micStream).connect(dest);
                finalStream = dest.stream;
            } else {
                finalStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } });
                micStreamRef.current = finalStream;
            }

            streamRef.current = finalStream;
            if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
            const sourceNode = audioCtxRef.current.createMediaStreamSource(finalStream);
            analyserRef.current = audioCtxRef.current.createAnalyser();
            sourceNode.connect(analyserRef.current);

            setRecording(true);
            startTimeRef.current = Date.now();
            await createMeetingOnBackend(`Recording ${new Date().toLocaleString()}`, initialContext);

            pollIntervalRef.current = setInterval(pollMeetingStatus, 3000);
            timerRef.current = setInterval(() => setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000);

            const createAndStartRecorder = () => {
                if (!streamRef.current) return;
                const recorder = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm; codecs=opus' });
                mediaRef.current = recorder;
                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        uploadChunk(e.data, chunkIndexRef.current++);
                        setLocalChunksCount(c => c + 1);
                    }
                };
                recorder.onstop = () => { if (isRecordingRef.current) createAndStartRecorder(); };
                recorder.start();
                setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, CHUNK_DURATION_MS);
            };
            createAndStartRecorder();
            drawWaveform();

        } catch (err) {
            console.error("Failed to start recording:", err);
            alert("Could not start recording. Please check permissions.");
            // Make sure to clean up if start fails
            if (wakeLockSentinelRef.current) {
                wakeLockSentinelRef.current.release();
                wakeLockSentinelRef.current = null;
            }
            resetState();
        }
    }, [createMeetingOnBackend, includeMic, pollMeetingStatus, stopRecording, uploadChunk]);

    const startFileProcessing = useCallback(async (initialContext: string) => {
        if (!selectedFile) return;
        resetState();
        setIsProcessing(true);
        try {
            await createMeetingOnBackend(`Transcription of ${selectedFile.name}`, initialContext);
            pollIntervalRef.current = setInterval(pollMeetingStatus, 3000);

            const audioCtx = new AudioContext();
            const arrayBuffer = await selectedFile.arrayBuffer();
            const originalBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            const chunkDurationSec = CHUNK_DURATION_MS / 1000;
            const numChunks = Math.ceil(originalBuffer.duration / chunkDurationSec);
            setExpectedTotalChunks(numChunks);

            for (let i = 0; i < numChunks; i++) {
                const startS = i * chunkDurationSec;
                const endS = Math.min(startS + chunkDurationSec, originalBuffer.duration);
                if (endS <= startS) continue;

                const startSample = Math.floor(startS * originalBuffer.sampleRate);
                const endSample = Math.floor(endS * originalBuffer.sampleRate);

                const chunkBuffer = audioCtx.createBuffer(
                    originalBuffer.numberOfChannels,
                    endSample - startSample,
                    originalBuffer.sampleRate
                );
                for (let ch = 0; ch < originalBuffer.numberOfChannels; ch++) {
                    chunkBuffer.getChannelData(ch).set(originalBuffer.getChannelData(ch).subarray(startSample, endSample));
                }

                const blob = await encodeAudioChunk(chunkBuffer);
                await uploadChunk(blob, i, i === numChunks - 1);
                setLocalChunksCount(c => c + 1);
            }
            audioCtx.close();
        } catch (err) {
            console.error("File processing failed:", err);
            alert("Failed to process the audio file.");
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            resetState();
        }
    }, [selectedFile, createMeetingOnBackend, pollMeetingStatus, uploadChunk]);

    useEffect(() => {
        if (includeMic && isRecording && audioSource === 'system' && micStreamRef.current) {
            micStreamRef.current.getAudioTracks()[0].enabled = includeMic;
        }
    }, [includeMic, isRecording, audioSource]);

    // --- NEW: Handle visibility change to re-acquire wake lock ---
    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (wakeLockSentinelRef.current !== null || document.visibilityState !== 'visible') {
                return;
            }
            // If recording is still active and the lock was released, try to re-acquire it.
            if (isRecordingRef.current && 'wakeLock' in navigator) {
                try {
                    wakeLockSentinelRef.current = await navigator.wakeLock.request('screen');
                    setWakeLockStatus('active');
                    wakeLockSentinelRef.current.onrelease = () => {
                        wakeLockSentinelRef.current = null;
                        if (isRecordingRef.current) {
                            console.log('Screen Wake Lock was released again.');
                        }
                    };
                    console.log('Screen Wake Lock reacquired on visibility change.');
                } catch (err: any) {
                    console.error('Failed to re-acquire screen wake lock:', err);
                    setWakeLockStatus('error');
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            // --- NEW: Ensure wake lock is released on component unmount ---
            if (wakeLockSentinelRef.current) {
                wakeLockSentinelRef.current.release();
            }
        };
    }, []);

    return {
        isRecording, isProcessing, localChunksCount, uploadedChunks, expectedTotalChunks,
        recordingTime, liveTranscript, transcribedChunks, audioSource, setAudioSource,
        includeMic, setIncludeMic, selectedFile, setSelectedFile, startLiveRecording,
        stopRecording, startFileProcessing, transcriptionSpeedLabel, analyserRef, animationFrameRef,
        updateContext, updateMeetingConfig,
        resetState,
        wakeLockStatus,
    };
};




