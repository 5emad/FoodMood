#!/usr/bin/env bash
# بررسی نهایی نصب FoodMood — مسیرها، سرویس‌ها، سلامت API
# اجرا:
#   sudo bash /opt/food/deploy/verify-install.sh
#   sudo bash deploy/verify-install.sh --from-install
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
SERVICE_NAME="foodmood"
FROM_INSTALL=0
QUIET=0

for arg in "$@"; do
  case "$arg" in
    --from-install) FROM_INSTALL=1 ;;
    --quiet|-q) QUIET=1 ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

log_pass() { PASS=$((PASS + 1)); echo -e "${GREEN}[✓]${NC} $*"; }
log_fail() { FAIL=$((FAIL + 1)); echo -e "${RED}[✗]${NC} $*"; }
log_warn() { WARN=$((WARN + 1)); echo -e "${YELLOW}[!]${NC} $*"; }
log_info() { [[ "$QUIET" -eq 1 ]] || echo -e "${CYAN}[*]${NC} $*"; }

check_dir() {
  local path="$1" owner="$2" mode="$3" label="$4"
  if [[ ! -d "$path" ]]; then
    log_fail "${label}: پوشه ${path} وجود ندارد"
    return
  fi
  local perm owner_actual
  perm="$(stat -c '%a' "$path" 2>/dev/null || stat -f '%OLp' "$path" 2>/dev/null || echo '?')"
  owner_actual="$(stat -c '%U:%G' "$path" 2>/dev/null || stat -f '%Su:%Sg' "$path" 2>/dev/null || echo '?')"
  log_pass "${label}: ${path} (${owner_actual}, ${perm})"
  if [[ "$owner_actual" != "$owner" ]]; then
    log_warn "${label}: مالک پیشنهادی ${owner} است، فعلی ${owner_actual}"
  fi
}

check_file_mode() {
  local path="$1" expect_mode="$2" expect_owner="$3" label="$4"
  if [[ ! -f "$path" ]]; then
    log_fail "${label}: فایل ${path} وجود ندارد"
    return
  fi
  local perm owner_actual
  perm="$(stat -c '%a' "$path" 2>/dev/null || echo '?')"
  owner_actual="$(stat -c '%U:%G' "$path" 2>/dev/null || echo '?')"
  if [[ "$perm" == "$expect_mode" ]]; then
    log_pass "${label}: ${path} (دسترسی ${perm})"
  else
    log_warn "${label}: دسترسی ${perm} — پیشنهاد ${expect_mode}"
  fi
  if [[ -n "$expect_owner" && "$owner_actual" != "$expect_owner" ]]; then
    log_warn "${label}: مالک ${owner_actual} — پیشنهاد ${expect_owner}"
  fi
}

env_has_key() {
  local key="$1"
  grep -q "^${key}=" "${INSTALL_DIR}/.env" 2>/dev/null
}

env_key_ok() {
  local key="$1"
  local val
  val="$(grep "^${key}=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- || true)"
  if [[ -z "$val" ]]; then
    log_fail ".env: ${key} خالی است"
    return 1
  fi
  if [[ "$val" == *replace-with* ]]; then
    log_fail ".env: ${key} هنوز placeholder است"
    return 1
  fi
  log_pass ".env: ${key} تنظیم شده"
  return 0
}

http_health() {
  local url="http://127.0.0.1:3000/api/system/health"
  local body=""
  if command -v curl >/dev/null 2>&1; then
    body="$(curl -sf --max-time 10 "$url" 2>/dev/null || true)"
  elif command -v wget >/dev/null 2>&1; then
    body="$(wget -qO- --timeout=10 "$url" 2>/dev/null || true)"
  else
    log_warn "curl/wget نیست — بررسی health API رد شد"
    return
  fi
  if [[ -z "$body" ]]; then
    log_fail "API health: پاسخی از ${url} دریافت نشد"
    return
  fi
  if echo "$body" | grep -q '"healthy":true\|"healthy": true'; then
    log_pass "API health: سرویس سالم است"
  elif echo "$body" | grep -q '"healthy":false\|"healthy": false'; then
    log_fail "API health: سرویس unhealthy — ${body}"
  else
    log_warn "API health: پاسخ غیرمنتظره — ${body:0:120}"
  fi
}

check_service() {
  local name="$1"
  if systemctl is-active --quiet "$name" 2>/dev/null; then
    log_pass "systemd: ${name} فعال است"
  else
    log_fail "systemd: ${name} فعال نیست"
  fi
}

