import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), ".."), "");
  return {
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
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
    }
  }
});

