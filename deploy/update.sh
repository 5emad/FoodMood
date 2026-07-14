#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — update installed server (/opt/food)
#
#  This is the ONLY command you need after install:
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash
#
#  Does everything: latest code, npm, fonts, HTTPS/nginx, MongoDB
#  repair, service restart, health + login checks.
#
#  Reset superadmin password + token during update:
#    curl -fsSL .../deploy/update.sh | sudo bash -s -- --superadmin-pass 'Food@Super2026!'
#
#  Status / diagnosis only (no download):
#    sudo bash /opt/food/deploy/update.sh --status
#    sudo bash /opt/food/deploy/update.sh --diagnose
#    sudo bash /opt/food/deploy/update.sh --repair-db
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/5emad/FoodMood.git}"
INSTALL_DIR="/opt/food"
APP_USER="foodapp"
SERVICE_NAME="foodmood"
BRANCH="main"
TAG=""
LIST_TAGS=0
SHOW_STATUS=0
DIAGNOSE_ONLY=0
REPAIR_DB_ONLY=0
SUPERADMIN_USER="${SUPERADMIN_USER:-superadmin}"
SUPERADMIN_PASS="${SUPERADMIN_PASS:-}"

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
    --diagnose) DIAGNOSE_ONLY=1; shift ;;
    --repair-db) REPAIR_DB_ONLY=1; shift ;;
    --superadmin-user) SUPERADMIN_USER="$2"; shift 2 ;;
    --superadmin-pass) SUPERADMIN_PASS="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) log_err "Unknown option: $1"; exit 1 ;;
  esac
done

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_err "Run as root: curl -fsSL .../deploy/update.sh | sudo bash"
    exit 1
  fi
}

load_lib() {
  local lib="${1:-${INSTALL_DIR}/deploy/lib.sh}"
  if [[ ! -f "$lib" ]]; then
    log_err "Missing ${lib}"
    return 1
  fi
  # shellcheck source=/dev/null
  source "$lib"
}

list_remote_tags() {
  log_info "Released tags on ${REPO_URL}:"
  git ls-remote --tags "$REPO_URL" 2>/dev/null \
    | awk '{print $2}' \
    | sed 's|refs/tags/||' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -20
}

show_status() {
  local current server_ip
  load_lib || exit 1
  current="$(read_installed_version)"
  server_ip="$(detect_server_ip)"
  echo ""
  echo -e "${BOLD}Installed version:${NC}  v${current}"
  echo -e "${BOLD}Install path:${NC}       ${INSTALL_DIR}"
  echo -e "${BOLD}Service:${NC}            $(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'unknown')"
  echo -e "${BOLD}App URL:${NC}            https://${server_ip}/login"
  echo ""
  echo -e "${BOLD}Update command:${NC}"
  echo "  curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash"
  echo ""
  echo -e "${BOLD}Reset superadmin during update:${NC}"
  echo "  curl -fsSL .../deploy/update.sh | sudo bash -s -- --superadmin-pass 'YourPass@123!'"
  echo ""
  echo -e "${BOLD}Latest GitHub tags:${NC}"
  list_remote_tags
  echo ""
}

read_package_version() {
  local pkg="${1:-${INSTALL_DIR}/package.json}"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$pkg" 2>/dev/null || echo "?"
}

read_git_commit() {
  local dir="$1"
  git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo "?"
}

source_nginx_tls_lib() {
  local lib="${INSTALL_DIR}/deploy/nginx-tls.sh"
  if [[ ! -f "$lib" ]]; then
    log_err "Missing ${lib} — sync from GitHub first."
    return 1
  fi
  # shellcheck source=/dev/null
  source "$lib"
}

configure_tls_deployment() {
  local server_ip
  server_ip="$(detect_server_ip)"
  source_nginx_tls_lib || return 1
  log_info "Configuring HTTPS for https://${server_ip} ..."
  configure_https_only "$server_ip" "$INSTALL_DIR" "$APP_USER"

  if [[ ! -f /etc/sudoers.d/foodmood-ssl ]]; then
    cat > /etc/sudoers.d/foodmood-ssl <<EOF
${APP_USER} ALL=(root) NOPASSWD: ${INSTALL_DIR}/deploy/apply-custom-ssl.sh
EOF
    chmod 440 /etc/sudoers.d/foodmood-ssl
    visudo -cf /etc/sudoers.d/foodmood-ssl >/dev/null 2>&1 || rm -f /etc/sudoers.d/foodmood-ssl
  fi

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi 'Status: active'; then
    ufw allow 80/tcp comment 'HTTP redirect' >/dev/null 2>&1 || true
    ufw allow 443/tcp comment 'HTTPS / Nginx' >/dev/null 2>&1 || true
  fi

  log_ok "HTTPS configured on port 443"
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
    log_warn "Added missing ${key} to .env — save it in your password vault"
  }

  ensure_env_key ANNOUNCEMENT_ENCRYPTION_KEY
  ensure_env_key LDAP_ENCRYPTION_KEY

  if ! grep -q '^LOG_DIR=' "$env_file" 2>/dev/null; then
    echo 'LOG_DIR=/var/log/foodmood' >> "$env_file"
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
    log_warn "Added LOG_DIR=/var/log/foodmood to .env"
  fi

  if ! grep -q '^TRUST_TLS=' "$env_file" 2>/dev/null; then
    echo 'TRUST_TLS=true' >> "$env_file"
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
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

  chmod +x "${INSTALL_DIR}/deploy/"*.sh 2>/dev/null || true
}

