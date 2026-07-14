#!/usr/bin/env bash
# Remove FoodMood application.
#   sudo bash deploy/uninstall.sh
#   sudo bash deploy/uninstall.sh --purge-mongo   # also reset MongoDB
set -euo pipefail

INSTALL_DIR="/opt/food"
SERVICE_NAME="foodmood"
PURGE_MONGO=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-mongo) PURGE_MONGO=1; shift ;;
    -h|--help)
      sed -n '1,5p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

echo "[*] Stopping services..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true

echo "[*] Removing systemd unit..."
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

echo "[*] Removing Nginx site..."
rm -f /etc/nginx/sites-enabled/food /etc/nginx/sites-available/food
nginx -t 2>/dev/null && systemctl restart nginx 2>/dev/null || true

echo "[*] Removing application files (${INSTALL_DIR})..."
rm -rf "$INSTALL_DIR"

echo "[*] Removing SSL sudoers rule..."
rm -f /etc/sudoers.d/foodmood-ssl

rm -f /tmp/food-env-backup-*.env 2>/dev/null || true

echo "[✓] FoodMood removed."

if [[ "$PURGE_MONGO" -eq 1 ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  echo ""
  bash "${SCRIPT_DIR}/reset-mongodb.sh"
else
  echo "    MongoDB data kept. Full DB wipe: sudo bash deploy/reset-mongodb.sh"
  echo "    Fresh install: curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/install.sh | sudo bash"
fi
