FROM oven/bun:canary-alpine AS builder

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
RUN bun install

COPY src ./src

ENV NODE_ENV=production

RUN bun run build

FROM alpine AS final

WORKDIR /app

RUN apk add --no-cache libgcc libstdc++
COPY .env.schema .env.schema
COPY env.d.ts /app/env.d.ts
COPY src/assets /app/src/assets
COPY --from=builder /app/dist/server /app/server
COPY --from=ghcr.io/dmno-dev/varlock:latest /usr/local/bin/ /usr/local/bin/

EXPOSE 8080/tcp

ENV NODE_ENV=production
ENV APP_ENV=prod

CMD ["varlock", "run", "--", "/app/server"]