check_node_version() {
  local ver major
  ver="$(node -v 2>/dev/null | tr -d 'v' || echo '0')"
  major="${ver%%.*}"
  if [[ "$major" -ge 20 ]]; then
    log_pass "Node.js: v${ver}"
  else
    log_fail "Node.js: v${ver} — حداقل 20 لازم است"
  fi
}

main() {
  echo ""
  echo -e "${BOLD}FoodMood — بررسی نهایی نصب${NC}"
  echo -e "${CYAN}مسیر: ${INSTALL_DIR}${NC}"
  echo ""

  # ── مسیرهای استاندارد FHS ─────────────────────────────────────
  log_info "بررسی مسیرها..."
  if [[ -d "$INSTALL_DIR" ]]; then
    log_pass "نصب برنامه: ${INSTALL_DIR} (/opt — FHS)"
  else
    log_fail "مسیر نصب ${INSTALL_DIR} پیدا نشد"
  fi

  check_dir "/var/log/foodmood" "${APP_USER}:${APP_USER}" "750" "لاگ سیستمی (/var/log)"
  check_dir "${INSTALL_DIR}/certs" "${APP_USER}:${APP_USER}" "750" "گواهی LDAP"
  check_dir "${INSTALL_DIR}/docs" "${APP_USER}:${APP_USER}" "755" "مستندات"

  if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    log_pass "واحد systemd: /etc/systemd/system/${SERVICE_NAME}.service"
  else
    log_fail "واحد systemd پیدا نشد"
  fi

  # ── کاربر و مجوزها ────────────────────────────────────────────
  log_info "بررسی کاربر و .env..."
  if id "$APP_USER" >/dev/null 2>&1; then
    log_pass "کاربر سرویس: ${APP_USER}"
  else
    log_fail "کاربر ${APP_USER} وجود ندارد"
  fi

  check_file_mode "${INSTALL_DIR}/.env" "600" "${APP_USER}:${APP_USER}" "تنظیمات"
  check_file_mode "${INSTALL_DIR}/INSTALL_INFO.txt" "644" "root:root" "راهنمای نصب"

  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    for key in SESSION_SECRET JWT_SECRET BACKUP_SECRET PASSWORD_PEPPER \
               ANNOUNCEMENT_ENCRYPTION_KEY LDAP_ENCRYPTION_KEY LOG_DIR MONGODB_URI; do
      if env_has_key "$key"; then
        if [[ "$key" == "LOG_DIR" ]]; then
          local logdir
          logdir="$(grep '^LOG_DIR=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"
          if [[ "$logdir" == "/var/log/foodmood" ]]; then
            log_pass ".env: LOG_DIR=/var/log/foodmood"
          else
            log_warn ".env: LOG_DIR=${logdir} — پیشنهاد /var/log/foodmood"
          fi
        else
          env_key_ok "$key" || true
        fi
      else
        log_fail ".env: ${key} وجود ندارد"
      fi
    done
  fi

  # ── سرویس‌ها ──────────────────────────────────────────────────
  log_info "بررسی سرویس‌ها..."
  check_service "$SERVICE_NAME"
  check_service mongod

  # ── Node و API ─────────────────────────────────────────────────
  log_info "بررسی runtime..."
  check_node_version
  http_health

  # ── نسخه ───────────────────────────────────────────────────────
  if [[ -f "${INSTALL_DIR}/package.json" ]]; then
    local ver
    ver="$(python3 -c 'import json; print(json.load(open("'"${INSTALL_DIR}/package.json"'", encoding="utf-8"))["version"])' 2>/dev/null || echo '?')"
    log_pass "نسخه نصب‌شده: v${ver}"
  fi

  # ── نتیجه ──────────────────────────────────────────────────────
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${GREEN}موفق:${NC} ${PASS}   ${RED}ناموفق:${NC} ${FAIL}   ${YELLOW}هشدار:${NC} ${WARN}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [[ "$FAIL" -eq 0 ]]; then
    echo ""
    echo -e "${GREEN}${BOLD}  ✓ ACCEPT — نصب از نظر فنی پذیرفته شد${NC}"
    echo -e "  چک‌لیست Go-Live: ${INSTALL_DIR}/docs/LINUX-DEPLOYMENT.md"
    echo ""
    exit 0
  fi

  echo ""
  echo -e "${RED}${BOLD}  ✗ REJECT — ${FAIL} مورد باید قبل از Go-Live رفع شود${NC}"
  echo -e "  لاگ سرویس: sudo journalctl -u ${SERVICE_NAME} -n 40 --no-pager"
  echo ""
  exit 1
}

main "$@"
