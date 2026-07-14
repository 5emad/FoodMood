#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — full wipe (app + MongoDB) then instructions for install
#
#  One-line:
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/purge-all.sh | sudo bash
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

echo "[*] Removing FoodMood application..."
bash "${SCRIPT_DIR}/uninstall.sh" 2>/dev/null || {
  systemctl stop foodmood mongod nginx 2>/dev/null || true
  rm -rf /opt/food
  rm -f /etc/systemd/system/foodmood.service /etc/sudoers.d/foodmood-ssl
  rm -f /etc/nginx/sites-enabled/food /etc/nginx/sites-available/food
  systemctl daemon-reload 2>/dev/null || true
}

echo ""
bash "${SCRIPT_DIR}/reset-mongodb.sh"
