import React, { useRef, useState, useEffect, useCallback, useMemo, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { getHistory, MeetingMeta, saveMeeting } from '../utils/history'
import ThemeToggle from '../components/ThemeToggle';
import { ThemeContext } from '../contexts/ThemeContext';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme';

type AudioSource = 'mic' | 'system' | 'file'

export default function Record() {
	const navigate = useNavigate()
	const themeContext = useContext(ThemeContext);
	if (!themeContext) throw new Error("ThemeContext not found");
	const { theme } = themeContext;
	const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;

	/* ─── history list ──────────────────────────────────────────────── */
	const [history, setHistory] = useState<MeetingMeta[]>([])
	useEffect(() => {
		setHistory(getHistory())
	}, [])
	const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null)
	const [editingTitle, setEditingTitle] = useState<string>('')
	const [hoveredMeetingId, setHoveredMeetingId] = useState<string | null>(null)

	/* ─── recording state ───────────────────────────────────────────── */
	const [isRecording, setRecording] = useState(false)
	const [localChunksCount, setLocalChunksCount] = useState(0) // total chunks sent from client
	const [uploadedChunks, setUploadedChunks] = useState(0) // chunks received by backend
	const [expectedTotalChunks, setExpectedTotalChunks] = useState<number | null>(null) // total expected chunks
	const [recordingTime, setRecordingTime] = useState(0)
	const [isProcessing, setIsProcessing] = useState(false)
	const [liveTranscript, setLiveTranscript] = useState('')
	const [transcribedChunks, setTranscribedChunks] = useState(0)
	const [pollingStarted, setPollingStarted] = useState(false)
	const [audioSource, setAudioSource] = useState<AudioSource>('mic')
	const [isSystemAudioSupported, setIsSystemAudioSupported] = useState(true)

	/* ─── new state for file upload ─────────────────────────────────── */
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [isDragging, setIsDragging] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)

	/* ─── waveform metering ─────────────────────────────────────────── */
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const audioCtxRef = useRef<AudioContext | null>(null)
	const analyserRef = useRef<AnalyserNode | null>(null)
	const animationFrameRef = useRef<number | null>(null)

	/* ─── resize canvas on mount & window resize ──────────────────── */
	useEffect(() => {
		const resize = () => {
			const c = canvasRef.current
			if (!c) return
			c.width = c.clientWidth
			c.height = c.clientHeight
		}
		resize()
		window.addEventListener('resize', resize)
		return () => {
			window.removeEventListener('resize', resize)
		}
	}, [])

	/* ─── draw waveform loop ───────────────────────────────────────── */
	const drawWaveform = useCallback(() => {
		const canvas = canvasRef.current
		const analyser = analyserRef.current
		if (!canvas || !analyser) return

		const ctx = canvas.getContext('2d')
		if (!ctx) return

		const bufferLength = analyser.fftSize
		const dataArray = new Uint8Array(bufferLength)
		analyser.getByteTimeDomainData(dataArray)

		ctx.clearRect(0, 0, canvas.width, canvas.height)
		ctx.lineWidth = 2
		// Use theme-dependent stroke style
		ctx.strokeStyle = theme === 'light' ? 'rgba(239,68,68,0.3)' : 'rgba(255, 100, 100, 0.4)';
		ctx.beginPath()

		const sliceWidth = canvas.width / bufferLength
		let x = 0
		const centerY = canvas.height / 2
		for (let i = 0; i < bufferLength; i++) {
			const v = dataArray[i] / 128.0
			const deviation = (v - 1) * centerY * 4 // 4× vertical amplification
			const y = centerY + deviation
			if (i === 0) ctx.moveTo(x, y)
			else ctx.lineTo(x, y)
			x += sliceWidth
		}
		ctx.lineTo(canvas.width, centerY)
		ctx.stroke()

		animationFrameRef.current = requestAnimationFrame(drawWaveform)
	}, [theme]) // Added theme as a dependency

	// Track when the first chunk was transcribed (for speed calculation)
	const [transcriptionStartTime, setTranscriptionStartTime] = useState<number | null>(null)
	const [firstChunkProcessedTime, setFirstChunkProcessedTime] = useState<number | null>(null)
	const CHUNK_DURATION = 30 // seconds per non-header chunk

	const meetingId = useRef<string | null>(null)
	const mediaRef = useRef<MediaRecorder | null>(null)
	const streamRef = useRef<MediaStream | null>(null) // Will hold the stream for the recorder (can be audio-only)
	const displayStreamRef = useRef<MediaStream | null>(null) // Will hold the original getDisplayMedia stream
	const startTimeRef = useRef<number>(0)
	const timerRef = useRef<NodeJS.Timeout | null>(null)
	const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
	const chunkIndexRef = useRef(0)
	const isRecordingRef = useRef(false)

	useEffect(() => {
		isRecordingRef.current = isRecording
	}, [isRecording])

	useEffect(() => {
		if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
			setIsSystemAudioSupported(false)
			return
		}
		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
		if (isIOS) {
			setIsSystemAudioSupported(false)
		}
	}, [])

	/* ─── detect first transcribed chunk ───────────────────────────── */
	useEffect(() => {
		if (transcribedChunks === 1 && firstChunkProcessedTime === null) {
			setFirstChunkProcessedTime(Date.now())
		} else if (transcribedChunks > 1 && transcriptionStartTime === null && firstChunkProcessedTime !== null) {
			setTranscriptionStartTime(firstChunkProcessedTime)
		}
	}, [transcribedChunks, firstChunkProcessedTime, transcriptionStartTime])

	/* ─── compute transcription speed ───────────────────────────────── */
	const transcriptionSpeed = useMemo(() => {
		if (transcriptionStartTime === null || transcribedChunks < 2) return null
		const elapsedSec = (Date.now() - transcriptionStartTime) / 1000
		if (elapsedSec <= 0) return null
		const audioDurationProcessedSinceStartTime = (transcribedChunks - 1) * CHUNK_DURATION
		return audioDurationProcessedSinceStartTime / elapsedSec
	}, [transcriptionStartTime, transcribedChunks])

	const transcriptionSpeedLabel = useMemo(() => {
		if (transcriptionSpeed === null) return null
		const rounded = (Math.round(transcriptionSpeed * 10) / 10).toFixed(1)
		return `${rounded}x`
	}, [transcriptionSpeed])

	/* ─── polling for meeting status, transcript, summary ───────── */
	const pollMeetingStatus = useCallback(async () => {
		if (!meetingId.current) return
		try {
			const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${meetingId.current}`)
			if (!res.ok) {
				console.warn('Polling: Failed to fetch meeting status')
				return
			}
			const data = await res.json()

			if (typeof data.received_chunks === 'number') {
				setUploadedChunks(data.received_chunks)
			}
			if (data.expected_chunks !== null && typeof data.expected_chunks === 'number') {
				setExpectedTotalChunks(data.expected_chunks)
			}
			if (data.transcript_text && data.transcript_text !== liveTranscript) {
				setLiveTranscript(data.transcript_text)
			}
			if (typeof data.transcribed_chunks === 'number') {
				setTranscribedChunks(data.transcribed_chunks)
			}

			if (data.done) {
				if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
				setIsProcessing(false)
				navigate(`/summary/${meetingId.current}`)
			} else {
				if (!isRecording && meetingId.current) {
					setIsProcessing(true)
				}
			}
		} catch (error) {
			console.error('Polling error:', error)
		}
	}, [navigate, liveTranscript, isRecording])

	/* ─── timer effect ──────────────────────────────────────────────── */
	useEffect(() => {
		if (isRecording) {
			timerRef.current = setInterval(() => {
				setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000))
			}, 1000)
		} else if (timerRef.current) {
			clearInterval(timerRef.current)
			timerRef.current = null
		}
		return () => {
			if (timerRef.current) clearInterval(timerRef.current)
		}
	}, [isRecording])

	/* ─── helpers ───────────────────────────────────────────────────── */
	const handleTitleChange = useCallback(async () => {
		if (!editingMeetingId) return

		const currentMeeting = history.find(m => m.id === editingMeetingId)
		if (!currentMeeting) {
			setEditingMeetingId(null)
			return
		}

		if (editingTitle.trim() === '' || editingTitle.trim() === currentMeeting.title) {
			setEditingMeetingId(null)
			setEditingTitle('')
			return
		}

		try {
			const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings/${editingMeetingId}/title`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: editingTitle.trim() }),
			})

			if (!response.ok) {
				const errorData = await response.json()
				throw new Error(errorData.detail || 'Failed to update title')
			}

			const updatedMeetingFromServer = await response.json() // This is the full Meeting object from backend

			// Prepare the updated MeetingMeta object for both state and localStorage
			const updatedMeetingMeta: MeetingMeta = {
				id: currentMeeting.id, // or updatedMeetingFromServer.id, should be the same
				title: updatedMeetingFromServer.title,
				started_at: updatedMeetingFromServer.started_at || currentMeeting.started_at, // Prefer server's started_at, fallback to current
				status: currentMeeting.status, // Preserve the original status
			};

			// Update history state
			setHistory(prevHistory =>
				prevHistory.map(h =>
					h.id === editingMeetingId ? updatedMeetingMeta : h
				)
			);

			// Persist to localStorage
			saveMeeting(updatedMeetingMeta);


		} catch (error) {
			console.error('Error updating meeting title:', error)
			alert(`Error updating title: ${error instanceof Error ? error.message : String(error)}`)
			// Optionally, revert editingTitle to currentMeeting.title or leave as is for user to retry
		} finally {
			setEditingMeetingId(null)
			setEditingTitle('')
		}
	}, [editingMeetingId, editingTitle, history])


	const createMeetingOnBackend = useCallback(async (titleOverride?: string) => {
		const title = titleOverride || `Recording ${new Date().toLocaleString()}`
		const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/meetings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title }),
		})
		if (!res.ok) throw new Error('Failed to create meeting on backend')
		const data = await res.json()
		meetingId.current = data.id

		saveMeeting({
			id: data.id,
			title,
			started_at: new Date().toISOString(),
			status: 'pending',
		})
		setHistory(getHistory())
		return data.id
	}, [])

	const uploadChunk = useCallback(async (blob: Blob, index: number, isFinal = false) => {
		if (!meetingId.current) {
			console.error('No meeting ID, cannot upload chunk')
			return false
		}

		const fd = new FormData()
		fd.append('meeting_id', meetingId.current)
		fd.append('chunk_index', String(index))
		fd.append('file', blob, `chunk-${index}.webm`)
		fd.append('is_final', String(isFinal))

		try {
			const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/chunks`, {
				method: 'POST',
				body: fd,
			})
			const result = await response.json()

			if (result.ok) {
				if (typeof result.received_chunks === 'number') {
					setUploadedChunks(result.received_chunks)
				}
				if (result.expected_chunks !== null && typeof result.expected_chunks === 'number') {
					setExpectedTotalChunks(result.expected_chunks)
				}
			} else {
				console.error(`Failed to upload chunk ${index}:`, result.detail || 'Unknown error')
			}
			return result.ok
		} catch (error) {
			console.error(`Network or other error uploading chunk ${index}:`, error)
			return false
		}
	}, [])

	/* ─── recording control ─────────────────────────────────────────── */
	const CHUNK_LENGTH_MS = 30_000 // 30-second slices

	function createAndStartRecorder() {
		// 1. Make sure we still have a stream
		if (!streamRef.current) return

		/* 2. Pick a mime-type the UA will accept */
		let mimeType = 'audio/webm; codecs=opus'
		if (!MediaRecorder.isTypeSupported(mimeType)) {
			try {
				mimeType = new MediaRecorder(streamRef.current).mimeType // fallback
			} catch {
				alert('MediaRecorder is not supported with any available audio format.')
				return
			}
		}

		/* 3. Spin up a brand-new recorder */
		const recorder = new MediaRecorder(streamRef.current, {
			mimeType,
			audioBitsPerSecond: 256000,
		})
		mediaRef.current = recorder // keep a handle to the current one

		/* 4. Upload each blob we receive */
		recorder.ondataavailable = (e) => {
			if (e.data.size) {
				uploadChunk(e.data, chunkIndexRef.current++).catch(console.error)
				setLocalChunksCount((c) => c + 1)
			}
		}

		/* 5. When this recorder stops, immediately start the next one
		 *if* the user is still recording */
		recorder.onstop = () => {
			if (isRecordingRef.current && streamRef.current) {
				createAndStartRecorder() // recurse → new recorder
			}
		}

		/* 6. Kick it off, then schedule a stop in 10 s */
		recorder.start() // no timeslice
		setTimeout(() => {
			if (recorder.state === 'recording') {
				recorder.stop() // triggers ondataavailable + onstop
			}
		}, CHUNK_LENGTH_MS)
	}

	function clearWaveformCanvas() {
		const canvas = canvasRef.current
		if (canvas) {
			const ctx = canvas.getContext('2d')
			if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
		}
	}

	async function start() {
		let audioStream: MediaStream
		try {
			if (audioSource === 'system') {
				if (!isSystemAudioSupported) {
					alert('System audio recording is not supported on your device or browser.')
					return
				}
				const displayStream = await navigator.mediaDevices.getDisplayMedia({
					video: true,
					audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
				})
				displayStreamRef.current = displayStream

				if (displayStream.getAudioTracks().length === 0) {
					displayStream.getTracks().forEach((track) => track.stop())
					displayStreamRef.current = null
					alert("System audio access was not granted. Please check the 'Share system audio' or 'Share tab audio' box in the prompt and try again.")
					return
				}

				displayStream.getVideoTracks()[0].addEventListener('ended', () => {
					if (isRecordingRef.current) stop()
				})

				audioStream = new MediaStream(displayStream.getAudioTracks())
			} else {
				audioStream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: false,
						noiseSuppression: false,
						autoGainControl: false,
						voiceIsolation: false, // Use your supported constraint
						channelCount: 1,
						latency: 0,
						volume: 1.0, // If supported, maximize input
					},
				})
			}

			audioCtxRef.current = new AudioContext({ sampleRate: 48000 })
			const sourceNode = audioCtxRef.current.createMediaStreamSource(audioStream)
			analyserRef.current = audioCtxRef.current.createAnalyser()
			analyserRef.current.fftSize = 2048
			sourceNode.connect(analyserRef.current)

			streamRef.current = audioStream

			setLocalChunksCount(0)
			setUploadedChunks(0)
			setExpectedTotalChunks(null)
			setTranscribedChunks(0)
			setRecordingTime(0)
			setLiveTranscript('')
			setTranscriptionStartTime(null)
			setFirstChunkProcessedTime(null)
			chunkIndexRef.current = 0
			setIsProcessing(false)
			meetingId.current = null
			setPollingStarted(false)

			setRecording(true)
			startTimeRef.current = Date.now()
			const newId = await createMeetingOnBackend()
			meetingId.current = newId

			await pollMeetingStatus()
			if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
			pollIntervalRef.current = setInterval(pollMeetingStatus, 3000)
			setPollingStarted(true)

			drawWaveform()
			createAndStartRecorder()
		} catch (error) {
			console.error('Failed to start recording:', error)
			if (error instanceof DOMException && error.name === 'NotAllowedError') {
				alert('Recording permission was denied. Please allow access and try again.')
			} else {
				alert('Failed to start recording. Please check the console for errors.')
			}
			setRecording(false)
		}
	}

	async function stop() {
		if (!mediaRef.current || !meetingId.current) return
		setRecording(false)
		setIsProcessing(true)

		if (mediaRef.current.state === 'recording') {
			mediaRef.current.stop()
		}
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop())
			streamRef.current = null
		}
		if (displayStreamRef.current) {
			displayStreamRef.current.getTracks().forEach((track) => track.stop())
			displayStreamRef.current = null
		}

		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current)
			animationFrameRef.current = null
		}
		if (audioCtxRef.current) {
			await audioCtxRef.current.close()
			audioCtxRef.current = null
			analyserRef.current = null
		}

		clearWaveformCanvas()

		await new Promise((resolve) => setTimeout(resolve, 500))
		const finalBlob = new Blob([], { type: mediaRef.current.mimeType || 'audio/webm' })
		await uploadChunk(finalBlob, chunkIndexRef.current, true)
	}

	/* ─── new file upload logic ─────────────────────────────────────── */
	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file) {
			setSelectedFile(file)
		}
		e.target.value = '' // Allow re-selecting the same file
	}

	const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault()
		setIsDragging(false)
		const file = e.dataTransfer.files?.[0]
		if (file && file.type.startsWith('audio/')) {
			setSelectedFile(file)
		} else {
			alert('Please drop a valid audio file.')
		}
	}

	const encodeAudioChunk = (chunkBuffer: AudioBuffer): Promise<Blob> => {
		return new Promise((resolve, reject) => {
			const audioCtx = new AudioContext({ sampleRate: chunkBuffer.sampleRate })
			const source = audioCtx.createBufferSource()
			source.buffer = chunkBuffer

			const dest = audioCtx.createMediaStreamDestination()
			source.connect(dest)

			const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm; codecs=opus' })
			const chunks: Blob[] = []

			recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
			recorder.onstop = () => {
				const blob = new Blob(chunks, { type: 'audio/webm; codecs=opus' })
				resolve(blob)
				audioCtx.close().catch(console.error)
			}
			recorder.onerror = (e) => {
				reject(e)
				audioCtx.close().catch(console.error)
			}
			source.onended = () => recorder.stop()

			recorder.start()
			source.start(0)
		})
	}

	const processAndUploadFile = async (file: File, mId: string) => {
		const audioCtx = new AudioContext()
		try {
			const arrayBuffer = await file.arrayBuffer()
			const originalBuffer = await audioCtx.decodeAudioData(arrayBuffer)

			const CHUNK_DURATION_S = 30
			const totalDurationS = originalBuffer.duration
			const numChunks = Math.ceil(totalDurationS / CHUNK_DURATION_S)
			setExpectedTotalChunks(numChunks)

			// Process and upload main chunks
			for (let i = 0; i < numChunks; i++) {
				const startS = i * CHUNK_DURATION_S
				const endS = Math.min(startS + CHUNK_DURATION_S, totalDurationS)
				if (endS - startS <= 0) continue

				const startSample = Math.floor(startS * originalBuffer.sampleRate)
				const endSample = Math.floor(endS * originalBuffer.sampleRate)
				const chunkSampleLength = endSample - startSample
				const chunkBuffer = audioCtx.createBuffer(originalBuffer.numberOfChannels, chunkSampleLength, originalBuffer.sampleRate)

				for (let ch = 0; ch < originalBuffer.numberOfChannels; ch++) {
					chunkBuffer.getChannelData(ch).set(originalBuffer.getChannelData(ch).subarray(startSample, endSample))
				}

				const chunkBlob = await encodeAudioChunk(chunkBuffer)
				const isFinal = i === numChunks - 1
				await uploadChunk(chunkBlob, chunkIndexRef.current++, isFinal)
				setLocalChunksCount((prev) => prev + 1)
			}
		} finally {
			await audioCtx.close()
		}
	}

	const handleStartFileProcessing = async () => {
		if (!selectedFile) return

		// Reset state
		setLocalChunksCount(0)
		setUploadedChunks(0)
		setExpectedTotalChunks(null)
		setTranscribedChunks(0)
		setRecordingTime(0)
		setLiveTranscript('')
		setTranscriptionStartTime(null)
		setFirstChunkProcessedTime(null)
		chunkIndexRef.current = 0
		meetingId.current = null
		setPollingStarted(false)
		setRecording(false)
		setIsProcessing(true)

		try {
			const newId = await createMeetingOnBackend(`Transcription of ${selectedFile.name}`)
			meetingId.current = newId

			await pollMeetingStatus()
			if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
			pollIntervalRef.current = setInterval(pollMeetingStatus, 3000)
			setPollingStarted(true)

			await processAndUploadFile(selectedFile, newId)
		} catch (error) {
			console.error('Failed to process file:', error)
			alert(`An error occurred: ${error instanceof Error ? error.message : String(error)}`)
			setIsProcessing(false)
			if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
		}
	}
	/* ───────────────────────────────────────────────────────────────── */

	useEffect(() => {
		return () => {
			if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
			if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
			if (audioCtxRef.current) audioCtxRef.current.close()
		}
	}, [])

	const formatTime = (seconds: number) => {
		const mins = Math.floor(seconds / 60)
		const secs = seconds % 60
		return `${mins}:${secs.toString().padStart(2, '0')}`
	}

	const realLocal = localChunksCount
	const realUploaded = uploadedChunks
	const realTotal = expectedTotalChunks !== null ? expectedTotalChunks : realLocal

	const getUploadProgressPercentage = () => (realTotal === 0 ? 0 : Math.min(100, (realUploaded / realTotal) * 100))
	const getTranscriptionProgressPercentage = () => (realTotal === 0 ? 0 : Math.min(100, (transcribedChunks / realTotal) * 100))
	const allChunksUploaded = realTotal > 0 && realUploaded >= realTotal

	const isUiLocked = isRecording || isProcessing

	return (
		<div style={{ padding: 24, maxWidth: 800, margin: '0 auto', fontFamily: '"Inter", sans-serif' /* backgroundColor and color are inherited from body */ }}>
			<ThemeToggle />
			<h1 style={{ textAlign: 'center', marginBottom: '24px', color: currentThemeColors.text }}>🎙️ MeetScribe</h1>

			{!isUiLocked && (
				<div style={{ marginBottom: '24px' }}>
					<div style={{ textAlign: 'center', marginBottom: '16px' }}>
						<label htmlFor="audio-source-select" style={{ marginRight: '10px', fontWeight: 500, color: currentThemeColors.text }}>
							Audio Source:
						</label>
						<select
							id="audio-source-select"
							value={audioSource}
							onChange={(e) => {
								setAudioSource(e.target.value as AudioSource)
								setSelectedFile(null)
							}}
							style={{
								padding: '8px 12px',
								borderRadius: '6px',
								border: `1px solid ${currentThemeColors.input.border}`,
								fontSize: '16px',
								backgroundColor: currentThemeColors.input.background,
								color: currentThemeColors.input.text,
							}}>
							<option value="mic">Microphone</option>
							<option value="system">System Audio (Speakers)</option>
							<option value="file">Upload Audio File</option>
						</select>
					</div>

					{audioSource === 'system' && !isSystemAudioSupported && (
						<div
							style={{
								padding: '12px',
								backgroundColor: currentThemeColors.backgroundSecondary, // Example: Or a specific warning background
								border: `1px solid ${currentThemeColors.border}`, // Example: Or a specific warning border
								color: currentThemeColors.text, // Example: Or a specific warning text
								borderRadius: '8px',
								textAlign: 'center'
							}}>
							⚠️ System audio recording is not supported on your device or browser (e.g., iPhones/iPads). This option is unlikely to work.
						</div>
					)}
					{audioSource === 'system' && isSystemAudioSupported && (
						<div
							style={{
								padding: '12px',
								backgroundColor: currentThemeColors.backgroundSecondary, // Example: Or a specific info background
								border: `1px solid ${currentThemeColors.border}`, // Example: Or a specific info border
								color: currentThemeColors.text,
								borderRadius: '8px',
								textAlign: 'center',
								fontSize: '14px',
								lineHeight: 1.5,
							}}>
							ℹ️ When prompted, choose a screen, window, or tab to share. <br />
							<b>Crucially, ensure you check the "Share system audio" or "Share tab audio" box</b> to record sound.
						</div>
					)}
					{audioSource === 'file' && (
						<div
							onDragEnter={(e) => {
								e.preventDefault()
								setIsDragging(true)
							}}
							onDragLeave={(e) => {
								e.preventDefault()
								setIsDragging(false)
							}}
							onDragOver={(e) => e.preventDefault()}
							onDrop={handleFileDrop}
							onClick={() => fileInputRef.current?.click()}
							style={{
								border: `2px dashed ${isDragging ? currentThemeColors.button.primary : currentThemeColors.input.border}`,
								borderRadius: '8px',
								padding: '32px',
								textAlign: 'center',
								cursor: 'pointer',
								backgroundColor: isDragging ? currentThemeColors.backgroundSecondary : currentThemeColors.background,
								color: currentThemeColors.text,
								transition: 'all 0.2s ease',
							}}>
							<input ref={fileInputRef} type="file" hidden onChange={handleFileSelect} accept="audio/mp3,audio/wav,audio/aac,audio/ogg,audio/m4a" />
							<p style={{ margin: 0, fontWeight: 500, color: currentThemeColors.text }}>
								{selectedFile ? `Selected: ${selectedFile.name}` : 'Drag & drop an audio file, or click to select'}
							</p>
							<p style={{ margin: '4px 0 0', fontSize: '14px', color: currentThemeColors.secondaryText }}>MP3, WAV, AAC, etc. are supported</p>
						</div>
					)}
				</div>
			)}

			{isRecording && (
				<div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 'bold', color: currentThemeColors.button.danger, marginBottom: '16px' }}>⏱️ {formatTime(recordingTime)}</div>
			)}

			{(isUiLocked || localChunksCount > 0) && (
				<div style={{ marginBottom: '24px' }}>
					<div
						style={{
							width: '100%',
							height: '20px',
							backgroundColor: currentThemeColors.backgroundSecondary,
							borderRadius: '10px',
							overflow: 'hidden',
							position: 'relative',
							marginBottom: '8px',
						}}>
						<div // Uploaded chunks bar
							style={{
								height: '100%',
								width: `${getUploadProgressPercentage()}%`,
								backgroundColor: currentThemeColors.secondaryText, // Using secondaryText for the 'uploaded' part
								position: 'absolute',
								top: 0,
								left: 0,
								zIndex: 1,
								transition: 'width 0.3s',
							}}
						/>
						<div // Transcribed chunks bar
							style={{
								height: '100%',
								width: `${getTranscriptionProgressPercentage()}%`,
								backgroundColor: currentThemeColors.text, // Using primary text color for 'transcribed' part
								position: 'absolute',
								top: 0,
								left: 0,
								zIndex: 2,
								transition: 'width 0.3s',
							}}
						/>
					</div>
					<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: currentThemeColors.secondaryText }}>
						<span>
							Uploaded: {realUploaded} / {realTotal}
						</span>
						<span>
							Transcribed: {transcribedChunks} / {realTotal}{' '}
							{transcriptionSpeedLabel && <span style={{ fontSize: '12px', color: currentThemeColors.secondaryText }}>({transcriptionSpeedLabel})</span>}
						</span>
					</div>
				</div>
			)}

			{liveTranscript && (
				<div
					style={{
						marginBottom: '24px',
						padding: '16px',
						backgroundColor: currentThemeColors.background,
						borderRadius: '8px',
						border: `1px solid ${currentThemeColors.border}`,
						maxHeight: '200px',
						overflowY: 'auto',
						color: currentThemeColors.text,
					}}>
					<div style={{ fontSize: '14px', fontWeight: 'bold', color: currentThemeColors.text, marginBottom: '8px' }}>🎤 Live Transcript:</div>
					<div style={{ fontSize: '14px', lineHeight: '1.5' }}>{liveTranscript}</div>
				</div>
			)}

			<div
				style={{
					position: 'relative',
					textAlign: 'center',
					marginBottom: '24px',
					padding: '16px',
					backgroundColor: isRecording ? currentThemeColors.backgroundSecondary : isProcessing ? currentThemeColors.backgroundSecondary : currentThemeColors.background,
					border: `2px solid ${isRecording ? currentThemeColors.button.danger : isProcessing ? currentThemeColors.secondaryText : currentThemeColors.button.primary}`,
					overflow: 'hidden',
				}}>
				<canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }} />
				<div
					style={{
						position: 'relative',
						zIndex: 1,
						fontSize: '18px',
						fontWeight: 'bold',
						color: isRecording ? currentThemeColors.button.danger : isProcessing ? currentThemeColors.secondaryText : currentThemeColors.button.primary,
						marginBottom: '8px',
					}}>
					{isRecording ? '🔴 Recording...' : isProcessing ? '⚙️ Processing... Please wait.' : '⚪ Ready'}
				</div>
			</div>

			<div style={{ textAlign: 'center', marginBottom: '24px' }}>
				{audioSource !== 'file' ? (
					!isRecording ? (
						<button
							onClick={start}
							disabled={isUiLocked}
							style={{
								padding: '16px 32px',
								fontSize: '18px',
								fontWeight: 'bold',
								border: 'none',
								borderRadius: '8px',
								cursor: isUiLocked ? 'not-allowed' : 'pointer',
								transition: 'all 0.3s ease',
								minWidth: '140px',
								backgroundColor: currentThemeColors.button.primary,
								color: currentThemeColors.button.primaryText,
								boxShadow: theme === 'light' ? '0 4px 6px rgba(34, 197, 94, 0.3)' : '0 4px 8px rgba(0, 0, 0, 0.3)',
								opacity: isUiLocked ? 0.5 : 1,
							}}>
							🎙️ Start Recording
						</button>
					) : (
						<button
							onClick={stop}
							style={{
								padding: '16px 32px',
								fontSize: '18px',
								fontWeight: 'bold',
								border: 'none',
								borderRadius: '8px',
								cursor: 'pointer',
								transition: 'all 0.3s ease',
								minWidth: '140px',
								backgroundColor: currentThemeColors.button.danger,
								color: currentThemeColors.button.dangerText,
								boxShadow: theme === 'light' ? '0 4px 6px rgba(239, 68, 68, 0.3)' : '0 4px 8px rgba(0, 0, 0, 0.3)',
							}}>
							⏹️ Stop & Summarize
						</button>
					)
				) : (
					<button
						onClick={handleStartFileProcessing}
						disabled={isUiLocked || !selectedFile}
						style={{
							padding: '16px 32px',
							fontSize: '18px',
							fontWeight: 'bold',
							border: 'none',
							borderRadius: '8px',
							cursor: isUiLocked || !selectedFile ? 'not-allowed' : 'pointer',
							transition: 'all 0.3s ease',
							minWidth: '140px',
							backgroundColor: currentThemeColors.button.primary,
							color: currentThemeColors.button.primaryText,
								boxShadow: theme === 'light' ? '0 4px 6px rgba(34, 197, 94, 0.3)' : '0 4px 8px rgba(0, 0, 0, 0.3)',
							opacity: isUiLocked || !selectedFile ? 0.5 : 1,
						}}>
						📄 Start Transcription
					</button>
				)}
			</div>

			<div style={{ fontSize: '14px', color: currentThemeColors.secondaryText, textAlign: 'center', lineHeight: '1.5' }}>
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

			{history.length > 0 && !isUiLocked && (
				<div style={{ marginTop: '40px', marginBottom: '40px' }}>
					<h2 style={{ margin: '24px 0 12px 0', fontSize: 16, textAlign: 'center', color: currentThemeColors.text }}>Previous Meetings</h2>
					<ul style={{ listStyle: 'none', padding: 0, margin: 0, border: `1px solid ${currentThemeColors.border}`, borderRadius: '8px' }}>
						{history.map((m, index) => (
							<li
								key={m.id}
								style={{
									padding: '12px 16px',
									borderBottom: index === history.length - 1 ? 'none' : `1px solid ${currentThemeColors.border}`,
									// cursor: 'pointer', // Keep cursor pointer for the main li for navigation
									backgroundColor: index % 2 === 0 ? currentThemeColors.listItem.background : currentThemeColors.body,
									color: currentThemeColors.text,
								}}
								onClick={(e) => {
									// Navigate only if not clicking on an interactive element (input/icon)
									if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'SPAN' || (e.target as HTMLElement).tagName === 'DIV') {
										navigate(`/summary/${m.id}`)
									}
								}}
								onMouseEnter={() => setHoveredMeetingId(m.id)}
								onMouseLeave={() => setHoveredMeetingId(null)}>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
									{editingMeetingId === m.id ? (
										<input
											type="text"
											value={editingTitle}
											onChange={(e) => setEditingTitle(e.target.value)}
											onBlur={handleTitleChange}
											onKeyDown={(e) => {
												if (e.key === 'Enter') {
													handleTitleChange()
												} else if (e.key === 'Escape') {
													setEditingMeetingId(null);
													setEditingTitle('');
												}
												e.stopPropagation() // Prevent li onClick
											}}
											onClick={(e) => e.stopPropagation()} // Prevent li onClick
											style={{
												flexGrow: 1,
												padding: '4px 8px',
												fontSize: '1em',
												marginRight: '10px',
												border: `1px solid ${currentThemeColors.input.border}`,
												borderRadius: '4px',
												backgroundColor: currentThemeColors.input.background,
												color: currentThemeColors.input.text,
											}}
											autoFocus
										/>
									) : (
										<span style={{ fontWeight: 500, flexGrow: 1, cursor: 'pointer' }} onClick={() => navigate(`/summary/${m.id}`)}>
											{m.title}
										</span>
									)}
									<div style={{ display: 'flex', alignItems: 'center', marginLeft: '10px' }}>
										{hoveredMeetingId === m.id && editingMeetingId !== m.id && (
											<span
												onClick={(e) => {
													e.stopPropagation() // Prevent li onClick
													setEditingMeetingId(m.id)
													setEditingTitle(m.title)
												}}
												style={{ cursor: 'pointer', marginRight: '10px', fontSize: '1.2em' }}
												title="Edit title">
												✏️
											</span>
										)}
										{m.status === 'pending' && (
											<span
												style={{
													marginRight: 8,
													color: theme === 'light' ? '#b45309' : '#fde047', // Adjust dark mode pending color
													backgroundColor: theme === 'light' ? '#fef3c7' : '#422006', // Adjust dark mode pending background
													padding: '2px 6px',
													borderRadius: '4px',
													fontSize: 12,
													fontWeight: '500',
												}}>
												Pending
											</span>
										)}
										{m.status === 'complete' && (
											<span
												style={{
													marginRight: 8,
													color: theme === 'light' ? '#057a55' : '#34d399', // Adjust dark mode complete color
													backgroundColor: theme === 'light' ? '#def7ec' : '#047481', // Adjust dark mode complete background
													padding: '2px 6px',
													borderRadius: '4px',
													fontSize: 12,
													fontWeight: '500',
												}}>
												Complete
											</span>
										)}
										<span style={{ fontStyle: 'italic', color: currentThemeColors.secondaryText, fontSize: 14, cursor: 'pointer' }} onClick={() => navigate(`/summary/${m.id}`)}>{new Date(m.started_at).toLocaleDateString()}</span>
									</div>
								</div>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}
