import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { SummaryLength } from '../contexts/SummaryLengthContext'
import { saveMeeting } from '../utils/history'
import { AudioSource } from '../types'
import { SummaryLanguageState } from '../contexts/SummaryLanguageContext'
import { apiUrl } from '../utils/api'
import { isLocalMode } from '../local/mode'
import { createLocalSink, seedLocalMeeting } from '../local/sink'
import { preloadSummaryModel } from '../ondevice/summary/worker'
import { getLocalSummaryModel } from '../ondevice/summary/pref'
import type { OnDeviceController } from '../ondevice/useOnDevice'

const CHUNK_DURATION_MS = 30_000

export const useRecording = (summaryLength: SummaryLength, languageState: SummaryLanguageState, onDevice: OnDeviceController | null = null) => {
	const navigate = useNavigate()
	const [isRecording, setRecording] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [localChunksCount, setLocalChunksCount] = useState(0)
	const [uploadedChunks, setUploadedChunks] = useState(0)
	const [expectedTotalChunks, setExpectedTotalChunks] = useState<number | null>(null)
	const [recordingTime, setRecordingTime] = useState(0)
	const [liveTranscript, setLiveTranscript] = useState('')
	const [transcribedChunks, setTranscribedChunks] = useState(0)
	const [audioSource, setAudioSource] = useState<AudioSource>('mic')
	const [includeMic, setIncludeMic] = useState(() => JSON.parse(localStorage.getItem('meetscribe_include_mic') ?? 'true'))
	const [selectedFile, setSelectedFile] = useState<File | null>(null)

	const [firstChunkProcessedTime, setFirstChunkProcessedTime] = useState<number | null>(null)
	const [transcriptionStartTime, setTranscriptionStartTime] = useState<number | null>(null)

	// --- NEW: Wake Lock state ---
	const [wakeLockStatus, setWakeLockStatus] = useState<'inactive' | 'active' | 'error'>('inactive')
	const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null)

	const meetingId = useRef<string | null>(null)
	// True while the current meeting is transcribed/diarized in the browser.
	const onDeviceActiveRef = useRef(false)
	/** Local mode as it was when this meeting started; the switch may move later. */
	const localModeRef = useRef(false)
	/** True while the meeting in flight is a local one. */
	const localMeetingRef = useRef(false)
	/** Recorder blobs held back from upload, so a consented fallback still can. */
	const pendingAudioRef = useRef<{ blob: Blob; index: number }[]>([])
	const mediaRef = useRef<MediaRecorder | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const displayStreamRef = useRef<MediaStream | null>(null)
	const micStreamRef = useRef<MediaStream | null>(null)
	const audioCtxRef = useRef<AudioContext | null>(null)
	const analyserRef = useRef<AnalyserNode | null>(null)
	const animationFrameRef = useRef<number | null>(null)
	const startTimeRef = useRef<number>(0)
	const timerRef = useRef<NodeJS.Timeout | null>(null)
	const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
	const chunkIndexRef = useRef(0)
	const isRecordingRef = useRef(false)
	useEffect(() => {
		isRecordingRef.current = isRecording
	}, [isRecording])

	// Which post-meeting stage the backend reports: 'diarizing' | 'summarizing'.
	const [processingStage, setProcessingStage] = useState<string | null>(null)
	const [processingTotal, setProcessingTotal] = useState<number | null>(null)

	const [isPaused, setIsPaused] = useState(false)
	const isPausedRef = useRef(false)
	useEffect(() => {
		isPausedRef.current = isPaused
	}, [isPaused])
	const pausedDurationRef = useRef<number>(0)
	const pausedAtRef = useRef<number | null>(null)
	const chunkTimerRef = useRef<NodeJS.Timeout | null>(null)
	const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		localStorage.setItem('meetscribe_include_mic', JSON.stringify(includeMic))
	}, [includeMic])

	const transcriptionSpeed = useMemo(() => {
		if (!transcriptionStartTime || transcribedChunks < 2) return null
		const elapsedSec = (Date.now() - transcriptionStartTime) / 1000
		if (elapsedSec <= 0) return null
		const audioDurationProcessed = (transcribedChunks - 1) * (CHUNK_DURATION_MS / 1000)
		return audioDurationProcessed / elapsedSec
	}, [transcriptionStartTime, transcribedChunks])

	const transcriptionSpeedLabel = useMemo(() => {
		if (!transcriptionSpeed) return null
		return `${transcriptionSpeed.toFixed(1)}x`
	}, [transcriptionSpeed])

	const resetState = () => {
		setRecording(false)
		setIsProcessing(false)
		setLocalChunksCount(0)
		setUploadedChunks(0)
		setExpectedTotalChunks(null)
		setRecordingTime(0)
		setLiveTranscript('')
		setTranscribedChunks(0)
		setFirstChunkProcessedTime(null)
		setTranscriptionStartTime(null)
		setProcessingStage(null)
		setProcessingTotal(null)
		chunkIndexRef.current = 0
		meetingId.current = null
		onDeviceActiveRef.current = false
		localMeetingRef.current = false
		pendingAudioRef.current = []
		setWakeLockStatus('inactive')
		setIsPaused(false)
		isPausedRef.current = false
		pausedDurationRef.current = 0
		pausedAtRef.current = null
		if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current)
		chunkTimerRef.current = null
		if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current)
		heartbeatIntervalRef.current = null
	}

	// A local meeting is never polled, so the live transcript has to come from
	// the on-device controller instead of the server's status payload.
	useEffect(() => {
		if (!localMeetingRef.current || !onDevice) return
		setLiveTranscript(onDevice.state.transcript)
		setTranscribedChunks(onDevice.state.transcription.done)
	}, [onDevice, onDevice?.state.transcript, onDevice?.state.transcription.done])

	const pollMeetingStatus = useCallback(async () => {
		if (!meetingId.current) return
		// A local meeting has no server row to poll. Its progress comes from
		// the on-device controller, and stopRecording navigates when it is done.
		if (localMeetingRef.current) return
		try {
			const res = await fetch(apiUrl(`/api/meetings/${meetingId.current}`))
			if (!res.ok) return
			const data = await res.json()

			setUploadedChunks(data.received_chunks ?? 0)
			setExpectedTotalChunks(data.expected_chunks ?? null)
			setLiveTranscript(data.transcript_text ?? '')
			setTranscribedChunks(data.transcribed_chunks ?? 0)
			setProcessingStage(data.processing_stage ?? null)
			setProcessingTotal(typeof data.processing_total === 'number' ? data.processing_total : null)

			if (data.transcribed_chunks === 1 && !firstChunkProcessedTime) {
				setFirstChunkProcessedTime(Date.now())
			} else if (data.transcribed_chunks > 1 && firstChunkProcessedTime && !transcriptionStartTime) {
				setTranscriptionStartTime(firstChunkProcessedTime)
			}

			if (data.done) {
				if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
				const finalMeetingId = meetingId.current // Grab the ID before we reset state
				resetState()
				if (finalMeetingId) {
					navigate(`/summary/${finalMeetingId}`, { replace: true })
				}
			} else if (!isRecordingRef.current) {
				setIsProcessing(true)
			}
		} catch (error) {
			console.error('Polling error:', error)
		}
	}, [navigate, firstChunkProcessedTime, transcriptionStartTime])

	const createMeetingOnBackend = useCallback(
		async (title: string, context: string) => {
			const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
			const useOnDeviceNow = !!onDevice?.isUsable

			// Local mode: no server row, no id from the server, no upload. The
			// browser mints the id so the meeting has a stable URL from the
			// first moment, exactly as a server-created one would.
			if (localModeRef.current && useOnDeviceNow) {
				const id = crypto.randomUUID()
				const startedAt = new Date().toISOString()
				const seed = {
					id,
					title,
					started_at: startedAt,
					context: context || null,
					summary_length: summaryLength,
					summary_language_mode: languageState.mode,
					// Only when the mode actually is 'custom'. The selector
					// remembers the last language picked in *any* meeting, so
					// writing it unconditionally stamped every recording with
					// a language nobody had chosen for it — invisible while
					// the mode stayed 'auto', and a summary in that language
					// the moment anything set the mode.
					summary_custom_language: languageState.mode === 'custom' ? languageState.lastCustomLanguage : null,
					timezone,
				}
				await seedLocalMeeting(seed)
				meetingId.current = id
				onDeviceActiveRef.current = true
				localMeetingRef.current = true
				// Start the ~3 GB summary download now rather than when the user
				// reaches the summary page. The meeting will run for far longer
				// than the download, so by the time there is a transcript the
				// model is usually already resident in the shared worker.
				preloadSummaryModel(getLocalSummaryModel())
				onDevice?.beginMeeting(id, createLocalSink(seed))
				return id
			}

			const res = await fetch(apiUrl(`/api/meetings`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title,
					summary_length: summaryLength,
					summary_language_mode: languageState.mode,
					summary_custom_language: languageState.mode === 'custom' ? languageState.lastCustomLanguage : null,
					context: context,
					timezone: timezone,
					client_processing: useOnDeviceNow,
				}),
			})
			if (!res.ok) throw new Error('Failed to create meeting')
			const data = await res.json()
			meetingId.current = data.id
			onDeviceActiveRef.current = useOnDeviceNow
			if (useOnDeviceNow) onDevice?.beginMeeting(data.id)
			saveMeeting({ id: data.id, title, started_at: new Date().toISOString(), status: 'pending', storage: 'cloud' })
			return data.id
		},
		[summaryLength, languageState, onDevice],
	)

	const uploadChunk = useCallback(async (blob: Blob, index: number, isFinal = false) => {
		if (!meetingId.current) return
		// A local meeting keeps its audio. The blobs are held in memory for the
		// session so a consented fallback can still upload them, and are dropped
		// when the meeting finishes.
		if (localMeetingRef.current) {
			if (!isFinal) pendingAudioRef.current.push({ blob, index })
			return
		}
		const fd = new FormData()
		fd.append('meeting_id', meetingId.current)
		fd.append('chunk_index', String(index))
		fd.append('file', blob, `chunk-${index}.webm`)
		fd.append('is_final', String(isFinal))
		try {
			await fetch(apiUrl(`/api/chunks`), { method: 'POST', body: fd })
		} catch (error) {
			console.error(`Failed to upload chunk ${index}:`, error)
		}
	}, [])

	const updateContext = useCallback(async (newContext: string) => {
		if (!meetingId.current) return
		try {
			await fetch(apiUrl(`/api/meetings/${meetingId.current}/context`), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ context: newContext }),
			})
		} catch (error) {
			console.error('Failed to update context:', error)
		}
	}, [])

	const updateMeetingConfig = useCallback(async (config: Partial<SummaryLanguageState & { summaryLength: SummaryLength }>) => {
		if (!meetingId.current) return

		const payload = {
			summary_length: config.summaryLength,
			summary_language_mode: config.mode,
			// Same rule as the seed: a remembered language is not a chosen one.
			summary_custom_language: config.mode === 'custom' ? config.lastCustomLanguage : null,
		}

		try {
			await fetch(apiUrl(`/api/meetings/${meetingId.current}/config`), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
		} catch (error) {
			console.error('Failed to update meeting config:', error)
		}
	}, [])

	const stopRecording = useCallback(
		async (isFinal: boolean = true) => {
			// Clear pause-related timers first
			if (heartbeatIntervalRef.current) {
				clearInterval(heartbeatIntervalRef.current)
				heartbeatIntervalRef.current = null
			}
			if (chunkTimerRef.current) {
				clearTimeout(chunkTimerRef.current)
				chunkTimerRef.current = null
			}
			// Stop recorder regardless of whether it's recording or paused
			if (mediaRef.current && mediaRef.current.state !== 'inactive') {
				mediaRef.current.stop()
			}
			if (isFinal) {
				setIsPaused(false)
				isPausedRef.current = false
				pausedDurationRef.current = 0
				pausedAtRef.current = null
				setRecording(false)
				setIsProcessing(true)

				if (wakeLockSentinelRef.current) {
					await wakeLockSentinelRef.current.release()
					wakeLockSentinelRef.current = null
				}
				setWakeLockStatus('inactive')

				streamRef.current?.getTracks().forEach((track) => track.stop())
				displayStreamRef.current?.getTracks().forEach((track) => track.stop())
				micStreamRef.current?.getTracks().forEach((track) => track.stop())
				streamRef.current = null
				displayStreamRef.current = null
				micStreamRef.current = null

				if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
				if (audioCtxRef.current) {
					await audioCtxRef.current.close()
					audioCtxRef.current = null
				}
				animationFrameRef.current = null
				analyserRef.current = null

				if (timerRef.current) {
					clearInterval(timerRef.current)
					timerRef.current = null
				}
				await new Promise((resolve) => setTimeout(resolve, 500))
				const finalBlob = new Blob([], { type: mediaRef.current?.mimeType || 'audio/webm' })
				await uploadChunk(finalBlob, chunkIndexRef.current, true)

				// On-device: wait for the last chunks, identify speakers and
				// hand the transcript over. Polling then sees the summary
				// exactly as it would for a server-processed meeting.
				if (onDeviceActiveRef.current && onDevice) {
					await onDevice.finish()
					// A local meeting is never polled, so nothing else would move
					// the user on. The summary page runs the model from here.
					if (localMeetingRef.current) {
						const id = meetingId.current
						if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
						resetState()
						if (id) navigate(`/summary/${id}`, { replace: true })
					}
				}
			}
		},
		[uploadChunk, onDevice, navigate, resetState],
	)

	const pauseRecording = useCallback(() => {
		if (!isPausedRef.current && mediaRef.current && mediaRef.current.state === 'recording') {
			mediaRef.current.pause()
			setIsPaused(true)
			isPausedRef.current = true
			pausedAtRef.current = Date.now()
			if (timerRef.current) clearInterval(timerRef.current)
			timerRef.current = null
			if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current)
			chunkTimerRef.current = null
			heartbeatIntervalRef.current = setInterval(async () => {
				if (!meetingId.current || localMeetingRef.current) return
				try {
					await fetch(apiUrl(`/api/meetings/${meetingId.current}/heartbeat`), { method: 'POST' })
				} catch {
					// Silently ignore — one missed heartbeat is within the safety margin
				}
			}, 90_000)
		}
	}, [])

	const resumeRecording = useCallback(() => {
		if (isPausedRef.current && mediaRef.current && mediaRef.current.state === 'paused') {
			mediaRef.current.resume()
			if (pausedAtRef.current !== null) {
				pausedDurationRef.current += Date.now() - pausedAtRef.current
				pausedAtRef.current = null
			}
			setIsPaused(false)
			isPausedRef.current = false
			if (heartbeatIntervalRef.current) {
				clearInterval(heartbeatIntervalRef.current)
				heartbeatIntervalRef.current = null
			}
			timerRef.current = setInterval(() => {
				setRecordingTime(Math.floor((Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000))
			}, 1000)
			const recorderAtResume = mediaRef.current
			chunkTimerRef.current = setTimeout(() => {
				if (recorderAtResume && recorderAtResume.state === 'recording') recorderAtResume.stop()
			}, CHUNK_DURATION_MS)
		}
	}, [])

	const startLiveRecording = useCallback(
		async (source: 'mic' | 'system', drawWaveform: () => void, initialContext: string) => {
			// Read once, here: flipping the switch mid-recording must not move a
			// meeting that is already under way.
			localModeRef.current = isLocalMode()
			resetState()
			let finalStream: MediaStream
			try {
				// --- NEW: Request Wake Lock ---
				if ('wakeLock' in navigator) {
					try {
						wakeLockSentinelRef.current = await navigator.wakeLock.request('screen')
						setWakeLockStatus('active')
						wakeLockSentinelRef.current.onrelease = () => {
							// The lock was released by the browser (e.g., user switched tabs).
							// It will be re-acquired on visibility change if recording is still active.
							wakeLockSentinelRef.current = null
						}
					} catch (err: unknown) {
						// This can happen if the document is not visible, etc.
						console.error('Failed to acquire screen wake lock:', err)
						setWakeLockStatus('error')
					}
				} else {
					console.warn('Screen Wake Lock API not supported on this browser.')
					setWakeLockStatus('error')
				}

				if (source === 'system') {
					const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false } })
					displayStreamRef.current = displayStream
					displayStream.getVideoTracks()[0].onended = () => {
						if (isRecordingRef.current) stopRecording()
					}

					const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
					micStreamRef.current = micStream
					micStream.getAudioTracks()[0].enabled = includeMic

					audioCtxRef.current = new AudioContext()
					const dest = audioCtxRef.current.createMediaStreamDestination()
					if (displayStream.getAudioTracks().length > 0) {
						audioCtxRef.current.createMediaStreamSource(displayStream).connect(dest)
					}
					audioCtxRef.current.createMediaStreamSource(micStream).connect(dest)
					finalStream = dest.stream
				} else {
					finalStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } })
					micStreamRef.current = finalStream
				}

				streamRef.current = finalStream
				if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
				const sourceNode = audioCtxRef.current.createMediaStreamSource(finalStream)
				analyserRef.current = audioCtxRef.current.createAnalyser()
				sourceNode.connect(analyserRef.current)

				setRecording(true)
				startTimeRef.current = Date.now()
				await createMeetingOnBackend(`Recording ${new Date().toLocaleString()}`, initialContext)

				pollIntervalRef.current = setInterval(pollMeetingStatus, 3000)
				timerRef.current = setInterval(() => {
					setRecordingTime(Math.floor((Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000))
				}, 1000)

				const createAndStartRecorder = () => {
					if (!streamRef.current) return
					const recorder = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm; codecs=opus' })
					mediaRef.current = recorder
					recorder.ondataavailable = (e) => {
						if (e.data.size > 0) {
							const index = chunkIndexRef.current++
							uploadChunk(e.data, index)
							if (onDeviceActiveRef.current) onDevice?.addChunk(e.data, index)
							setLocalChunksCount((c) => c + 1)
						}
					}
					recorder.onstop = () => {
						if (isRecordingRef.current) createAndStartRecorder()
					}
					recorder.start()
					chunkTimerRef.current = setTimeout(() => {
						if (recorder.state === 'recording') recorder.stop()
					}, CHUNK_DURATION_MS)
				}
				createAndStartRecorder()
				drawWaveform()
			} catch (err) {
				console.error('Failed to start recording:', err)
				alert('Could not start recording. Please check permissions.')
				// Make sure to clean up if start fails
				if (wakeLockSentinelRef.current) {
					wakeLockSentinelRef.current.release()
					wakeLockSentinelRef.current = null
				}
				resetState()
			}
		},
		[createMeetingOnBackend, includeMic, pollMeetingStatus, stopRecording, uploadChunk, onDevice],
	)

	const startFileProcessing = useCallback(
		async (initialContext: string) => {
			if (!selectedFile) return
			resetState()
			setIsProcessing(true)
			try {
				const createdId = await createMeetingOnBackend(`Transcription of ${selectedFile.name}`, initialContext)
				const target = createdId ?? meetingId.current

				// Upload the file as-is. It used to be decoded, sliced into 30s
				// pieces and re-encoded through a MediaRecorder in the browser —
				// which runs in real time, so an hour of audio took over an hour
				// before anything reached the server. The backend now transcribes
				// it in large batches instead.
				const body = new FormData()
				body.append('file', selectedFile, selectedFile.name)
				const res = await fetch(apiUrl(`/api/meetings/${target}/upload`), { method: 'POST', body })
				if (!res.ok) {
					const detail = await res.json().catch(() => ({}))
					throw new Error(detail.detail || 'Upload failed')
				}

				setUploadedChunks(1)
				setExpectedTotalChunks(1)
				pollIntervalRef.current = setInterval(pollMeetingStatus, 3000)
			} catch (err) {
				console.error('File processing failed:', err)
				alert(err instanceof Error ? err.message : 'Failed to process the audio file.')
				if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
				resetState()
			}
		},
		[selectedFile, createMeetingOnBackend, pollMeetingStatus],
	)

	useEffect(() => {
		if (includeMic && isRecording && audioSource === 'system' && micStreamRef.current) {
			micStreamRef.current.getAudioTracks()[0].enabled = includeMic
		}
	}, [includeMic, isRecording, audioSource])

	// --- NEW: Handle visibility change to re-acquire wake lock ---
	useEffect(() => {
		const handleVisibilityChange = async () => {
			if (wakeLockSentinelRef.current !== null || document.visibilityState !== 'visible') {
				return
			}
			// If recording is still active and the lock was released, try to re-acquire it.
			if (isRecordingRef.current && 'wakeLock' in navigator) {
				try {
					wakeLockSentinelRef.current = await navigator.wakeLock.request('screen')
					setWakeLockStatus('active')
					wakeLockSentinelRef.current.onrelease = () => {
						wakeLockSentinelRef.current = null
					}
				} catch (err: unknown) {
					console.error('Failed to re-acquire screen wake lock:', err)
					setWakeLockStatus('error')
				}
			}
		}

		document.addEventListener('visibilitychange', handleVisibilityChange)
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange)
		}
	}, [])

	useEffect(() => {
		return () => {
			if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
			if (timerRef.current) clearInterval(timerRef.current)
			if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
			if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current)
			if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current)
			if (wakeLockSentinelRef.current) {
				wakeLockSentinelRef.current.release()
			}
		}
	}, [])

	return {
		isRecording,
		isProcessing,
		localChunksCount,
		uploadedChunks,
		expectedTotalChunks,
		recordingTime,
		liveTranscript,
		transcribedChunks,
		audioSource,
		setAudioSource,
		includeMic,
		setIncludeMic,
		selectedFile,
		setSelectedFile,
		startLiveRecording,
		stopRecording,
		isPaused,
		pauseRecording,
		resumeRecording,
		startFileProcessing,
		transcriptionSpeedLabel,
		processingStage: onDevice?.localStage ?? processingStage,
		processingTotal: onDevice?.localStage ? 2 : processingTotal,
		analyserRef,
		animationFrameRef,
		updateContext,
		updateMeetingConfig,
		resetState,
		wakeLockStatus,
	}
}
