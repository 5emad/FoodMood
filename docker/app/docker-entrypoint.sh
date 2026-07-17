#!/bin/sh
set -eu

# CLUSTER_WORKERS=auto â†’ ØªØ¹Ø¯Ø§Ø¯ Ù‡Ø³ØªÙ‡Ù” Ú©Ø§Ù†ØªÛŒÙ†Ø±
case "${CLUSTER_WORKERS:-auto}" in
  auto|AUTO|"")
    if command -v nproc >/dev/null 2>&1; then
      export CLUSTER_WORKERS="$(nproc)"
    else
      export CLUSTER_WORKERS=2
    fi
    ;;
esac

# Ø§Ú¯Ø± Ú©Ù…ØªØ± Ø§Ø² Û² Ø¨Ø§Ø´Ø¯ØŒ ØªÚ©â€ŒÙ¾Ø±Ø¯Ø§Ø²Ù‡ Ù…ÛŒâ€ŒÙ…Ø§Ù†Ø¯ (Ù…Ù†Ø·Ù‚ server.js)
echo "[foodmood] CLUSTER_WORKERS=${CLUSTER_WORKERS} NODE_ENV=${NODE_ENV:-production}"

exec "$@"
