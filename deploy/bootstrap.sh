#!/usr/bin/env bash
# نصب یک‌خطی سامانه تغذیه از GitHub روی سرور خام Ubuntu/Debian
#
# استفاده (روی سرور):
#   curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh | sudo bash -s -- --quick
#
# یا اگر مخزن خصوصی است، با توکن:
#   sudo bash bootstrap.sh --repo https://<TOKEN>@github.com/5emad/FoodMood.git --quick
#
# گزینه‌ها:
#   --repo <url>     آدرس مخزن گیت (پیش‌فرض: مخزن GitHub پروژه)
#   --branch <name>  شاخه (پیش‌فرض: main)
#   --quick          نصب سریع: فقط یوزر/پس دیتابیس پرسیده می‌شود؛ سوپرادمین خودکار ساخته می‌شود
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/5emad/FoodMood.git}"
BRANCH="main"
QUICK_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)   REPO_URL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --quick|-q) QUICK_FLAG="--quick"; shift ;;
    *) shift ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "[✗] باید با root اجرا شود (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq git; }

CLONE_DIR="$(mktemp -d /tmp/food-install-XXXXXX)"
trap 'rm -rf "$CLONE_DIR"' EXIT

echo "[*] دریافت سورس از ${REPO_URL} (شاخه ${BRANCH})..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR"

echo "[*] اجرای نصب‌کننده..."
bash "$CLONE_DIR/deploy/install-ubuntu.sh" $QUICK_FLAG
