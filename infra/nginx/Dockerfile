# Stage 1: build the React frontend
FROM node:18 AS builder
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:1.27.5-alpine
# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy our built frontend into nginx
COPY --from=builder /src/dist /usr/share/nginx/html

# Copy custom nginx config
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf

# Expose HTTP/HTTPS
EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]