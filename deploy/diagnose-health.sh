#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — diagnose "سامانه در دسترس نیست" / login failures
#
#  Run on server:
#    sudo bash /opt/food/deploy/diagnose-health.sh
#  One-line:
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/diagnose-health.sh | sudo bash
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
SERVICE_NAME="foodmood"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()  { echo -e "${RED}[✗]${NC} $*" >&2; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  log_err "Run as root: sudo bash $0"
  exit 1
fi

if [[ ! -d "$INSTALL_DIR" || ! -f "${INSTALL_DIR}/.env" ]]; then
  log_err "FoodMood not installed at ${INSTALL_DIR}"
  exit 1
fi

ENV_FILE="${INSTALL_DIR}/.env"
server_ip() {
  local ip app_url
  app_url="$(grep '^APP_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  app_url="${app_url#http://}"
  app_url="${app_url#https://}"
  ip="${app_url%%/*}"
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  echo "${ip:-127.0.0.1}"
}

IP="$(server_ip)"
echo ""
echo -e "${BOLD}FoodMood health diagnosis${NC}"
echo -e "Server: ${IP}  |  Path: ${INSTALL_DIR}"
echo ""

log_info "Service status..."
mongod_state="$(systemctl is-active mongod 2>/dev/null || echo inactive)"
food_state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo inactive)"
echo "  mongod:   ${mongod_state}"
echo "  foodmood: ${food_state}"

if [[ "$mongod_state" != "active" ]]; then
  log_warn "Starting mongod..."
  systemctl start mongod 2>/dev/null || systemctl restart mongod 2>/dev/null || true
  sleep 2
fi

log_info "MongoDB ping (no auth)..."
if mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'; then
  log_ok "mongod responds to ping"
else
  log_err "mongod is not responding — check: journalctl -u mongod -n 40"
fi

log_info "Testing MONGODB_URI from .env..."
mongo_test="$(sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node -e \"
require('dotenv').config();
const mongoose = require('mongoose');
const uri = process.env.MONGODB_URI || '';
if (!uri) { console.log('MISSING_URI'); process.exit(2); }
mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 })
  .then(() => mongoose.connection.db.admin().command({ ping: 1 }))
  .then(() => { console.log('OK'); return mongoose.disconnect(); })
  .catch((e) => { console.log('FAIL:' + (e.message || e)); process.exit(1); });
\"" 2>&1 || true)"

case "$mongo_test" in
  OK) log_ok "App can connect to MongoDB with .env credentials" ;;
  MISSING_URI) log_err "MONGODB_URI is empty in .env" ;;
  FAIL:*) log_err "MongoDB auth/connection failed: ${mongo_test#FAIL:}" ;;
  *) log_err "MongoDB test failed: $mongo_test" ;;
esac

log_info "App health API..."
health_json="$(curl -sf --max-time 8 http://127.0.0.1:3000/api/system/health 2>/dev/null || curl -s --max-time 8 http://127.0.0.1:3000/api/system/health 2>/dev/null || echo '{}')"
echo "  $health_json"
if echo "$health_json" | grep -q '"healthy":true'; then
  log_ok "Health API reports healthy"
else
  log_warn "Health API reports unhealthy — login will show «در دسترس نیست»"
fi

log_info "Login API probe (wrong password — should be 401, not 503)..."
login_code="$(curl -s -o /tmp/food-login-probe.json -w '%{http_code}' --max-time 10 \
  -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -H "Origin: https://${IP}" \
  -d '{"username":"probe","password":"probe"}' 2>/dev/null || echo '000')"
login_msg="$(python3 -c 'import json; print(json.load(open("/tmp/food-login-probe.json", encoding="utf-8")).get("message",""))' 2>/dev/null || true)"
echo "  HTTP ${login_code} — ${login_msg:-?}"
if [[ "$login_code" == "503" ]] || echo "$login_msg" | grep -q 'در دسترس نمی'; then
  log_err "Login blocked by service-unavailable gate (MongoDB issue)"
elif [[ "$login_code" == "401" || "$login_code" == "400" ]]; then
  log_ok "Login API reachable (credentials were wrong on purpose)"
elif [[ "$login_code" == "403" ]]; then
  log_warn "Origin guard blocked request — check APP_URL / ALLOWED_ORIGINS in .env"
else
  log_warn "Unexpected login response HTTP ${login_code}"
fi

echo ""
log_info "Recent foodmood logs:"
journalctl -u "$SERVICE_NAME" -n 15 --no-pager 2>/dev/null || true

echo ""
echo -e "${BOLD}Fix steps (most common):${NC}"
echo "  1) Restart MongoDB + app:"
echo "       sudo systemctl restart mongod && sudo systemctl restart foodmood"
echo "  2) If MongoDB auth fails, reinstall DB user (keeps .env if possible):"
echo "       curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/reset-mongodb.sh | sudo bash"
echo "       curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/install.sh | sudo bash"
echo "  3) Reset superadmin after DB fix:"
echo "       sudo -u foodapp bash -c 'cd ${INSTALL_DIR} && node scripts/super-admin.js create superadmin \"Food@Super2026!\"'"
echo "  4) Full site repair:"
echo "       curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/fix-site.sh | sudo bash"
echo ""
