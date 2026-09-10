/**
 * Speaker diarization, ported step for step from sherpa-onnx's
 * OfflineSpeakerDiarizationPyannoteImpl so that running it in the browser
 * gives the same speaker turns the server would.
 *
 * Stages: slide a 10 s window over the audio and run pyannote segmentation
 * (3 local speakers per window, powerset-encoded) → per window and local
 * speaker, gather the frames where only that speaker talks and embed them
 * with campplus → cluster the embeddings across windows → relabel each
 * window's local speakers with their cluster → vote per frame → turns.
 *
 * The ONNX sessions are injected so this file has no runtime dependency; the
 * worker supplies onnxruntime-web and the test harness onnxruntime-node.
 */

import { computeFbank, subtractGlobalMean } from './fbank'
import { clusterEmbeddings } from './cluster'
import type { SpeakerTurn } from './label'

export interface DiarizationModels {
	/** Runs segmentation on one window (1, 1, windowSize). Returns (frames x numClasses). */
	segment(window: Float32Array): Promise<{ data: Float32Array; frames: number }>
	/** Runs the embedding model on (1, frames, 80) features. Returns the embedding vector. */
	embed(features: Float32Array, frames: number): Promise<Float32Array>
}

export interface DiarizationConfig {
	/** Metadata baked into the segmentation model. */
	windowSize: number
	receptiveFieldSize: number
	receptiveFieldShift: number
	numSpeakers: number
	numClasses: number
	powersetMaxClasses: number
	sampleRate: number
	/** Tunables, mirroring backend/app/config.py. */
	windowShiftRatio: number
	clusterThreshold: number
	minDurationOn: number
	minDurationOff: number
}

/** sherpa-onnx-pyannote-segmentation-3-0 + the backend's tuned defaults. */
export const DEFAULT_DIARIZATION_CONFIG: DiarizationConfig = {
	windowSize: 160_000,
	receptiveFieldSize: 991,
	receptiveFieldShift: 270,
	numSpeakers: 3,
	numClasses: 7,
	powersetMaxClasses: 2,
	sampleRate: 16_000,
	windowShiftRatio: 0.5,
	clusterThreshold: 0.9,
	minDurationOn: 0.5,
	minDurationOff: 0.5,
}

export type DiarizationProgress = { stage: 'segmenting' | 'embedding' | 'clustering'; done: number; total: number }

type Labels = { data: Uint8Array; frames: number; cols: number } // row-major (frames x cols)

function powersetMapping(cfg: DiarizationConfig): Uint8Array[] {
	const rows: Uint8Array[] = []
	for (let c = 0; c < cfg.numClasses; c++) rows.push(new Uint8Array(cfg.numSpeakers))
	let k = 1
	for (let i = 1; i <= cfg.powersetMaxClasses; i++) {
		if (i === 1) {
			for (let j = 0; j < cfg.numSpeakers; j++, k++) rows[k][j] = 1
		} else if (i === 2) {
			for (let j = 0; j < cfg.numSpeakers; j++) {
				for (let m = j + 1; m < cfg.numSpeakers; m++, k++) {
					rows[k][j] = 1
					rows[k][m] = 1
				}
			}
		} else {
			throw new Error(`powerset_max_classes = ${i} is not supported`)
		}
	}
	return rows
}

function windowShiftSamples(cfg: DiarizationConfig): number {
	const shift = cfg.windowShiftRatio * cfg.windowSize
	if (!Number.isFinite(shift) || shift < 1) return 1
	if (shift > cfg.windowSize) return cfg.windowSize
	return Math.floor(shift)
}

/** Window starts: every `shift` samples, plus a zero-padded tail window if needed. */
function planWindows(n: number, cfg: DiarizationConfig): { starts: number[]; hasLastChunk: boolean } {
	const W = cfg.windowSize
	const S = windowShiftSamples(cfg)
	if (n <= W) return { starts: [0], hasLastChunk: false }
	const numChunks = Math.floor((n - W) / S) + 1
	const hasLastChunk = (n - W) % S > 0
	const starts: number[] = []
	for (let i = 0; i < numChunks; i++) starts.push(i * S)
	if (hasLastChunk) starts.push(numChunks * S)
	return { starts, hasLastChunk }
}

