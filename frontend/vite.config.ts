import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), ".."), "");
  return {
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
    define: {
      // env.VITE_API_BASE_URL comes from the root .env file (local dev).
      // process.env.VITE_API_BASE_URL is the fallback for Docker builds where
      // the value is injected as a build arg (ARG/ENV in Dockerfile).
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
        env.VITE_API_BASE_URL ?? process.env.VITE_API_BASE_URL ?? ''
      )
    },
    server: {
      proxy: {
        '/api': 'http://localhost:8000'
      }
    }
  }
});

