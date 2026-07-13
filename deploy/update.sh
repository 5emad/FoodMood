#!/usr/bin/env bash
# به‌روزرسانی سامانه FoodMood روی سرور نصب‌شده (/opt/food)
#
# آخرین نسخه (شاخه main):
#   sudo bash /opt/food/deploy/update.sh
#
# نسخه مشخص (تگ):
#   sudo bash /opt/food/deploy/update.sh --tag v1.1.0
#
# شاخه دیگر:
#   sudo bash /opt/food/deploy/update.sh --branch develop
#
# فقط بررسی نسخه فعلی و موجود:
#   sudo bash /opt/food/deploy/update.sh --status
#
# نصب یک‌خطی از GitHub (اگر اسکریپت محلی نیست):
#   curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash -s -- --tag v1.1.0
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/5emad/FoodMood.git}"
INSTALL_DIR="/opt/food"
APP_USER="foodapp"
SERVICE_NAME="foodmood"
BRANCH="main"
TAG=""
LIST_TAGS=0
SHOW_STATUS=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()   { echo -e "${RED}[✗]${NC} $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)   REPO_URL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; TAG=""; shift 2 ;;
    --tag)    TAG="$2"; BRANCH=""; shift 2 ;;
    --list)   LIST_TAGS=1; shift ;;
    --status) SHOW_STATUS=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) log_err "گزینه ناشناخته: $1"; exit 1 ;;
  esac
done

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_err "باید با root اجرا شود: sudo bash deploy/update.sh"
    exit 1
  fi
}

read_installed_version() {
  local pkg="${INSTALL_DIR}/package.json"
  if [[ -f "$pkg" ]]; then
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("version","?"))' "$pkg" 2>/dev/null || echo "?"
  else
    echo "?"
  fi
}

list_remote_tags() {
  log_info "نسخه‌های منتشرشده در ${REPO_URL}:"
  git ls-remote --tags "$REPO_URL" 2>/dev/null \
    | awk '{print $2}' \
    | sed 's|refs/tags/||' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -20
}

show_status() {
  local current
  current="$(read_installed_version)"
  echo ""
  echo -e "${BOLD}نسخه نصب‌شده:${NC}  v${current}"
  echo -e "${BOLD}مسیر نصب:${NC}      ${INSTALL_DIR}"
  echo -e "${BOLD}وضعیت سرویس:${NC}   $(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'نامشخص')"
  echo ""
  echo -e "${BOLD}آخرین تگ‌های GitHub:${NC}"
  list_remote_tags
  echo ""
}

fetch_source() {
  local clone_dir
  clone_dir="$(mktemp -d /tmp/food-update-XXXXXX)"

  if [[ -n "$TAG" ]]; then
    log_info "دریافت نسخه ${TAG} از ${REPO_URL}..." >&2
    git clone --depth 1 --branch "$TAG" "$REPO_URL" "$clone_dir" >&2
  else
    log_info "دریافت شاخه ${BRANCH} از ${REPO_URL}..." >&2
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$clone_dir" >&2
  fi

  NEW_VERSION="$(python3 -c 'import json; print(json.load(open("package.json", encoding="utf-8"))["version"])' "$clone_dir/package.json")"
  echo "$clone_dir"
}

