#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — fix MongoDB connection (keeps data, uses .env credentials)
#
#  Use when login/superadmin shows «اتصال به پایگاه داده برقرار نیست».
#
#  One-line:
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/fix-mongodb.sh | sudo bash
#
#  Reset superadmin after DB fix:
#    curl -fsSL .../fix-mongodb.sh | sudo bash -s -- --superadmin-pass 'Food@Super2026!'
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/food}"
SUPERADMIN_USER="${SUPERADMIN_USER:-superadmin}"
SUPERADMIN_PASS="${SUPERADMIN_PASS:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --superadmin-user) SUPERADMIN_USER="$2"; shift 2 ;;
    --superadmin-pass) SUPERADMIN_PASS="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: curl -fsSL .../fix-mongodb.sh | sudo bash" >&2
  exit 1
fi

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  echo "Missing ${INSTALL_DIR}/.env — run install.sh first." >&2
  exit 1
fi

LIB="${INSTALL_DIR}/deploy/lib.sh"
[[ -f "$LIB" ]] || LIB="$(cd "$(dirname "$0")" && pwd)/lib.sh"
# shellcheck source=/dev/null
source "$LIB"

server_ip="$(detect_server_ip)"

echo ""
echo "FoodMood MongoDB repair"
echo "  Path: ${INSTALL_DIR}"
echo ""

log_info "Stopping foodmood (MongoDB repair)..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

stabilize_mongod_service || true
ensure_services_running

if ! repair_mongodb_from_env; then
  log_err "MongoDB repair failed"
  run_diagnose "$server_ip"
  exit 1
fi

local_query="$(test_mongodb_app_query)"
if [[ "$local_query" != OK:* ]]; then
  log_err "MongoDB query test failed: ${local_query#FAIL:}"
  run_diagnose "$server_ip"
  exit 1
fi
log_ok "MongoDB ready (${local_query#OK:})"

log_info "Starting ${SERVICE_NAME}..."
systemctl restart "$SERVICE_NAME"

if ! wait_for_api_health 25; then
  log_err "API health check failed after MongoDB repair"
  run_diagnose "$server_ip"
  exit 1
fi

if [[ -n "$SUPERADMIN_PASS" ]]; then
  reset_superadmin_credentials "$SUPERADMIN_USER" "$SUPERADMIN_PASS" || exit 1
fi

log_ok "MongoDB fixed — open https://${server_ip}/login and sign in again"
echo ""
