#!/usr/bin/env bash
# Apply uploaded SSL certificate from /opt/food/certs/ssl/ and reload Nginx.
# Called by superadmin panel (sudo) or manually: sudo bash /opt/food/deploy/apply-custom-ssl.sh
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
SERVICE_NAME="foodmood"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

CERT="${INSTALL_DIR}/certs/ssl/custom.crt"
KEY="${INSTALL_DIR}/certs/ssl/custom.key"

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  echo "Missing custom.crt or custom.key in ${INSTALL_DIR}/certs/ssl/" >&2
  exit 1
fi

if ! openssl x509 -in "$CERT" -noout >/dev/null 2>&1; then
  echo "Invalid certificate file" >&2
  exit 1
fi

if ! openssl rsa -in "$KEY" -check -noout >/dev/null 2>&1 \
  && ! openssl ec -in "$KEY" -check -noout >/dev/null 2>&1; then
  echo "Invalid private key file" >&2
  exit 1
fi

chmod 644 "$CERT"
chmod 640 "$KEY"
chown root:root "$CERT" "$KEY"
if getent group ssl-cert >/dev/null 2>&1; then
  chgrp ssl-cert "$KEY"
elif id www-data >/dev/null 2>&1; then
  chgrp www-data "$KEY"
fi

detect_server_ip() {
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
  if [[ -z "$ip" ]]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

# shellcheck source=/dev/null
source "${INSTALL_DIR}/deploy/nginx-tls.sh"

SERVER_IP="$(detect_server_ip)"
configure_dual_stack "$SERVER_IP" "$INSTALL_DIR" "$APP_USER"
systemctl restart "$SERVICE_NAME"

echo "Custom SSL certificate applied for https://${SERVER_IP}"
