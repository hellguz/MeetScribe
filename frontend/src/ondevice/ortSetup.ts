/**
 * Shared ONNX Runtime Web configuration for the on-device workers.
 *
 * The WASM binaries are served by Vite from the installed package rather
 * than a CDN, so the app keeps working offline and behind strict CSPs.
 * Multi-threading needs SharedArrayBuffer, which only exists on
 * cross-origin-isolated pages — see the COOP/COEP headers in vite.config.ts
 * and nginx.conf. Without it ORT silently runs single-threaded.
 */
import * as ort from 'onnxruntime-web'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

let configured = false

export function configureOrt(): { threads: number } {
	if (!configured) {
		// The bundled entry point carries its own JS glue; only the binary is external.
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
