# ─── build ────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS build
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
# Where the browser fetches the Parakeet files for on-device transcription.
# Empty means Hugging Face's own copy; see .env.sample.
ARG VITE_PARAKEET_MODEL_BASE
ENV VITE_PARAKEET_MODEL_BASE=${VITE_PARAKEET_MODEL_BASE}

WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html

