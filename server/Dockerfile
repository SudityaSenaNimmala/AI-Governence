# Build from repo root (server depends on agent via file:../agent):
#   docker build -f server/Dockerfile -t cloudfuze/ai-gov-server:dev .

FROM node:22-bookworm-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY agent ./agent
COPY server/package.json ./server/
WORKDIR /build/server
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/agent /app/agent
COPY --from=builder /build/server/node_modules /app/server/node_modules
COPY server/src /app/server/src
COPY server/package.json /app/server/
WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 8787
ENTRYPOINT ["node", "src/index.js"]
