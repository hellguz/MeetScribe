/**
 * `onnxruntime-web/webgpu` is an exports-map subpath, which this project's
 * "moduleResolution": "node" cannot follow. Same types as the package root —
 * only the bundled execution providers differ (see ortSetup.ts).
 */
declare module 'onnxruntime-web/webgpu' {
	export * from 'onnxruntime-web'
}
