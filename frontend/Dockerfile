# ─── build ────────────────────────────────────────────────────────────────────
# 20+ for import.meta.resolve, which vite.config.ts uses to pin ONNX Runtime.
FROM node:22-alpine AS build
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
# Where the browser fetches the Parakeet files for on-device transcription.
# Empty means Hugging Face's own copy; see .env.sample.
ARG VITE_PARAKEET_MODEL_BASE
ENV VITE_PARAKEET_MODEL_BASE=${VITE_PARAKEET_MODEL_BASE}
# Same, for the experimental on-device summariser's Qwen3.5 weights, and for
# ONNX Runtime's own wasm + glue (which transformers.js otherwise fetches
# from jsdelivr at runtime). Empty is the working default for both.
ARG VITE_SUMMARY_MODEL_BASE
ENV VITE_SUMMARY_MODEL_BASE=${VITE_SUMMARY_MODEL_BASE}
ARG VITE_ORT_WASM_BASE
ENV VITE_ORT_WASM_BASE=${VITE_ORT_WASM_BASE}

WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html

