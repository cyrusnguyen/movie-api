FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# better-sqlite3 ships prebuilt binaries, but keep the toolchain available in
# case the platform needs a source build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

# Stays root here: a mounted volume (a Fly Volume, a Docker named volume, ...)
# arrives empty and root-owned, and bin/entrypoint.js needs root to fix that
# before it drops to the unprivileged `node` user itself. See that file.
CMD ["node", "bin/entrypoint.js"]
