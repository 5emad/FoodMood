#!/usr/bin/env bash
# Apply uploaded SSL certificate and reload Nginx.
# Panel: foodapp writes /tmp/foodmood-ssl-staging/upload.{crt,key} then:
#   sudo -n /opt/food/deploy/apply-custom-ssl.sh
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="$(stat -c '%U' "${INSTALL_DIR}" 2>/dev/null || true)"
APP_USER="${APP_USER:-foodapp}"
SERVICE_NAME="foodmood"

CERT="${INSTALL_DIR}/certs/ssl/custom.crt"
KEY="${INSTALL_DIR}/certs/ssl/custom.key"
PANEL_STAGING="/tmp/foodmood-ssl-staging"
STAGING_CERT="${PANEL_STAGING}/upload.crt"
STAGING_KEY="${PANEL_STAGING}/upload.key"
LEGACY_STAGING_CERT="${INSTALL_DIR}/certs/ssl/staging/upload.crt"
LEGACY_STAGING_KEY="${INSTALL_DIR}/certs/ssl/staging/upload.key"

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
elif [[ -f "$LEGACY_STAGING_CERT" && -f "$LEGACY_STAGING_KEY" ]]; then
  SOURCE_CERT="$LEGACY_STAGING_CERT"
  SOURCE_KEY="$LEGACY_STAGING_KEY"
  FROM_STAGING=1
fi

if [[ ! -f "$SOURCE_CERT" || ! -f "$SOURCE_KEY" ]]; then
  echo "Missing certificate or private key file (panel staging or ${CERT})" >&2
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

install -m 644 -o "${APP_USER}:${APP_USER}" "$SOURCE_CERT" "$CERT"
install -m 600 -o "${APP_USER}:${APP_USER}" "$SOURCE_KEY" "$KEY"

if [[ "$FROM_STAGING" == "1" ]]; then
  rm -f "$STAGING_CERT" "$STAGING_KEY" "$LEGACY_STAGING_CERT" "$LEGACY_STAGING_KEY" 2>/dev/null || true
fi

install_custom_certificate_for_nginx "$INSTALL_DIR"

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
NGINX_CERT_PATH="${NGINX_SSL_DIR}/foodmood.crt"

reload_existing_nginx_site() {
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/food 2>/dev/null || true
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  local test_out
  if test_out="$(nginx -t 2>&1)"; then
    systemctl reload nginx
    return 0
  fi
  echo "$test_out" >&2
  return 1
}

if [[ -f "$NGINX_SITE" ]] && grep -qF "${NGINX_CERT_PATH}" "$NGINX_SITE" 2>/dev/null; then
  if reload_existing_nginx_site; then
    configure_app_https_env "$SERVER_IP" "$INSTALL_DIR" "$APP_USER" "$NGINX_CERT_PATH" || true
  else
    echo "nginx reload failed — rebuilding site config" >&2
    configure_dual_stack "$SERVER_IP" "$INSTALL_DIR" "$APP_USER" || {
      echo "nginx config test failed during SSL apply" >&2
      exit 1
    }
  fi
else
  if ! configure_dual_stack "$SERVER_IP" "$INSTALL_DIR" "$APP_USER"; then
    echo "nginx config test failed during SSL apply" >&2
    exit 1
  fi
fi

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
