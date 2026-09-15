# Parla Oyun Evi — üretim imajı: frontend (vite build) + Go backend tek imajda.
# Backend hem /api uçlarını hem de derlenmiş frontend'i (STATIC_DIR) sunar.

# --- 1. Frontend derlemesi ---
FROM node:24-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- 2. Backend derlemesi ---
FROM golang:1.25-alpine AS api
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed

# --- 3. Çalışma imajı (shell yok, root değil) ---
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=api /out/api /out/seed /app/
COPY --from=web /src/frontend/dist /app/web
ENV APP_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/web \
    AUTO_MIGRATE=true \
    TZ=Europe/Istanbul
EXPOSE 8080
USER nonroot:nonroot
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD ["/app/api", "healthcheck"]
ENTRYPOINT ["/app/api"]
