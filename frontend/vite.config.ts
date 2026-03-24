import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), ".."), "");
  return {
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL)
    },
    server: {
      proxy: {
        '/api': 'http://localhost:8000'
      }
    }
  }
});

