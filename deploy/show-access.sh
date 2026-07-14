#!/usr/bin/env bash
# Show FoodMood install URL and recover access after a partial install.
#   sudo bash /opt/food/deploy/show-access.sh
set -euo pipefail

INSTALL_DIR="/opt/food"
SERVICE_NAME="foodmood"

if [[ ! -d "$INSTALL_DIR" ]]; then
  echo "FoodMood not installed at ${INSTALL_DIR}" >&2
  exit 1
fi

server_ip() {
  local ip app_url
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    app_url="$(grep '^APP_URL=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
    app_url="${app_url#http://}"
    app_url="${app_url#https://}"
    ip="${app_url%%/*}"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  echo "${ip:-127.0.0.1}"
}

IP="$(server_ip)"
echo ""
echo "FoodMood status: $(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo unknown)"
echo "Login URL:       https://${IP}/login"
echo "App path:        ${INSTALL_DIR}"
echo ""
echo "MongoDB URI is in: ${INSTALL_DIR}/.env"
echo ""
echo "Reset superadmin password:"
echo "  sudo -u foodapp bash -c 'cd ${INSTALL_DIR} && node scripts/super-admin.js create superadmin \"YourNewPass@123\"'"
echo ""
