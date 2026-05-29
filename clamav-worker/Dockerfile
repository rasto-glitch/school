# Two-stage build: install Node deps + compile TS, then run on a slim base
# with ClamAV pre-installed. The freshclam definitions are downloaded on
# container start so they're always fresh per deploy.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --include=dev --no-audit --no-fund
COPY src ./src
RUN npm run build

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim
WORKDIR /app

# ClamAV CLI + freshclam (no daemon — clamscan is one-shot per file).
# Installing clamav-freshclam pulls in clamav-base; tini is for proper
# signal handling under Railway / Docker.
RUN apt-get update \
 && apt-get install -y --no-install-recommends clamav clamav-freshclam tini ca-certificates \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Disable freshclam's own background daemon — the entrypoint runs it once
# at startup and then the scan loop takes over.
RUN sed -i 's/^Foreground.*/Foreground true/' /etc/clamav/freshclam.conf || true

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Entrypoint: refresh definitions, then start the worker. freshclam can
# fail on first attempt (rate limiting from the mirror) — we retry but
# don't block startup forever; the worker treats missing-definitions as
# 'scan error' and re-queues the row.
COPY <<'EOF' /entrypoint.sh
#!/bin/sh
set -e
echo "[clamav-worker] refreshing virus definitions..."
freshclam --quiet || echo "[clamav-worker] freshclam failed; worker will report scan errors until it succeeds."
exec node dist/worker.js
EOF
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
