#!/usr/bin/env bash
# FoodMood post-install verification — paths, services, API health
# Run:
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
    log_fail "${label}: directory ${path} does not exist"
    return
  fi
  local perm owner_actual
  perm="$(stat -c '%a' "$path" 2>/dev/null || stat -f '%OLp' "$path" 2>/dev/null || echo '?')"
  owner_actual="$(stat -c '%U:%G' "$path" 2>/dev/null || stat -f '%Su:%Sg' "$path" 2>/dev/null || echo '?')"
  log_pass "${label}: ${path} (${owner_actual}, ${perm})"
  if [[ "$owner_actual" != "$owner" ]]; then
    log_warn "${label}: recommended owner ${owner}, actual ${owner_actual}"
  fi
}

check_file_mode() {
  local path="$1" expect_mode="$2" expect_owner="$3" label="$4"
  if [[ ! -f "$path" ]]; then
    log_fail "${label}: file ${path} does not exist"
    return
  fi
  local perm owner_actual
  perm="$(stat -c '%a' "$path" 2>/dev/null || echo '?')"
  owner_actual="$(stat -c '%U:%G' "$path" 2>/dev/null || echo '?')"
  if [[ "$perm" == "$expect_mode" ]]; then
    log_pass "${label}: ${path} (mode ${perm})"
  else
    log_warn "${label}: mode ${perm} — recommended ${expect_mode}"
  fi
  if [[ -n "$expect_owner" && "$owner_actual" != "$expect_owner" ]]; then
    log_warn "${label}: owner ${owner_actual} — recommended ${expect_owner}"
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
    log_fail ".env: ${key} is empty"
    return 1
  fi
  if [[ "$val" == *replace-with* ]]; then
    log_fail ".env: ${key} is still a placeholder"
    return 1
  fi
  log_pass ".env: ${key} is set"
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
    log_warn "curl/wget not found — API health check skipped"
    return
  fi
  if [[ -z "$body" ]]; then
    log_fail "API health: no response from ${url}"
    return
  fi
  if echo "$body" | grep -q '"healthy":true\|"healthy": true'; then
    log_pass "API health: service is healthy"
  elif echo "$body" | grep -q '"healthy":false\|"healthy": false'; then
    log_fail "API health: service unhealthy — ${body}"
  else
    log_warn "API health: unexpected response — ${body:0:120}"
  fi
}

check_service() {
  local name="$1"
  if systemctl is-active --quiet "$name" 2>/dev/null; then
    log_pass "systemd: ${name} is active"
  else
    log_fail "systemd: ${name} is not active"
  fi
}

check_node_version() {
  local ver major
  ver="$(node -v 2>/dev/null | tr -d 'v' || echo '0')"
  major="${ver%%.*}"
  if [[ "$major" -ge 20 ]]; then
    log_pass "Node.js: v${ver}"
  else
    log_fail "Node.js: v${ver} — minimum 20 required"
  fi
}

main() {
  echo ""
  echo -e "${BOLD}FoodMood — post-install verification${NC}"
  echo -e "${CYAN}Path: ${INSTALL_DIR}${NC}"
  echo ""

  log_info "Checking paths..."
  if [[ -d "$INSTALL_DIR" ]]; then
    log_pass "Application: ${INSTALL_DIR} (/opt — FHS)"
  else
    log_fail "Install path ${INSTALL_DIR} not found"
  fi

  check_dir "/var/log/foodmood" "${APP_USER}:${APP_USER}" "750" "System logs (/var/log)"
  check_dir "${INSTALL_DIR}/certs" "${APP_USER}:${APP_USER}" "750" "LDAP certificates"
  check_dir "${INSTALL_DIR}/docs" "${APP_USER}:${APP_USER}" "755" "Documentation"

  if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    log_pass "systemd unit: /etc/systemd/system/${SERVICE_NAME}.service"
  else
    log_fail "systemd unit not found"
  fi

  log_info "Checking user and .env..."
  if id "$APP_USER" >/dev/null 2>&1; then
    log_pass "Service user: ${APP_USER}"
  else
    log_fail "User ${APP_USER} does not exist"
  fi

  check_file_mode "${INSTALL_DIR}/.env" "600" "${APP_USER}:${APP_USER}" "Runtime config"
  check_file_mode "${INSTALL_DIR}/INSTALL_INFO.txt" "644" "root:root" "Install guide"

  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    for key in SESSION_SECRET JWT_SECRET BACKUP_SECRET PASSWORD_PEPPER \
               ANNOUNCEMENT_ENCRYPTION_KEY LDAP_ENCRYPTION_KEY LOG_ENCRYPTION_KEY \
               LOG_DIR MONGODB_URI; do
      if env_has_key "$key"; then
        if [[ "$key" == "LOG_DIR" ]]; then
          local logdir
          logdir="$(grep '^LOG_DIR=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"
          if [[ "$logdir" == "/var/log/foodmood" ]]; then
            log_pass ".env: LOG_DIR=/var/log/foodmood"
          else
            log_warn ".env: LOG_DIR=${logdir} — recommended /var/log/foodmood"
          fi
        else
          env_key_ok "$key" || true
        fi
      else
        log_fail ".env: ${key} is missing"
      fi
    done
  fi

  log_info "Checking services..."
  check_service "$SERVICE_NAME"
  check_service mongod

  log_info "Checking runtime..."
  check_node_version
  http_health

  if [[ -f "${INSTALL_DIR}/package.json" ]]; then
    local ver
    ver="$(python3 -c 'import json; print(json.load(open("'"${INSTALL_DIR}/package.json"'", encoding="utf-8"))["version"])' 2>/dev/null || echo '?')"
    log_pass "Installed version: v${ver}"
  fi

  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${GREEN}Pass:${NC} ${PASS}   ${RED}Fail:${NC} ${FAIL}   ${YELLOW}Warn:${NC} ${WARN}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [[ "$FAIL" -eq 0 ]]; then
    echo ""
    echo -e "${GREEN}${BOLD}  ✓ ACCEPT — install passed technical verification${NC}"
    echo -e "  Go-live checklist: ${INSTALL_DIR}/docs/LINUX-DEPLOYMENT.md"
    echo ""
    exit 0
  fi

  echo ""
  echo -e "${RED}${BOLD}  ✗ REJECT — ${FAIL} issue(s) must be fixed before go-live${NC}"
  echo -e "  Service log: sudo journalctl -u ${SERVICE_NAME} -n 40 --no-pager"
  echo ""
  exit 1
}

main "$@"
