#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — fix MongoDB + app (superadmin 503 / DB login error)
#
#  One-line:
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/fix-mongodb.sh | sudo bash -s -- --superadmin-pass 'Food@Super2026!'
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
      sed -n '2,8p' "$0"
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
echo "FoodMood — MongoDB + superadmin fix"
echo "  Server: ${server_ip}"
echo "  Path:   ${INSTALL_DIR}"
echo ""

log_info "Stopping foodmood..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

log_info "Fixing MongoDB config, logs, socket..."
repair_mongod_conf
fix_mongod_filesystem
fix_mongod_socket
stop_stray_mongod_processes

if ! stabilize_mongod_service; then
  log_err "Could not stabilize mongod"
  run_diagnose "$server_ip"
  exit 1
fi

if ! repair_mongodb_from_env; then
  log_err "MongoDB credential repair failed"
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

log_info "Installing systemd unit (wait-for-mongo)..."
install_foodmood_systemd_unit

log_info "Starting foodmood..."
systemctl restart "$SERVICE_NAME"

if ! wait_for_api_health 30; then
  log_err "API health check failed"
  journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null || true
  run_diagnose "$server_ip"
  exit 1
fi
log_ok "API healthy"

if [[ -n "$SUPERADMIN_PASS" ]]; then
  reset_superadmin_credentials "$SUPERADMIN_USER" "$SUPERADMIN_PASS" || exit 1
fi

admin_probe="$(test_admin_route_no_db_error "$server_ip" "/admin/super/security" || true)"
if [[ "${admin_probe%%|*}" == OK* ]]; then
  log_ok "Superadmin route OK (${admin_probe#*|})"
else
  log_warn "Superadmin route check: ${admin_probe}"
  log_warn "MongoDB may be OK but app still shows DB error — try: systemctl restart foodmood"
fi

echo ""
log_ok "Done — IMPORTANT: clear browser cookies or use Incognito"
echo -e "  ${BOLD}https://${server_ip}/login${NC}"
echo -e "  User: ${SUPERADMIN_USER}  Pass: (your --superadmin-pass)"
echo ""
