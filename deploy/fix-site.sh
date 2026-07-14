#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — fix site not loading (nginx / HTTPS / permissions)
#
#  Run on server:
#    sudo bash /opt/food/deploy/fix-site.sh
#  Or one-line (after push to GitHub):
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/fix-site.sh | sudo bash
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
  log_err "FoodMood not installed at ${INSTALL_DIR}. Run install.sh first."
  exit 1
fi

detect_server_ip() {
  local ip app_url
  app_url="$(grep '^APP_URL=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  app_url="${app_url#http://}"
  app_url="${app_url#https://}"
  ip="${app_url%%/*}"
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  echo "${ip:-127.0.0.1}"
}

SERVER_IP="$(detect_server_ip)"

log_info "Fixing FoodMood site for https://${SERVER_IP} ..."

# shellcheck source=/dev/null
source "${INSTALL_DIR}/deploy/nginx-tls.sh"

wait_for_foodmood() {
  local attempts="${1:-30}" i
  for ((i = 1; i <= attempts; i++)); do
    if curl -sf --max-time 5 http://127.0.0.1:3000/api/system/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

log_info "Starting services..."
systemctl enable mongod nginx "$SERVICE_NAME" 2>/dev/null || true
systemctl start mongod 2>/dev/null || true
configure_https_only "$SERVER_IP" "$INSTALL_DIR" "$APP_USER" || true

log_info "Syncing vendor fonts..."
sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm run vendor:sync"
chmod -R a+rX "${INSTALL_DIR}/public" 2>/dev/null || true
systemctl restart "$SERVICE_NAME"

if ! wait_for_foodmood 30; then
  log_err "foodmood is not healthy on port 3000"
  journalctl -u "$SERVICE_NAME" -n 25 --no-pager || true
  exit 1
fi

node_font="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/vendor/vazirmatn/Vazirmatn-Regular.woff2 2>/dev/null || echo '000')"
if [[ "$node_font" != "200" ]]; then
  log_err "Node does not serve fonts (HTTP ${node_font}). Check files in ${INSTALL_DIR}/public/vendor/"
  ls -la "${INSTALL_DIR}/public/vendor/vazirmatn/" 2>/dev/null | head -5 || true
  exit 1
fi
log_ok "Node serves fonts (HTTP 200)"

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp comment 'HTTP redirect' >/dev/null 2>&1 || true
  ufw allow 443/tcp comment 'HTTPS / Nginx' >/dev/null 2>&1 || true
fi

font_code="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "https://${SERVER_IP}/vendor/vazirmatn/Vazirmatn-Regular.woff2" 2>/dev/null || echo '000')"
fa_code="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "https://${SERVER_IP}/vendor/fontawesome/webfonts/fa-solid-900.woff2" 2>/dev/null || echo '000')"
installed_version="$(python3 -c 'import json; print(json.load(open("'"${INSTALL_DIR}/package.json"'", encoding="utf-8"))["version"])' 2>/dev/null || echo '?')"

echo "  fonts vazirmatn: HTTPS ${font_code}"
echo "  fonts fontawesome: HTTPS ${fa_code}"
echo "  installed version: v${installed_version}"
echo ""
echo "  foodmood: $(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo down)"
echo "  nginx:    $(systemctl is-active nginx 2>/dev/null || echo down)"
echo "  mongod:   $(systemctl is-active mongod 2>/dev/null || echo down)"
ss -tln 2>/dev/null | grep -E ':80 |:443 |:3000 ' || log_warn "Expected ports 80/443/3000 not all listening"

local_code="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/login 2>/dev/null || echo '000')"
https_code="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "https://${SERVER_IP}/login" 2>/dev/null || echo '000')"
css_code="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "https://${SERVER_IP}/css/enterprise-theme.css" 2>/dev/null || echo '000')"

echo "  node /login:  HTTP ${local_code}"
echo "  nginx /login: HTTPS ${https_code}"
echo "  nginx CSS:    HTTPS ${css_code}"
echo ""

if [[ "$https_code" == "200" && "$css_code" == "200" ]]; then
  log_ok "Site is up."
else
  log_warn "Site may still have issues. Check:"
  echo "    journalctl -u nginx -n 30"
  echo "    journalctl -u foodmood -n 30"
fi

echo ""
echo -e "${GREEN}${BOLD}Open in browser:${NC}"
echo -e "  ${BOLD}https://${SERVER_IP}/login${NC}"
echo -e "${YELLOW}[!]${NC} Accept self-signed certificate: Advanced → Proceed"
echo ""
