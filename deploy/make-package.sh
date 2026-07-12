#!/usr/bin/env bash
# ساخت بسته نصبی قابل‌حمل (tar.gz) برای بردن روی سرور بدون گیت
#
# اجرا از ریشه پروژه (روی سیستم خودتان یا CI):
#   bash deploy/make-package.sh
#
# خروجی: dist/food-install-<تاریخ>.tar.gz
#
# روی سرور:
#   tar -xzf food-install-*.tar.gz
#   cd food
#   sudo bash deploy/install-ubuntu.sh --quick
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M)"
OUT_DIR="${PROJECT_DIR}/dist"
PKG_NAME="food-install-${STAMP}"

mkdir -p "$OUT_DIR"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "[*] کپی فایل‌های پروژه..."
rsync -a \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude dist \
  --exclude .mongodb-data \
  --exclude 'INSTALL_INFO.txt' \
  --exclude 'CREDENTIALS.txt' \
  --exclude '*.log' \
  "$PROJECT_DIR/" "$STAGE/food/"

echo "[*] ساخت آرشیو..."
tar -C "$STAGE" -czf "${OUT_DIR}/${PKG_NAME}.tar.gz" food

echo "[✓] بسته آماده شد: dist/${PKG_NAME}.tar.gz"
echo ""
echo "انتقال و نصب روی سرور:"
echo "  scp dist/${PKG_NAME}.tar.gz user@server:/tmp/"
echo "  ssh user@server"
echo "  cd /tmp && tar -xzf ${PKG_NAME}.tar.gz && cd food"
echo "  sudo bash deploy/install-ubuntu.sh --quick"
