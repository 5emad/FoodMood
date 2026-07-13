#!/usr/bin/env bash
# نصب یک‌خطی سامانه تغذیه از GitHub روی سرور خام Ubuntu/Debian
#
# استفاده (روی سرور):
#   curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh | sudo bash -s -- --quick
#
# یا اگر مخزن خصوصی است، با توکن:
#   sudo bash bootstrap.sh --repo https://<TOKEN>@github.com/5emad/FoodMood.git --quick
#
# نصب نسخه مشخص:
#   curl -fsSL .../bootstrap.sh | sudo bash -s -- --tag v1.1.0 --quick
#
# گزینه‌ها:
#   --repo <url>     آدرس مخزن گیت (پیش‌فرض: مخزن GitHub پروژه)
#   --branch <name>  شاخه (پیش‌فرض: main)
#   --tag <vX.Y.Z>   نسخه مشخص (مثال: v1.1.0) — اولویت بر شاخه
#   --quick          نصب سریع: فقط یوزر/پس دیتابیس پرسیده می‌شود؛ سوپرادمین خودکار ساخته می‌شود
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/5emad/FoodMood.git}"
BRANCH="main"
GIT_REF=""
QUICK_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)   REPO_URL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --tag)    GIT_REF="$2"; shift 2 ;;
    --quick|-q) QUICK_FLAG="--quick"; shift ;;
    *) shift ;;
  esac
done

[[ -n "$GIT_REF" ]] && BRANCH="$GIT_REF"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "[✗] باید با root اجرا شود (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq git; }

CLONE_DIR="$(mktemp -d /tmp/food-install-XXXXXX)"
trap 'rm -rf "$CLONE_DIR"' EXIT

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ▶ مرحله ۰/۱۷: دریافت سورس از GitHub"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[*] مخزن: ${REPO_URL}"
echo "[*] شاخه: ${BRANCH}"
[[ -n "$QUICK_FLAG" ]] && echo "[*] حالت: نصب سریع (--quick)"
echo "[*] کلون — ممکن است ۳۰ ثانیه تا ۲ دقیقه طول بکشد..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ▶ شروع نصب‌کننده install-ubuntu.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$CLONE_DIR/deploy/install-ubuntu.sh" $QUICK_FLAG
