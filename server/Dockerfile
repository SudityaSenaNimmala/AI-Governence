# Build from repo root (server depends on agent via file:../agent):
#   docker build -f server/Dockerfile -t cloudfuze/ai-gov-server:dev .

FROM node:22-bookworm-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY agent ./agent
# Build tools for the Claude Usage Tracker installer, which the server now builds
# itself (src/lib/tracker-build.js) instead of waiting for someone to compile it on
# a Windows machine and copy 85 MB onto the host.
#
# Installed INTO agent/, not server/: the build script lives at
# agent/scripts/build-claude-tracker.mjs and imports esbuild and postject, and ESM
# resolves from the importing file — /app/agent/... never looks inside
# /app/server/node_modules. Versions match agent/package.json devDependencies.
#
# Installed in an ISOLATED project and then placed into agent/node_modules, rather
# than `npm install` inside agent/ — that form also installs the project's existing
# dependencies, which here means compiling better-sqlite3 and pulling tesseract and
# pdf-parse into an image that never uses them. This way only these two packages
# (and esbuild's platform binary) are added.
WORKDIR /tools
RUN npm init -y > /dev/null \
    && npm install --no-audit --no-fund esbuild@^0.24.0 postject@^1.0.0-alpha.6 \
    && mkdir -p /build/agent/node_modules \
    && cp -R /tools/node_modules/. /build/agent/node_modules/
WORKDIR /build
COPY server/package.json server/package-lock.json ./server/
WORKDIR /build/server
RUN npm install --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/agent /app/agent
COPY --from=builder /build/server/node_modules /app/server/node_modules
COPY server/src /app/server/src
# registry-snapshot.json lives here. Without this line only server/src is copied, so
# the snapshot fallback in routes/registry.js finds nothing and the Inventory page
# 503s instead of rendering — which is exactly the case it exists to cover.
COPY server/data /app/server/data
COPY server/package.json /app/server/
COPY server/tsconfig.json /app/server/
COPY scripts /app/scripts
# Served as a zip by GET /api/v1/sdk/download. Without this the endpoint 404s in
# the container even though it works locally — the route resolves sdk-js/ three
# levels up from server/src/routes, i.e. /app/sdk-js.
COPY sdk-js /app/sdk-js
# Extension source — served as a zip by GET /api/v1/installations/extension-package.
COPY browser-extension /app/browser-extension
WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["node_modules/.bin/tsx", "src/index.js"]