function toMultiLabel(logits: Float32Array, frames: number, cfg: DiarizationConfig, mapping: Uint8Array[]): Labels {
	const data = new Uint8Array(frames * cfg.numSpeakers)
	for (let f = 0; f < frames; f++) {
		let best = 0
		let bestVal = -Infinity
		for (let c = 0; c < cfg.numClasses; c++) {
			const v = logits[f * cfg.numClasses + c]
			if (v > bestVal) {
				bestVal = v
				best = c
			}
		}
		data.set(mapping[best], f * cfg.numSpeakers)
	}
	return { data, frames, cols: cfg.numSpeakers }
}

function totalFrames(numChunks: number, cfg: DiarizationConfig): number {
	const S = windowShiftSamples(cfg)
	return Math.floor((cfg.windowSize + (numChunks - 1) * S) / cfg.receptiveFieldShift) + 1
}

function chunkFrameStart(i: number, cfg: DiarizationConfig): number {
	return Math.floor((i * windowShiftSamples(cfg)) / cfg.receptiveFieldShift + 0.5)
}

function computeSpeakersPerFrame(labels: Labels[], cfg: DiarizationConfig): Int32Array {
	const numFrames = totalFrames(labels.length, cfg)
	const count = new Float32Array(numFrames)
	const weight = new Float32Array(numFrames)
	labels.forEach((label, i) => {
		const start = chunkFrameStart(i, cfg)
		for (let f = 0; f < label.frames; f++) {
			let s = 0
			for (let c = 0; c < label.cols; c++) s += label.data[f * label.cols + c]
			count[start + f] += s
			weight[start + f] += 1
		}
	})
	const out = new Int32Array(numFrames)
	for (let f = 0; f < numFrames; f++) out[f] = Math.floor(count[f] / (weight[f] + 1e-12) + 0.5)
	return out
}

/** Frames where several speakers talk at once are excluded from embedding. */
function excludeOverlap(label: Labels): Labels {
	const data = new Uint8Array(label.data.length)
	for (let f = 0; f < label.frames; f++) {
		let s = 0
		for (let c = 0; c < label.cols; c++) s += label.data[f * label.cols + c]
		if (s < 2) data.set(label.data.subarray(f * label.cols, (f + 1) * label.cols), f * label.cols)
	}
	return { data, frames: label.frames, cols: label.cols }
}

type SampleRange = [number, number]

function chunkSpeakerSampleIndexes(labels: Labels[], cfg: DiarizationConfig): { pairs: [number, number][]; ranges: SampleRange[][] } {
	const W = cfg.windowSize
	const S = windowShiftSamples(cfg)
	const pairs: [number, number][] = []
	const ranges: SampleRange[][] = []
	labels.forEach((raw, chunkIndex) => {
		const label = excludeOverlap(raw)
		const T = label.frames
		const sampleOffset = chunkIndex * S
		for (let speaker = 0; speaker < cfg.numSpeakers; speaker++) {
			let sum = 0
			for (let f = 0; f < T; f++) sum += label.data[f * label.cols + speaker]
			if (sum < 10) continue // skip segments shorter than 10 frames

			const speakerRanges: SampleRange[] = []
			let isActive = false
			let startIndex = 0
			for (let k = 0; k < T; k++) {
				const active = label.data[k * label.cols + speaker] !== 0
				if (active) {
					if (!isActive) {
						isActive = true
						startIndex = k
					}
				} else if (isActive) {
					isActive = false
					speakerRanges.push([
						Math.floor(Math.fround((startIndex / T) * W) + sampleOffset),
						Math.floor(Math.fround((k / T) * W) + sampleOffset),
					])
				}
			}
			if (isActive) {
				speakerRanges.push([
					Math.floor(Math.fround((startIndex / T) * W) + sampleOffset),
					Math.floor(Math.fround(((T - 1) / T) * W) + sampleOffset),
				])
			}
			pairs.push([chunkIndex, speaker])
			ranges.push(speakerRanges)
		}
	})
	return { pairs, ranges }
}

