#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.60.0}"
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy}"
HOST_UID=$(id -u)
HOST_GID=$(id -g)

if ! command -v docker >/dev/null 2>&1; then
  echo "[og] docker not found on PATH" >&2
  exit 1
fi

echo "[og] rendering social images via ${PLAYWRIGHT_IMAGE}"
docker run --rm \
  -v "$REPO_ROOT":/work \
  -w /tmp \
  "$PLAYWRIGHT_IMAGE" \
  bash -c "npm init -y >/dev/null && \
    npm install --silent --no-save --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} 2>&1 | tail -1 && \
    cp /work/scripts/generate-og.mjs /tmp/generate-og.mjs && \
    node /tmp/generate-og.mjs && \
    chown ${HOST_UID}:${HOST_GID} /work/docs/public/og.png && \
    chown -R ${HOST_UID}:${HOST_GID} /work/docs/public/social"

echo "[og] done. Images:"
ls -lh "$REPO_ROOT/docs/public/og.png" "$REPO_ROOT/docs/public/social"/*.png