apply_update() {
  local source_dir="$1"
  local old_version new_version
  old_version="$(read_installed_version)"

  if [[ ! -d "$INSTALL_DIR" ]]; then
    log_err "مسیر نصب ${INSTALL_DIR} پیدا نشد. ابتدا install-ubuntu.sh را اجرا کنید."
    exit 1
  fi

  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    log_err "فایل .env در ${INSTALL_DIR} نیست — به‌روزرسانی بدون تنظیمات امن نیست."
    exit 1
  fi

  new_version="$NEW_VERSION"
  echo ""
  echo -e "${MAGENTA}${BOLD}  FoodMood Update${NC}"
  echo -e "  ${BOLD}از:${NC} v${old_version}  →  ${BOLD}به:${NC} v${new_version} (${TAG:-$BRANCH})"
  echo ""

  if [[ "$old_version" == "$new_version" && -z "$TAG" ]]; then
    log_warn "نسخه package.json تغییری نکرده — فقط فایل‌های سورس همگام می‌شوند."
  fi

  log_info "پشتیبان از .env..."
  cp -a "${INSTALL_DIR}/.env" "/tmp/food-env-backup-$(date +%s).env"

  log_info "همگام‌سازی فایل‌ها (حفظ .env و node_modules)..."
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude INSTALL_INFO.txt \
    --exclude '*.log' \
    "$source_dir/" "$INSTALL_DIR/"

  chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
  chmod 600 "${INSTALL_DIR}/.env"

  log_info "نصب وابستگی‌ها..."
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev"
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm run vendor:sync"

  migrate_systemd_service

  log_info "راه‌اندازی مجدد سرویس..."
  systemctl restart "$SERVICE_NAME"
  sleep 2

  if systemctl is-active --quiet "$SERVICE_NAME"; then
    log_ok "به‌روزرسانی موفق — FoodMood v${new_version} در حال اجراست."
  else
    log_err "سرویس بالا نیامد. لاگ: journalctl -u ${SERVICE_NAME} -n 40"
    exit 1
  fi

  {
    echo ""
    echo "─── آخرین به‌روزرسانی ───────────────────────────────────────"
    echo "  نسخه        : v${new_version}"
    echo "  مرجع گیت    : ${TAG:-$BRANCH}"
    echo "  تاریخ       : $(date '+%Y-%m-%d %H:%M:%S %Z')"
  } >> "${INSTALL_DIR}/INSTALL_INFO.txt" 2>/dev/null || true
}

migrate_env_keys() {
  local env_file="${INSTALL_DIR}/.env"
  [[ -f "$env_file" ]] || return 0

  ensure_env_key() {
    local key="$1"
    if grep -q "^${key}=" "$env_file" 2>/dev/null; then
      return 0
    fi
    local val
    val="$(openssl rand -base64 48 | tr -d '\n')"
    echo "${key}=${val}" >> "$env_file"
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
    log_warn "کلید ${key} به .env اضافه شد — در خزانه رمز سازمانی ثبت کنید"
  }

  ensure_env_key ANNOUNCEMENT_ENCRYPTION_KEY
  ensure_env_key LDAP_ENCRYPTION_KEY

  if ! grep -q '^TRUST_TLS=' "$env_file" 2>/dev/null; then
    if grep -q '^APP_URL=https://' "$env_file" 2>/dev/null; then
      echo 'TRUST_TLS=true' >> "$env_file"
    else
      echo 'TRUST_TLS=false' >> "$env_file"
    fi
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
    log_warn "TRUST_TLS به .env اضافه شد (برای HTTP باید false باشد)"
  fi

  if ! grep -q '^LOG_DIR=' "$env_file" 2>/dev/null; then
    echo 'LOG_DIR=/var/log/foodmood' >> "$env_file"
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
    log_warn "LOG_DIR=/var/log/foodmood به .env اضافه شد"
  fi
}

migrate_systemd_service() {
  mkdir -p /var/log/foodmood
  chown "$APP_USER:$APP_USER" /var/log/foodmood
  chmod 750 /var/log/foodmood

  migrate_env_keys

  if systemctl list-unit-files food.service >/dev/null 2>&1; then
    systemctl disable food 2>/dev/null || true
    systemctl stop food 2>/dev/null || true
    rm -f /etc/systemd/system/food.service
  fi

  if [[ -f "${INSTALL_DIR}/deploy/foodmood.service" ]]; then
    cp "${INSTALL_DIR}/deploy/foodmood.service" "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
  fi

  if ! grep -q '^LOG_DIR=' "${INSTALL_DIR}/.env" 2>/dev/null; then
    echo 'LOG_DIR=/var/log/foodmood' >> "${INSTALL_DIR}/.env"
    chown "$APP_USER:$APP_USER" "${INSTALL_DIR}/.env"
    chmod 600 "${INSTALL_DIR}/.env"
  fi

  chmod +x "${INSTALL_DIR}/deploy/"*.sh 2>/dev/null || true
}

main() {
  require_root
  export DEBIAN_FRONTEND=noninteractive
  command -v git >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq git rsync; }

  if [[ "$LIST_TAGS" -eq 1 ]]; then
    list_remote_tags
    exit 0
  fi

  if [[ "$SHOW_STATUS" -eq 1 ]]; then
    show_status
    exit 0
  fi

  if [[ -n "$TAG" && ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log_err "فرمت تگ نامعتبر است. مثال: v1.1.0"
    exit 1
  fi

  NEW_VERSION=""
  source_dir="$(fetch_source)"
  trap 'rm -rf "$source_dir"' EXIT
  apply_update "$source_dir"
}

main "$@"