async function computeEmbeddings(
	audio: Float32Array,
	ranges: SampleRange[][],
	models: DiarizationModels,
	onProgress?: (p: DiarizationProgress) => void,
): Promise<{ embeddings: Float32Array; rows: number; dim: number; validIndexes: number[] }> {
	const n = audio.length
	const validIndexes: number[] = []
	const vectors: Float32Array[] = []
	let dim = 0

	for (let k = 0; k < ranges.length; k++) {
		// The segments of one (chunk, speaker) pair are concatenated into a
		// single waveform, as sherpa's stream does, and featurised as one.
		let total = 0
		for (const [s, e] of ranges[k]) total += Math.max(0, Math.min(e, n) - s)
		const wave = new Float32Array(total)
		let pos = 0
		for (const [s, e] of ranges[k]) {
			const end = Math.min(e, n)
			if (end > s) {
				wave.set(audio.subarray(s, end), pos)
				pos += end - s
			}
		}
		const { frames, data } = computeFbank(wave)
		if (frames > 0) {
			subtractGlobalMean(data, frames)
			const emb = await models.embed(data, frames)
			let finite = true
			for (let i = 0; i < emb.length; i++) {
				if (!Number.isFinite(emb[i])) {
					finite = false
					break
				}
			}
			if (finite) {
				vectors.push(emb)
				validIndexes.push(k)
				dim = emb.length
			}
		}
		onProgress?.({ stage: 'embedding', done: k + 1, total: ranges.length })
	}

	const embeddings = new Float32Array(vectors.length * dim)
	vectors.forEach((v, i) => embeddings.set(v, i * dim))
	return { embeddings, rows: vectors.length, dim, validIndexes }
}

function relabel(labels: Labels[], numClusters: number, mapping: Map<string, number>): Labels[] {
	return labels.map((label, chunkIndex) => {
		const data = new Uint8Array(label.frames * numClusters)
		for (let speaker = 0; speaker < label.cols; speaker++) {
			const cluster = mapping.get(`${chunkIndex}:${speaker}`)
			if (cluster === undefined || cluster < 0 || cluster >= numClusters) continue
			for (let k = 0; k < label.frames; k++) {
				if (label.data[k * label.cols + speaker] === 1) data[k * numClusters + cluster] = 1
			}
		}
		return { data, frames: label.frames, cols: numClusters }
	})
}

function computeSpeakerCount(labels: Labels[], numSamples: number, cfg: DiarizationConfig): Labels {
	const cols = labels[0].cols
	let numFrames = totalFrames(labels.length, cfg)
	const count = new Uint8Array(numFrames * cols)
	labels.forEach((label, i) => {
		const start = chunkFrameStart(i, cfg)
		for (let f = 0; f < label.frames; f++) {
			for (let c = 0; c < cols; c++) count[(start + f) * cols + c] += label.data[f * cols + c]
		}
	})
	const S = windowShiftSamples(cfg)
	const hasLastChunk = (numSamples - cfg.windowSize) % S > 0
	if (hasLastChunk) {
		let lastFrame = Math.floor(numSamples / cfg.receptiveFieldShift)
		if (lastFrame >= numFrames) lastFrame = numFrames - 1
		numFrames = lastFrame + 1
	}
	return { data: count.subarray(0, numFrames * cols), frames: numFrames, cols }
}

function finalizeLabels(count: Labels, speakersPerFrame: Int32Array): Labels {
	const { frames, cols } = count
	const data = new Uint8Array(frames * cols)
	const order = new Int32Array(cols)
	for (let f = 0; f < frames; f++) {
		const k = Math.max(0, Math.min(cols, speakersPerFrame[f]))
		if (k === 0) continue
		for (let c = 0; c < cols; c++) order[c] = c
		// Top-k by count, descending; ties keep the lower index, like partial_sort's stable-ish output.
		const row = count.data.subarray(f * cols, (f + 1) * cols)
		const sorted = Array.from(order).sort((a, b) => row[b] - row[a] || a - b)
		for (let m = 0; m < k; m++) data[f * cols + sorted[m]] = 1
	}
	return { data, frames, cols }
}

function mergeSegments(segments: SpeakerTurn[], gap: number): SpeakerTurn[] {
	const out = segments.slice()
	let changed = true
	while (changed) {
		changed = false
		for (let i = 0; i < out.length - 1; i++) {
			const a = out[i]
			const b = out[i + 1]
			let merged: SpeakerTurn | null = null
			if (a.end < b.start && a.end + gap >= b.start) merged = { start: a.start, end: b.end, speaker: a.speaker }
			else if (b.end < a.start && b.end + gap >= a.start) merged = { start: b.start, end: a.end, speaker: a.speaker }
			if (merged) {
				out[i] = merged
				out.splice(i + 1, 1)
				changed = true
				break
			}
		}
	}
	return out
}

