#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — complete MongoDB reset (fresh database, no auth)
#
#  Use when MongoDB step fails on reinstall (createUser / auth errors).
#
#  One-line:
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/reset-mongodb.sh | sudo bash
#
#  Local:
#    sudo bash deploy/reset-mongodb.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()  { echo -e "${RED}[✗]${NC} $*" >&2; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  log_err "Run as root: sudo bash $0"
  exit 1
fi

MONGOD_CONF="/etc/mongod.conf"
DATA_DIR="/var/lib/mongodb"
LOG_DIR="/var/log/mongodb"

log_warn "This will DELETE all MongoDB data on this server."
log_info "Stopping FoodMood and MongoDB..."
systemctl stop foodmood 2>/dev/null || true
systemctl stop mongod 2>/dev/null || true
sleep 1

if [[ -f "$MONGOD_CONF" ]]; then
  log_info "Backing up and resetting ${MONGOD_CONF} (remove authentication)..."
  cp -a "$MONGOD_CONF" "${MONGOD_CONF}.bak.$(date +%s)"
  awk '
    /^security:/ { skip=1; next }
    skip && /^[^[:space:]#]/ { skip=0 }
    skip { next }
    { print }
  ' "$MONGOD_CONF" > "${MONGOD_CONF}.tmp"
  mv "${MONGOD_CONF}.tmp" "$MONGOD_CONF"
  log_ok "MongoDB config: security/auth block removed."
else
  log_warn "No ${MONGOD_CONF} found — skipping config reset."
fi

log_info "Wiping MongoDB data in ${DATA_DIR} ..."
mkdir -p "$DATA_DIR"
find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
rm -f "${DATA_DIR}/.mongodb" "${DATA_DIR}/storage.bson" 2>/dev/null || true

if [[ -d "$LOG_DIR" ]]; then
  log_info "Clearing MongoDB logs..."
  find "$LOG_DIR" -type f -name '*.log' -delete 2>/dev/null || true
fi

if id mongodb &>/dev/null; then
  chown -R mongodb:mongodb "$DATA_DIR" "$LOG_DIR" 2>/dev/null || true
fi

log_info "Starting MongoDB (no authentication)..."
systemctl enable mongod 2>/dev/null || true
systemctl start mongod 2>/dev/null || systemctl restart mongod

ready=0
for _ in $(seq 1 30); do
  if mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  log_err "MongoDB did not start. Check: journalctl -u mongod -n 40"
  exit 1
fi

log_ok "MongoDB reset complete — empty database, no users, no auth."
echo ""

if [[ -f /opt/food/.env && -f /opt/food/deploy/lib.sh ]]; then
  log_info "Recreating MongoDB user from /opt/food/.env (no full reinstall)..."
  # shellcheck source=/dev/null
  source /opt/food/deploy/lib.sh
  if repair_mongodb_from_env; then
    log_ok "MongoDB user restored from .env"
    systemctl restart foodmood 2>/dev/null || true
    echo ""
    echo -e "${GREEN}Open:${NC} https://$(detect_server_ip 2>/dev/null || echo 'SERVER_IP')/login"
    echo -e "${YELLOW}Superadmin may need reset:${NC}"
    echo "  curl -fsSL .../deploy/fix-mongodb.sh | sudo bash -s -- --superadmin-pass 'YourPass@123!'"
    echo ""
    exit 0
  fi
  log_warn "Could not auto-restore user — run install.sh or fix-mongodb.sh"
fi

echo -e "${GREEN}Next step — fresh FoodMood install:${NC}"
echo "  curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/install.sh | sudo bash"
echo ""
