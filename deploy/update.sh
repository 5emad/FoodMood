#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — update installed server (/opt/food)
#
#  One-line update (latest main + HTTPS/CSS fix):
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash
#
#  From local clone:
#    sudo bash /opt/food/deploy/update.sh
#
#  Specific version:
#    curl -fsSL .../deploy/update.sh | sudo bash -s -- --tag v1.3.8
#
#  Status only:
#    sudo bash /opt/food/deploy/update.sh --status
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
      sed -n '2,16p' "$0"
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

detect_server_ip() {
  local ip=""
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    local app_url
    app_url="$(grep '^APP_URL=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
    app_url="${app_url#http://}"
    app_url="${app_url#https://}"
    ip="${app_url%%/*}"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
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
  current="$(read_installed_version)"
  server_ip="$(detect_server_ip)"
  echo ""
  echo -e "${BOLD}Installed version:${NC}  v${current}"
  echo -e "${BOLD}Install path:${NC}       ${INSTALL_DIR}"
  echo -e "${BOLD}Service:${NC}            $(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'unknown')"
  echo -e "${BOLD}App URL:${NC}            https://${server_ip}/login"
  echo ""
  echo -e "${BOLD}Latest GitHub tags:${NC}"
  list_remote_tags
  echo ""
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
  log_info "Configuring HTTPS-only for https://${server_ip} ..."
  configure_https_only "$server_ip" "$INSTALL_DIR" "$APP_USER"

  if [[ ! -f /etc/sudoers.d/foodmood-ssl ]]; then
    cat > /etc/sudoers.d/foodmood-ssl <<EOF
${APP_USER} ALL=(root) NOPASSWD: ${INSTALL_DIR}/deploy/apply-custom-ssl.sh
EOF
    chmod 440 /etc/sudoers.d/foodmood-ssl
    visudo -cf /etc/sudoers.d/foodmood-ssl >/dev/null 2>&1 || rm -f /etc/sudoers.d/foodmood-ssl
  fi

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi 'Status: active'; then
    ufw allow 443/tcp comment 'HTTPS / Nginx' >/dev/null 2>&1 || true
  fi

  log_ok "HTTPS enabled on port 443 — all URLs use https://${server_ip}"
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

apply_update() {
  local source_dir="$1"
  local old_version new_version source_commit installed_after server_ip
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

  if [[ "$old_version" == "$new_version" ]]; then
    log_warn "Same semver — files and fixes still sync from GitHub commit ${source_commit}."
  fi

  log_info "Backing up .env..."
  cp -a "${INSTALL_DIR}/.env" "/tmp/food-env-backup-$(date +%s).env"

  log_info "Syncing application files (keeping .env)..."
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude INSTALL_INFO.txt \
    --exclude '*.log' \
    "$source_dir/" "$INSTALL_DIR/"

  chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
  chmod 600 "${INSTALL_DIR}/.env"

  log_info "Installing npm dependencies..."
  if ! sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev"; then
    log_warn "npmjs.org unreachable — trying npmmirror.com..."
    sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev --registry=https://registry.npmmirror.com"
  fi
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm run vendor:sync"

  migrate_systemd_service

  configure_tls_deployment

  log_info "Restarting ${SERVICE_NAME}..."
  systemctl restart "$SERVICE_NAME"

  local wait_i node_ok=0
  for wait_i in $(seq 1 30); do
    if curl -sf --max-time 5 http://127.0.0.1:3000/api/system/health >/dev/null 2>&1; then
      node_ok=1
      break
    fi
    sleep 2
  done

  if [[ "$node_ok" -ne 1 ]] || ! systemctl is-active --quiet "$SERVICE_NAME"; then
    log_err "Service failed to start. Log: journalctl -u ${SERVICE_NAME} -n 40"
    exit 1
  fi

  chmod -R a+rX "${INSTALL_DIR}/public" 2>/dev/null || true

  installed_after="$(read_installed_version)"
  if [[ "$installed_after" != "$new_version" ]]; then
    log_err "package.json on disk is still v${installed_after} (expected v${new_version})."
    exit 1
  fi
  log_ok "Installed version confirmed: v${installed_after}"

  log_info "Verifying HTTPS deployment..."
  if verify_https_only_deployment "$server_ip"; then
    log_ok "HTTPS, port 443, CSS and redirect checks passed"
  else
    log_warn "HTTPS verification had issues — check: sudo nginx -t && sudo ss -tlnp | grep 443"
  fi

  log_ok "Update complete — FoodMood v${new_version} (${source_commit}) is running."
  echo ""
  echo -e "${GREEN}${BOLD}  Open in browser:${NC}"
  echo -e "  ${BOLD}https://${server_ip}/login${NC}"
  echo ""
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
  command -v git >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq git rsync curl; }

  if [[ "$LIST_TAGS" -eq 1 ]]; then
    list_remote_tags
    exit 0
  fi

  if [[ "$SHOW_STATUS" -eq 1 ]]; then
    show_status
    exit 0
  fi

  if [[ -n "$TAG" && ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log_err "Invalid tag format. Example: v1.5.0"
    exit 1
  fi

  fetch_source
  trap 'rm -rf "$CLONE_DIR"' EXIT
  apply_update "$CLONE_DIR"
}

main "$@"
