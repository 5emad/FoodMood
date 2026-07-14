#!/usr/bin/env bash
# Sync vendor fonts/CSS/JS into public/vendor and restart FoodMood.
#   sudo bash /opt/food/deploy/sync-vendor.sh
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
SERVICE_NAME="foodmood"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  echo "Install path ${INSTALL_DIR} not found." >&2
  exit 1
fi

echo "[*] Syncing vendor assets..."
sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm run vendor:sync"

missing=0
for f in \
  public/vendor/vazirmatn/Vazirmatn-Regular.woff2 \
  public/vendor/vazirmatn/Vazirmatn-Bold.woff2 \
  public/vendor/vazirmatn/Vazirmatn-Black.woff2 \
  public/vendor/fontawesome/webfonts/fa-solid-900.woff2 \
  public/vendor/fontawesome/css/all.min.css \
  public/css/enterprise-theme.css
do
  if [[ ! -f "${INSTALL_DIR}/${f}" ]]; then
    echo "[✗] Missing: ${f}" >&2
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "[✗] Vendor sync incomplete. Try: cd $INSTALL_DIR && npm install && npm run vendor:sync" >&2
  exit 1
fi

chmod -R a+rX "${INSTALL_DIR}/public" 2>/dev/null || true
systemctl restart "$SERVICE_NAME"

version="$(python3 -c 'import json; print(json.load(open("'"${INSTALL_DIR}/package.json"'", encoding="utf-8"))["version"])' 2>/dev/null || echo '?')"
echo "[✓] Vendor assets OK — FoodMood v${version} restarted."
