# syntax=docker/dockerfile:1

# ---- Build stage -----------------------------------------------------------
# Runs on the build machine's native platform: the output is static files that work on
# every architecture, so multi-arch builds need no emulation for npm/vite/vitest.
FROM --platform=$BUILDPLATFORM docker.io/library/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run test && npm run build

# ---- Runtime stage ---------------------------------------------------------
FROM docker.io/nginxinc/nginx-unprivileged:stable-alpine

LABEL org.opencontainers.image.title="ceph-calculator" \
      org.opencontainers.image.description="Ceph storage capacity calculator (static web app)" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/cytrinox/ceph-calc"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY LICENSE /usr/share/licenses/ceph-calculator/LICENSE

USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
