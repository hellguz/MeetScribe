import path from "path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The ESM WebGPU-EP entry of *this* package's onnxruntime-web.
const ORT_WEBGPU_ENTRY = fileURLToPath(import.meta.resolve("onnxruntime-web/webgpu"));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), ".."), "");
  return {
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
    resolve: {
      alias: [
        // parakeet.js does its own `import('onnxruntime-web')` and pins 1.24.1
        // as a dependency, so it would load a second ORT — an older one, whose
        // JSEP MatMulNBits kernel is 4-bit only. Redirect it to the very file
        // src/ondevice/ortSetup.ts loads, resolved absolutely: a bare
        // "onnxruntime-web/webgpu" would resolve again from parakeet.js's own
        // nested copy. Anchored, so this package's own subpath imports (the
        // /webgpu entry, the ?url wasm) are left alone.
        { find: /^onnxruntime-web$/, replacement: ORT_WEBGPU_ENTRY },
      ],
    },
    // Browser tests swap the real model for a fake one (no 600 MB download).
    ...(process.env.PARAKEET_MOCK === "1"
      ? { resolve: { alias: { "parakeet.js": path.resolve(process.cwd(), "src/ondevice/testing/parakeetMock.ts") } } }
      : {}),
    define: {
      // env.VITE_API_BASE_URL comes from the root .env file (local dev).
      // process.env.VITE_API_BASE_URL is the fallback for Docker builds where
      // the value is injected as a build arg (ARG/ENV in Dockerfile).
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
        env.VITE_API_BASE_URL ?? process.env.VITE_API_BASE_URL ?? ''
      ),
      // Optional: self-host the Parakeet model files (same names as the
      // Hugging Face repo) instead of downloading them from Hugging Face.
      'import.meta.env.VITE_PARAKEET_MODEL_BASE': JSON.stringify(
        env.VITE_PARAKEET_MODEL_BASE ?? process.env.VITE_PARAKEET_MODEL_BASE ?? ''
      )
    },
    // Module workers so the on-device workers can import npm packages.
    worker: { format: "es" },
    server: {
      // Cross-origin isolation gives the page SharedArrayBuffer, which lets
      // ONNX Runtime run WASM multi-threaded (on-device transcription and
      // diarization). Mirrored in nginx.conf for production.
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      proxy: {
        '/api': 'http://localhost:8000'
      }
    },
    preview: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      proxy: {
        '/api': 'http://localhost:8000'
      }
    }
  }
});

