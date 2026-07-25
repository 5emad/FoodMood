#!/bin/sh
set -eu

case "${CLUSTER_WORKERS:-auto}" in
  auto|AUTO|"")
    if command -v nproc >/dev/null 2>&1; then
      export CLUSTER_WORKERS="$(nproc)"
    else
      export CLUSTER_WORKERS=2
    fi
    ;;
esac

echo "[foodmood] CLUSTER_WORKERS=${CLUSTER_WORKERS} NODE_ENV=${NODE_ENV:-production}"

exec "$@"
