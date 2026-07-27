#!/usr/bin/env bash
# Apply uploaded SSL certificate and reload Nginx.
# Panel flow: foodapp writes /opt/food/certs/ssl/staging/* then runs:
#   sudo -n /opt/food/deploy/apply-custom-ssl.sh
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="$(stat -c '%U' "${INSTALL_DIR}" 2>/dev/null || true)"
APP_USER="${APP_USER:-foodapp}"
SERVICE_NAME="foodmood"

CERT="${INSTALL_DIR}/certs/ssl/custom.crt"
KEY="${INSTALL_DIR}/certs/ssl/custom.key"
STAGING_CERT="${INSTALL_DIR}/certs/ssl/staging/upload.crt"
STAGING_KEY="${INSTALL_DIR}/certs/ssl/staging/upload.key"

if [[ "${1:-}" == "--verify-access" ]]; then
  echo "apply-custom-ssl: sudo access OK"
  exit 0
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

SOURCE_CERT="$CERT"
SOURCE_KEY="$KEY"
FROM_STAGING=0

if [[ -f "$STAGING_CERT" && -f "$STAGING_KEY" ]]; then
  SOURCE_CERT="$STAGING_CERT"
  SOURCE_KEY="$STAGING_KEY"
  FROM_STAGING=1
elif [[ -n "${1:-}" && -n "${2:-}" ]]; then
  SOURCE_CERT="$1"
  SOURCE_KEY="$2"
fi

if [[ ! -f "$SOURCE_CERT" || ! -f "$SOURCE_KEY" ]]; then
  echo "Missing certificate or private key file" >&2
  exit 1
fi

if ! openssl x509 -in "$SOURCE_CERT" -noout >/dev/null 2>&1; then
  echo "Invalid certificate file" >&2
  exit 1
fi

if ! openssl pkey -in "$SOURCE_KEY" -noout >/dev/null 2>&1; then
  if grep -q 'ENCRYPTED' "$SOURCE_KEY" 2>/dev/null; then
    echo "Private key is encrypted; upload an unencrypted PEM key" >&2
    exit 1
  fi
  echo "Invalid private key file" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${INSTALL_DIR}/deploy/nginx-tls.sh"

if ! verify_cert_key_match "$SOURCE_CERT" "$SOURCE_KEY"; then
  echo "Certificate and private key do not match" >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}/certs/ssl"
ensure_ssl_storage_permissions "$INSTALL_DIR" "$APP_USER"

if [[ "$SOURCE_CERT" != "$CERT" || "$SOURCE_KEY" != "$KEY" ]]; then
  install -m 644 -o "${APP_USER}:${APP_USER}" "$SOURCE_CERT" "$CERT"
  install -m 600 -o "${APP_USER}:${APP_USER}" "$SOURCE_KEY" "$KEY"
fi

if [[ "$FROM_STAGING" == "1" ]]; then
  rm -f "$STAGING_CERT" "$STAGING_KEY" 2>/dev/null || true
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

SERVER_IP="$(detect_server_ip)"
if ! configure_dual_stack "$SERVER_IP" "$INSTALL_DIR" "$APP_USER"; then
  echo "nginx config test failed during SSL apply" >&2
  exit 1
fi

if id "$APP_USER" >/dev/null 2>&1; then
  chown "${APP_USER}:${APP_USER}" "$CERT" "$KEY" 2>/dev/null || true
fi
chmod 644 "$CERT"
chmod 600 "$KEY"

systemctl restart "$SERVICE_NAME" || {
  echo "foodmood service restart failed" >&2
  exit 1
}

CERT_HOST="$(extract_cert_primary_host "$CERT" 2>/dev/null || true)"
if [[ -n "$CERT_HOST" ]]; then
  echo "Custom SSL certificate applied for https://${CERT_HOST}"
else
  echo "Custom SSL certificate applied for https://${SERVER_IP}"
fi
