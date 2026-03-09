FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
RUN bun install

# Build a standalone server binary.
COPY src ./src

ENV NODE_ENV=production

RUN bun run build

FROM debian:bookworm-slim AS certs

WORKDIR /app

# Add certificates for outbound HTTPS (WebAuthn-related services, if needed).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM debian:bookworm-slim AS final

WORKDIR /app

RUN groupadd --system app \
  && useradd --system --gid app --create-home app

COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder --chown=app:app /app/server /app/server
COPY --from=builder --chown=app:app /app/src/assets /app/src/assets
COPY --chown=app:app certs /app/certs

EXPOSE 8080

USER app

ENV NODE_ENV=production

CMD ["/app/server"]