fetch_source() {
  CLONE_DIR="$(mktemp -d /tmp/food-update-XXXXXX)"

  if [[ -n "$TAG" ]]; then
    log_info "Fetching ${TAG} from ${REPO_URL}..."
    git clone --depth 1 --branch "$TAG" "$REPO_URL" "$CLONE_DIR"
  else
    log_info "Fetching branch ${BRANCH} from ${REPO_URL}..."
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR"
  fi
}

apply_update() {
  local source_dir="$1"
  local old_version new_version source_commit server_ip login_probe site_checks

  old_version="$(read_installed_version)"
  new_version="$(read_package_version "${source_dir}/package.json")"
  source_commit="$(read_git_commit "$source_dir")"

  if [[ ! -d "$INSTALL_DIR" ]]; then
    log_err "Install path ${INSTALL_DIR} not found. Run install.sh first."
    exit 1
  fi

  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    log_err ".env missing in ${INSTALL_DIR} — unsafe to update."
    exit 1
  fi

  server_ip="$(detect_server_ip)"
  echo ""
  echo -e "${MAGENTA}${BOLD}  FoodMood Update${NC}"
  echo -e "  ${BOLD}From:${NC} v${old_version}  →  ${BOLD}To:${NC} v${new_version} (${TAG:-$BRANCH} @ ${source_commit})"
  echo ""

  log_info "Backing up .env..."
  cp -a "${INSTALL_DIR}/.env" "/tmp/food-env-backup-$(date +%s).env"

  log_info "Syncing application files (keeping .env)..."
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude .npm \
    --exclude .cache \
    --exclude INSTALL_INFO.txt \
    --exclude '*.log' \
    "$source_dir/" "$INSTALL_DIR/"

  chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
  chmod 600 "${INSTALL_DIR}/.env"

  # v1.5.14+: Puppeteer removed — clear stale install that blocks npm
  rm -rf "${INSTALL_DIR}/node_modules/puppeteer" 2>/dev/null || true
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    sed -i '/^PUPPETEER_/d' "${INSTALL_DIR}/.env" 2>/dev/null || true
  fi

  log_info "Installing npm dependencies..."
  if ! sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev"; then
    log_warn "npmjs.org unreachable — trying npmmirror.com..."
    sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev --registry=https://registry.npmmirror.com"
  fi

  log_info "Syncing vendor fonts and assets..."
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm run vendor:sync"
  chmod -R a+rX "${INSTALL_DIR}/public" 2>/dev/null || true

  migrate_systemd_service

  log_info "Ensuring MongoDB is running..."
  ensure_services_running
  if ! repair_mongodb_from_env; then
    log_err "MongoDB repair failed — superadmin and login will not work"
    run_diagnose "$server_ip"
    exit 1
  fi

  local mongo_query
  mongo_query="$(test_mongodb_app_query)"
  if [[ "$mongo_query" != OK:* ]]; then
    log_err "MongoDB query test failed: ${mongo_query#FAIL:}"
    run_diagnose "$server_ip"
    exit 1
  fi
  log_ok "MongoDB ready (${mongo_query#OK:})"

  log_info "Ensuring PDF browser and runtime cache..."
  ensure_chrome_for_pdf || true
  ensure_pdf_runtime_dirs
  configure_chrome_env

  configure_tls_deployment

  log_info "Restarting ${SERVICE_NAME}..."
  systemctl restart "$SERVICE_NAME"

  if ! wait_for_api_health 30; then
    log_warn "API not healthy yet — retrying MongoDB repair and restart..."
    repair_mongodb_from_env || true
    systemctl restart "$SERVICE_NAME"
    if ! wait_for_api_health 20; then
      log_err "Service failed health check. Log: journalctl -u ${SERVICE_NAME} -n 40"
      run_diagnose "$server_ip"
      exit 1
    fi
  fi
  log_ok "API health check passed"

  installed_after="$(read_installed_version)"
  if [[ "$installed_after" != "$new_version" ]]; then
    log_err "package.json on disk is still v${installed_after} (expected v${new_version})."
    exit 1
  fi
  log_ok "Installed version confirmed: v${installed_after}"

  log_info "Verifying site (fonts, HTTPS, login)..."
  site_checks="$(verify_fonts_and_site "$server_ip")"
  echo "  ${site_checks}"

  if source_nginx_tls_lib 2>/dev/null; then
    if verify_https_only_deployment "$server_ip"; then
      log_ok "HTTPS, port 443, CSS checks passed"
    else
      log_warn "HTTPS verification had issues — nginx will be restarted once more"
      systemctl restart nginx 2>/dev/null || true
    fi
  fi

  login_probe="$(test_login_api "$server_ip")"
  if [[ "${login_probe%%|*}" == "401" || "${login_probe%%|*}" == "400" ]]; then
    log_ok "Login API reachable (HTTP ${login_probe%%|*})"
  elif [[ "${login_probe%%|*}" == "503" ]] || echo "${login_probe#*|}" | grep -q 'در دسترس نمی'; then
    log_err "Login still blocked — MongoDB may be down"
    run_diagnose "$server_ip"
    exit 1
  else
    log_warn "Login probe: HTTP ${login_probe%%|*} — ${login_probe#*|}"
  fi

  if test_pdf_browser; then
    log_ok "PDF browser executable by ${APP_USER}"
  else
    log_warn "PDF browser check failed — report PDF may not work until Chrome/Chromium is installed"
  fi

  if [[ -n "$SUPERADMIN_PASS" ]]; then
    reset_superadmin_credentials "$SUPERADMIN_USER" "$SUPERADMIN_PASS" || exit 1
  fi

  log_ok "Update complete — FoodMood v${new_version} (${source_commit}) is running."
  echo ""
  echo -e "${GREEN}${BOLD}  Open in browser:${NC}"
  echo -e "  ${BOLD}https://${server_ip}/login${NC}"
  echo ""
  if [[ -z "$SUPERADMIN_PASS" ]]; then
    echo -e "${YELLOW}[!]${NC} Reset superadmin on next update:"
    echo -e "  curl -fsSL .../deploy/update.sh | sudo bash -s -- --superadmin-pass 'YourPass@123!'"
    echo ""
  fi
  echo -e "${YELLOW}[!]${NC} Self-signed: browser shows ${BOLD}Not Secure${NC} — accept once or upload certificate in Superadmin panel."
  echo ""

  {
    echo ""
    echo "─── Last update ───────────────────────────────────────────────"
    echo "  Version     : v${new_version}"
    echo "  Git commit  : ${source_commit}"
    echo "  Git ref     : ${TAG:-$BRANCH}"
    echo "  Date        : $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "  App URL     : https://${server_ip}"
  } >> "${INSTALL_DIR}/INSTALL_INFO.txt" 2>/dev/null || true
}

