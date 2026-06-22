# Build from repo root:
#   docker build -f agent/Dockerfile -t cloudfuze/ai-gov-agent:dev .

FROM node:22-bookworm-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY agent/package.json agent/
WORKDIR /build/agent
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/agent/node_modules ./node_modules
COPY agent/src ./src
COPY agent/package.json ./
ENV NODE_ENV=production
ENTRYPOINT ["node", "src/index.js"]
