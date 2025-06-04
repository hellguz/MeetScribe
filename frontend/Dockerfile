# ─── build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# expose Stripe key to the build
ARG  VITE_STRIPE_PUBKEY
ENV  VITE_STRIPE_PUBKEY=${VITE_STRIPE_PUBKEY}

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# ─── run stage (Nginx) ─────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]


