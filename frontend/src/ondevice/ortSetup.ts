/**
 * Shared ONNX Runtime Web configuration for the on-device workers.
 *
 * Note the entry point: `onnxruntime-web/webgpu`, not `onnxruntime-web`. The
 * default entry ships ORT's older JSEP WebGPU implementation, whose
 * MatMulNBits kernel accepts 4-bit weights only — an 8-bit weight-only
 * encoder (scripts/quantize_parakeet_encoder.py) fails session creation with
 * "nbits_ == 4 was false". This entry carries the newer native WebGPU EP,
 * which handles 2, 4 and 8 bits, and still registers the wasm backend for the
 * CPU plan and for diarization. It is the asyncify build, so it works without
 * JSPI (Firefox and Safari have none); parakeet.js imports plain
 * `onnxruntime-web` internally, which vite.config.ts aliases here so both
 * share one runtime.
 *
 * The WASM binaries are served by Vite from the installed package rather
 * than a CDN, so the app keeps working offline and behind strict CSPs.
 * Multi-threading needs SharedArrayBuffer, which only exists on
 * cross-origin-isolated pages — see the COOP/COEP headers in vite.config.ts
 * and nginx.conf. Without it ORT silently runs single-threaded.
 */
import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

/**
 * True inside one of ONNX Runtime's own helper workers. ORT spawns its
 * pthreads from `import.meta.url` of its glue code; when that glue is bundled
 * into one of our workers, each pthread evaluates our worker file too. Our
 * top-level code (message handlers above all) must then stay out of the way,
 * or it overwrites the handler the pthread needs and ORT waits forever.
 */
export const isOrtHelperWorker = (): boolean => {
	const name = (self as unknown as { name?: string }).name
	return name === 'em-pthread' || name === 'ort-wasm-proxy-worker'
}

let configured = false

export function configureOrt(): { threads: number } {
	if (!configured) {
		// Only the binary is external. ORT's bundled entry keeps its JS glue
		// inlined, so no extra `.mjs` asset is emitted — a file many static
		// hosts serve with a non-JS MIME type, which a module import rejects.
		// The cost is that ORT spawns its pthreads from *our* worker chunk;
		// isOrtHelperWorker() below is what makes that safe.
		ort.env.wasm.wasmPaths = { wasm: wasmUrl }
		const isolated = typeof SharedArrayBuffer !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
		// Leave a core for the UI thread and the audio pipeline.
		ort.env.wasm.numThreads = isolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1
		ort.env.wasm.proxy = false
		configured = true
	}
	return { threads: ort.env.wasm.numThreads ?? 1 }
}

export { ort }