CLONE_DIR=""

main() {
  require_root
  export DEBIAN_FRONTEND=noninteractive
  command -v git >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq git rsync curl python3; }

  if [[ "$LIST_TAGS" -eq 1 ]]; then
    list_remote_tags
    exit 0
  fi

  if [[ "$SHOW_STATUS" -eq 1 ]]; then
    show_status
    exit 0
  fi

  if [[ "$DIAGNOSE_ONLY" -eq 1 ]]; then
    load_lib || exit 1
    run_diagnose "$(detect_server_ip)"
    exit 0
  fi

  if [[ "$REPAIR_DB_ONLY" -eq 1 ]]; then
    load_lib || exit 1
    local server_ip
    server_ip="$(detect_server_ip)"
    log_info "MongoDB repair only (no code sync)..."
    ensure_services_running
    if ! repair_mongodb_from_env; then
      run_diagnose "$server_ip"
      exit 1
    fi
    systemctl restart "$SERVICE_NAME"
    if ! wait_for_api_health 20; then
      run_diagnose "$server_ip"
      exit 1
    fi
    if [[ -n "$SUPERADMIN_PASS" ]]; then
      reset_superadmin_credentials "$SUPERADMIN_USER" "$SUPERADMIN_PASS" || exit 1
    fi
    log_ok "MongoDB repair complete — open https://${server_ip}/login and sign in again"
    exit 0
  fi

  if [[ -n "$TAG" && ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log_err "Invalid tag format. Example: v1.5.0"
    exit 1
  fi

  if [[ ! -d "$INSTALL_DIR" || ! -f "${INSTALL_DIR}/.env" ]]; then
    log_err "FoodMood not installed. Run install.sh first:"
    log_err "  curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/install.sh | sudo bash"
    exit 1
  fi

  fetch_source
  trap 'rm -rf "$CLONE_DIR"' EXIT
  load_lib "${CLONE_DIR}/deploy/lib.sh"
  apply_update "$CLONE_DIR"
}

main "$@"
