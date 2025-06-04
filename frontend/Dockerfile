# ─── build stage ───
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_STRIPE_PUBKEY
ENV VITE_STRIPE_PUBKEY=${VITE_STRIPE_PUBKEY}
RUN npm run build

# ─── production stage ───
FROM nginx:stable-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY default.conf /etc/nginx/conf.d/default.conf
