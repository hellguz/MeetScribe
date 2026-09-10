/**
 * Kaldi-compatible log-mel filterbank features, as computed by kaldi-native-fbank
 * inside sherpa-onnx for the speaker-embedding model.
 *
 * The parameters below are sherpa's FeatureExtractorConfig defaults, which the
 * server-side diarization (backend/app/diarization.py) uses implicitly:
 * 25 ms Povey window, 10 ms shift, 80 mel bins from 20 Hz to Nyquist-400 Hz,
 * DC removal, 0.97 pre-emphasis, no dither, snip_edges=false (frames are
 * centred and the edges reflected). Samples stay in [-1, 1] because the
 * campplus model declares normalize_samples=1.
 */

export const SAMPLE_RATE = 16_000
export const NUM_MEL_BINS = 80
const FRAME_LENGTH = 400 // 25 ms
const FRAME_SHIFT = 160 // 10 ms
const FFT_SIZE = 512 // frame length rounded up to a power of two
const LOW_FREQ = 20
const HIGH_FREQ = SAMPLE_RATE / 2 - 400
const PREEMPH = 0.97
const LOG_FLOOR = 1.1920928955078125e-7 // std::numeric_limits<float>::epsilon()

const melScale = (hz: number) => 1127 * Math.log(1 + hz / 700)

/** Povey window: Hann raised to 0.85. */
const WINDOW = (() => {
	const w = new Float32Array(FRAME_LENGTH)
	for (let i = 0; i < FRAME_LENGTH; i++) {
		w[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1)), 0.85)
	}
	return w
})()

/**
 * Kaldi mel banks: triangular filters on the mel scale, evaluated at the FFT
 * bin centres (bins 0..FFT_SIZE/2-1; Kaldi never uses the Nyquist bin).
 * Stored sparsely as [firstBin, weights] per mel bin.
 */
const MEL_BANKS = (() => {
	const numFftBins = FFT_SIZE / 2
	const fftBinWidth = SAMPLE_RATE / FFT_SIZE
	const melLow = melScale(LOW_FREQ)
	const melHigh = melScale(HIGH_FREQ)
	const melDelta = (melHigh - melLow) / (NUM_MEL_BINS + 1)
	const banks: { offset: number; weights: Float32Array }[] = []
	for (let bin = 0; bin < NUM_MEL_BINS; bin++) {
		const left = melLow + bin * melDelta
		const center = left + melDelta
		const right = left + 2 * melDelta
		const weights = new Float32Array(numFftBins)
		let first = -1
		let last = -1
		for (let k = 0; k < numFftBins; k++) {
			const mel = melScale(k * fftBinWidth)
			if (mel > left && mel < right) {
				weights[k] = mel <= center ? (mel - left) / (center - left) : (right - mel) / (right - center)
				if (first < 0) first = k
				last = k
			}
		}
		banks.push({ offset: first, weights: weights.slice(first, last + 1) })
	}
	return banks
})()

// Precomputed bit-reversal permutation and twiddles for the radix-2 FFT.
const BIT_REVERSE = (() => {
	const table = new Uint16Array(FFT_SIZE)
	const bits = Math.log2(FFT_SIZE)
	for (let i = 0; i < FFT_SIZE; i++) {
		let r = 0
		for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
		table[i] = r
	}
	return table
})()
const TWIDDLE_COS = new Float64Array(FFT_SIZE / 2)
const TWIDDLE_SIN = new Float64Array(FFT_SIZE / 2)
for (let i = 0; i < FFT_SIZE / 2; i++) {
	TWIDDLE_COS[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE)
	TWIDDLE_SIN[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE)
}

/** In-place iterative radix-2 complex FFT over (re, im) of length FFT_SIZE. */
function fft(re: Float64Array, im: Float64Array): void {
	for (let i = 0; i < FFT_SIZE; i++) {
		const j = BIT_REVERSE[i]
		if (j > i) {
			const tr = re[i]
			re[i] = re[j]
			re[j] = tr
			const ti = im[i]
			im[i] = im[j]
			im[j] = ti
		}
	}
	for (let size = 2; size <= FFT_SIZE; size <<= 1) {
		const half = size >> 1
		const step = FFT_SIZE / size
		for (let start = 0; start < FFT_SIZE; start += size) {
			for (let k = 0; k < half; k++) {
				const wr = TWIDDLE_COS[k * step]
				const wi = TWIDDLE_SIN[k * step]
				const a = start + k
				const b = a + half
				const xr = re[b] * wr - im[b] * wi
				const xi = re[b] * wi + im[b] * wr
				re[b] = re[a] - xr
				im[b] = im[a] - xi
				re[a] += xr
				im[a] += xi
			}
		}
	}
}

/** Number of frames Kaldi produces for `n` samples with snip_edges=false. */
export function numFrames(n: number): number {
	return Math.floor((n + FRAME_SHIFT / 2) / FRAME_SHIFT)
}

/**
 * Compute log-mel features for a 16 kHz mono signal.
 * Returns a row-major (frames x 80) Float32Array.
 */
export function computeFbank(samples: Float32Array): { frames: number; data: Float32Array } {
	const n = samples.length
	const frames = numFrames(n)
	const data = new Float32Array(frames * NUM_MEL_BINS)
	const re = new Float64Array(FFT_SIZE)
	const im = new Float64Array(FFT_SIZE)
	const power = new Float64Array(FFT_SIZE / 2)
	const frame = new Float64Array(FRAME_LENGTH)

	for (let f = 0; f < frames; f++) {
		// Centred frame with reflected edges, exactly as Kaldi's ExtractWindow.
		const start = f * FRAME_SHIFT + FRAME_SHIFT / 2 - FRAME_LENGTH / 2
		let mean = 0
		for (let i = 0; i < FRAME_LENGTH; i++) {
			let s = start + i
			while (s < 0 || s >= n) s = s < 0 ? -s - 1 : 2 * n - 1 - s
			frame[i] = samples[s]
			mean += frame[i]
		}
		mean /= FRAME_LENGTH
		for (let i = 0; i < FRAME_LENGTH; i++) frame[i] -= mean
		for (let i = FRAME_LENGTH - 1; i > 0; i--) frame[i] -= PREEMPH * frame[i - 1]
		frame[0] -= PREEMPH * frame[0]

		re.fill(0)
		im.fill(0)
		for (let i = 0; i < FRAME_LENGTH; i++) re[i] = frame[i] * WINDOW[i]
		fft(re, im)
		for (let k = 0; k < FFT_SIZE / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k]

		const row = f * NUM_MEL_BINS
		for (let bin = 0; bin < NUM_MEL_BINS; bin++) {
			const { offset, weights } = MEL_BANKS[bin]
			let energy = 0
			for (let i = 0; i < weights.length; i++) energy += weights[i] * power[offset + i]
			data[row + bin] = Math.log(Math.max(energy, LOG_FLOOR))
		}
	}
	return { frames, data }
}

/** sherpa's "global-mean" feature normalisation: subtract the per-bin mean. */
export function subtractGlobalMean(data: Float32Array, frames: number): void {
	if (frames === 0) return
	for (let bin = 0; bin < NUM_MEL_BINS; bin++) {
		let sum = 0
		for (let f = 0; f < frames; f++) sum += data[f * NUM_MEL_BINS + bin]
		const mean = sum / frames
		for (let f = 0; f < frames; f++) data[f * NUM_MEL_BINS + bin] -= mean
	}
}
