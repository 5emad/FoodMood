#!/usr/bin/env bash
# Fix CSS/login on HTTP-only servers (no SSL) — clears HSTS mismatch and publicUrl.
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
SERVICE_NAME="foodmood"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "[✗] Run as root: sudo bash deploy/fix-http.sh"
  exit 1
fi

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  echo "[✗] ${INSTALL_DIR}/.env not found"
  exit 1
fi

# shellcheck disable=SC1091
source "${INSTALL_DIR}/.env"

SERVER_IP="${APP_URL#http://}"
SERVER_IP="${SERVER_IP#https://}"
SERVER_IP="${SERVER_IP%%/*}"
SERVER_IP="${SERVER_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"

echo "[*] Server IP: ${SERVER_IP}"
echo "[*] Patching .env ..."

grep -v '^TRUST_TLS=' "${INSTALL_DIR}/.env" > /tmp/food-env.tmp || true
mv /tmp/food-env.tmp "${INSTALL_DIR}/.env"
{
  echo "TRUST_TLS=false"
  echo "APP_URL=http://${SERVER_IP}"
  echo "ALLOWED_ORIGINS=http://${SERVER_IP}"
} >> "${INSTALL_DIR}/.env"
chown "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/.env"
chmod 600 "${INSTALL_DIR}/.env"

if [[ -n "${MONGODB_URI:-}" ]] && command -v mongosh >/dev/null 2>&1; then
  echo "[*] Fixing publicUrl in MongoDB ..."
  mongosh "${MONGODB_URI}" --quiet --eval \
    "db.appsettings.updateOne({key:'default'}, {\$set:{publicUrl:'http://${SERVER_IP}'}}, {upsert:true})"
fi

if [[ -f "${INSTALL_DIR}/deploy/fix-http.sh" ]]; then
  chmod +x "${INSTALL_DIR}/deploy/fix-http.sh"
fi

systemctl restart "${SERVICE_NAME}"
sleep 2

echo ""
echo "[✓] Done. Test from the server:"
echo "    curl -sI http://${SERVER_IP}/login | grep -iE 'strict|cross-origin'"
echo "    curl -sI http://${SERVER_IP}/css/enterprise-theme.css | head -2"
echo ""
echo "[!] On your PC browser:"
echo "    1) Open Incognito/Private window"
echo "    2) Go to: http://${SERVER_IP}/login  (must be http, not https)"
echo "    3) Or clear HSTS: chrome://net-internals/#hsts → Delete → ${SERVER_IP}"
