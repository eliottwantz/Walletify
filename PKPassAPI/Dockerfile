FROM oven/bun:canary-alpine AS builder

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
RUN bun install

COPY src ./src

ENV NODE_ENV=production

RUN bun run build

FROM dhi.io/alpine-base:3.23-dev AS deps

RUN apk update
RUN apk add --no-cache ca-certificates libgcc libstdc++

FROM dhi.io/alpine-base:3.23 AS final

WORKDIR /app

COPY --from=ghcr.io/dmno-dev/varlock:latest /usr/local/bin/ /usr/local/bin/
COPY --from=deps /usr/lib /usr/lib
COPY --from=deps /usr/share/ca-certificates /usr/share/ca-certificates
COPY --from=deps /etc/ca-certificates /etc/ca-certificates
COPY --from=deps /etc/ca-certificates.conf /etc/ca-certificates.conf
COPY --from=builder /app/dist/server /app/server
COPY .env.schema .env.schema
COPY env.d.ts /app/env.d.ts
COPY src/assets /app/src/assets

EXPOSE 8080/tcp

ENV NODE_ENV=production
ENV APP_ENV=prod

CMD ["varlock", "run", "--", "/app/server"]