function computeResult(finalLabels: Labels, cfg: DiarizationConfig): SpeakerTurn[] {
	const { frames, cols } = finalLabels
	const scale = cfg.receptiveFieldShift / cfg.sampleRate
	const scaleOffset = (0.5 * cfg.receptiveFieldSize) / cfg.sampleRate
	const result: SpeakerTurn[] = []

	for (let speaker = 0; speaker < cols; speaker++) {
		const at = (f: number) => finalLabels.data[f * cols + speaker]
		const own: SpeakerTurn[] = []
		let isActive = at(0) > 0
		let startIndex = isActive ? 0 : -1
		for (let f = 1; f < frames; f++) {
			if (isActive) {
				if (at(f) === 0) {
					own.push({ start: startIndex * scale + scaleOffset, end: f * scale + scaleOffset, speaker })
					isActive = false
				}
			} else if (at(f) === 1) {
				isActive = true
				startIndex = f
			}
		}
		if (isActive) own.push({ start: startIndex * scale + scaleOffset, end: (frames - 1) * scale + scaleOffset, speaker })

		for (const seg of mergeSegments(own, cfg.minDurationOff)) {
			if (seg.end - seg.start > cfg.minDurationOn) result.push(seg)
		}
	}
	return result.sort((a, b) => a.start - b.start || a.speaker - b.speaker)
}

/**
 * Diarize a 16 kHz mono recording. Returns raw speaker turns with sherpa's
 * arbitrary speaker ids; callers prune and renumber (see label.ts).
 */
export async function diarize(
	audio: Float32Array,
	models: DiarizationModels,
	cfg: DiarizationConfig = DEFAULT_DIARIZATION_CONFIG,
	onProgress?: (p: DiarizationProgress) => void,
): Promise<SpeakerTurn[]> {
	const n = audio.length
	if (n <= 0) return []
	const mapping = powersetMapping(cfg)

	// 1. Segmentation over sliding windows.
	const { starts, hasLastChunk } = planWindows(n, cfg)
	const labels: Labels[] = []
	for (let i = 0; i < starts.length; i++) {
		const start = starts[i]
		let window: Float32Array
		if (start + cfg.windowSize <= n) {
			window = audio.subarray(start, start + cfg.windowSize)
		} else {
			window = new Float32Array(cfg.windowSize)
			window.set(audio.subarray(start, n))
		}
		const { data, frames } = await models.segment(window)
		labels.push(toMultiLabel(data, frames, cfg, mapping))
		onProgress?.({ stage: 'segmenting', done: i + 1, total: starts.length })
	}

	// One window: local speakers are the final speakers.
	if (labels.length === 1) {
		let label = labels[0]
		if (n > cfg.windowSize && hasLastChunk) {
			const keep = Math.min(Math.floor(n / cfg.receptiveFieldShift), label.frames)
			label = { data: label.data.subarray(0, keep * label.cols), frames: keep, cols: label.cols }
		}
		return computeResult(label, cfg)
	}

	// 2. How many speakers are active at each frame (vote across overlapping windows).
	const speakersPerFrame = computeSpeakersPerFrame(labels, cfg)
	let anySpeech = false
	for (let f = 0; f < speakersPerFrame.length; f++) {
		if (speakersPerFrame[f] > 0) {
			anySpeech = true
			break
		}
	}
	if (!anySpeech) return []

	// 3. Embed every (window, local speaker) pair.
	const { pairs, ranges } = chunkSpeakerSampleIndexes(labels, cfg)
	const { embeddings, rows, dim, validIndexes } = await computeEmbeddings(audio, ranges, models, onProgress)
	if (rows === 0) return []

	// 4. Cluster and map (window, local speaker) → global speaker.
	onProgress?.({ stage: 'clustering', done: 0, total: 1 })
	const clusters = clusterEmbeddings(embeddings, rows, dim, cfg.clusterThreshold)
	let numClusters = 0
	for (let i = 0; i < clusters.length; i++) numClusters = Math.max(numClusters, clusters[i] + 1)
	const chunkSpeakerToCluster = new Map<string, number>()
	validIndexes.forEach((pairIndex, k) => {
		const [chunk, speaker] = pairs[pairIndex]
		chunkSpeakerToCluster.set(`${chunk}:${speaker}`, clusters[k])
	})

	// 5. Vote per frame with the global ids and turn frames into segments.
	const relabelled = relabel(labels, numClusters, chunkSpeakerToCluster)
	const count = computeSpeakerCount(relabelled, n, cfg)
	const finalLabels = finalizeLabels(count, speakersPerFrame)
	onProgress?.({ stage: 'clustering', done: 1, total: 1 })
	return computeResult(finalLabels, cfg)
}
