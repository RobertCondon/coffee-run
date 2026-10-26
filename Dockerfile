# syntax=docker/dockerfile:1
# Multi-stage build: Vite frontend -> static Go binary -> tiny Alpine runtime.
# Built locally on clanker by the self-hosted GitHub Actions runner; no registry.

# ---- 1. Frontend -----------------------------------------------------------
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
# The worker imports ../../../db/*.sql from the repo root, so the schema has to
# sit beside web/ exactly as it does in the checkout.
COPY db/ /src/db/
COPY web/ ./
RUN npm run build

# ---- 2. Go server ----------------------------------------------------------
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# modernc.org/sqlite is pure Go, so no cgo and a fully static binary.
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/coffee-run ./cmd/server

# ---- 3. Runtime ------------------------------------------------------------
FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app \
 && mkdir -p /data && chown app:app /data
WORKDIR /app
COPY --from=build /out/coffee-run /app/coffee-run
COPY --from=web /src/web/dist /app/web/dist
USER app
ENV COFFEE_ADDR=:8080 \
    COFFEE_DB_PATH=/data/coffee-run.db \
    COFFEE_STATIC_DIR=/app/web/dist
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://localhost:8080/ || exit 1
CMD ["/app/coffee-run"]
