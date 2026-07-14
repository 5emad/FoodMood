#!/usr/bin/env bash
# Wait until MongoDB accepts connections (used by foodmood.service ExecStartPre)
set -euo pipefail

INSTALL_DIR="${FOOD_INSTALL_DIR:-/opt/food}"
ENV_FILE="${INSTALL_DIR}/.env"
ATTEMPTS="${WAIT_FOR_MONGO_ATTEMPTS:-45}"

uri=""
if [[ -f "$ENV_FILE" ]]; then
  uri="$(grep '^MONGODB_URI=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
fi

for ((i = 1; i <= ATTEMPTS; i++)); do
  if [[ -n "$uri" ]] \
    && mongosh --quiet "$uri" --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'; then
    exit 0
  fi
  if mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'; then
    exit 0
  fi
  sleep 2
done

echo "wait-for-mongo: MongoDB not ready after ${ATTEMPTS} attempts" >&2
exit 1
