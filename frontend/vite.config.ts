import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "public",                      // static assets (if any)
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://backend:8000" } }
})
