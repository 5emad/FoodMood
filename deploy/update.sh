#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — Update
#
#  One-liner (after install):
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash
#
#  If Docker leftovers exist, data is moved to host mongod and
#  containers are removed, then a bare-metal update continues.
#
#  Reset superadmin:
#    sudo bash .../update.sh --superadmin-pass 'Food@Super2026!'
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

# ── colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── logging ───────────────────────────────────────────────────
log_info()  { echo -e "  ${CYAN}●${NC}  $*"; }
log_ok()    { echo -e "  ${GREEN}✔${NC}  $*"; }
log_warn()  { echo -e "  ${YELLOW}▲${NC}  $*"; }
log_err()   { echo -e "  ${RED}✖${NC}  $*" >&2; }
log_dim()   { echo -e "  ${DIM}$*${NC}"; }

ui_rule() {
  echo -e "${DIM}  ────────────────────────────────────────────────────────────${NC}"
}

ui_blank() { echo ""; }

ui_banner() {
  local title="$1"
  ui_blank
  echo -e "${BLUE}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════╗"
  printf "  ║  %-54s ║\n" "$title"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

ui_kv() {
  printf "  ${DIM}%-12s${NC} %s\n" "$1" "$2"
}

# Progressive steps: ui_step N TOTAL "Title" then work, then log_ok...
UPDATE_STEP=0
UPDATE_STEPS_TOTAL=10

ui_step() {
  UPDATE_STEP=$((UPDATE_STEP + 1))
  local title="$1"
  ui_blank
  echo -e "  ${BOLD}${CYAN}${UPDATE_STEP}${DIM}/${UPDATE_STEPS_TOTAL}${NC}  ${BOLD}${title}${NC}"
  ui_rule
}

ui_success_card() {
  local version="$1"
  local commit="$2"
  local url="$3"
  ui_blank
  echo -e "${GREEN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║                   Update complete                        ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  ui_kv "Version"  "v${version}"
  ui_kv "Commit"   "${commit}"
  ui_kv "URL"      "${url}"
  ui_blank
  echo -e "  ${GREEN}${BOLD}→${NC}  Open ${BOLD}${url}${NC}"
  ui_blank
}

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
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *) log_err "Unknown option: $1"; exit 1 ;;
  esac
done

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_err "Run as root:"
    log_dim "curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash"
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
  log_info "Released tags on ${REPO_URL}"
  git ls-remote --tags "$REPO_URL" 2>/dev/null \
    | awk '{print $2}' \
    | sed 's|refs/tags/||' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -20 \
    | while read -r t; do echo -e "     ${DIM}${t}${NC}"; done
}

show_status() {
  local current server_ip
  load_lib || exit 1
  current="$(read_installed_version)"
  server_ip="$(detect_server_ip)"
  ui_banner "FoodMood  ·  Status"
  ui_kv "Version"  "v${current}"
  ui_kv "Mode"     "bare-metal (systemd)"
  ui_kv "Server"   "${server_ip}"
  ui_kv "Path"     "${INSTALL_DIR}"
  ui_kv "Service"  "$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'unknown')"
  ui_kv "URL"      "https://${server_ip}/login"
  ui_blank
  ui_rule
  log_dim "Update with:"
  echo "    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash"
  ui_blank
  echo -e "  ${BOLD}Latest tags${NC}"
  list_remote_tags
  ui_blank
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
  sync_runtime_url_from_settings || true

  log_info "Repairing HTTPS / Nginx (SSL, theme colors, proxy)…"
  repair_tls_deployment "$server_ip" "$INSTALL_DIR" "$APP_USER"

  cat > /etc/sudoers.d/foodmood-ssl <<EOF
${APP_USER} ALL=(root) NOPASSWD: ${INSTALL_DIR}/deploy/apply-custom-ssl.sh
EOF
  chmod 440 /etc/sudoers.d/foodmood-ssl
  if ! visudo -cf /etc/sudoers.d/foodmood-ssl >/dev/null 2>&1; then
    rm -f /etc/sudoers.d/foodmood-ssl
    log_warn "Could not install SSL sudoers rule — panel upload may fail"
  else
    log_ok "SSL panel sudo access configured"
  fi

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi 'Status: active'; then
    ufw allow 80/tcp comment 'HTTP redirect' >/dev/null 2>&1 || true
    ufw allow 443/tcp comment 'HTTPS / Nginx' >/dev/null 2>&1 || true
  fi

  if verify_https_only_deployment "$server_ip"; then
    log_ok "HTTPS ready (443, CSS, theme-vars)"
  else
    log_warn "HTTPS verification had issues — retrying Nginx once"
    systemctl restart nginx 2>/dev/null || true
    verify_https_only_deployment "$server_ip" && log_ok "HTTPS recovered after retry" \
      || log_warn "HTTPS checks still failing — see journalctl -u nginx"
  fi
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
    log_warn "Added missing ${key} to .env — store it in your password vault"
  }

  ensure_env_default() {
    local key="$1"
    local val="$2"
    if grep -q "^${key}=" "$env_file" 2>/dev/null; then
      return 0
    fi
    echo "${key}=${val}" >> "$env_file"
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
    log_info "Added ${key}=${val}"
  }

  # Always force loopback (legacy Docker CIDRs break WAF behind local nginx).
  ensure_env_force() {
    local key="$1"
    local val="$2"
    if grep -q "^${key}=" "$env_file" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$env_file"
    else
      echo "${key}=${val}" >> "$env_file"
    fi
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
  }

  ensure_env_key ANNOUNCEMENT_ENCRYPTION_KEY
  ensure_env_key LDAP_ENCRYPTION_KEY
  ensure_env_key LOG_ENCRYPTION_KEY

  if ! grep -q '^LOG_DIR=' "$env_file" 2>/dev/null; then
    echo 'LOG_DIR=/var/log/foodmood' >> "$env_file"
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
    log_warn "Added LOG_DIR=/var/log/foodmood"
  fi

  if ! grep -q '^TRUST_TLS=' "$env_file" 2>/dev/null; then
    echo 'TRUST_TLS=true' >> "$env_file"
    chown "$APP_USER:$APP_USER" "$env_file"
    chmod 600 "$env_file"
  fi

  ensure_env_default TZ Asia/Tehran
  ensure_env_default API_RATE_LIMIT_MAX 800
  ensure_env_default WAF_RATE_LIMIT_MAX 2000
  ensure_env_default WAF_BURST_MAX 120
  ensure_env_default WAF_FP_MAX 500
  ensure_env_default CLUSTER_WORKERS 0
  ensure_env_default MONGODB_MAX_POOL_SIZE 50
  ensure_env_default MONGODB_MIN_POOL_SIZE 5
  ensure_env_force TRUSTED_PROXIES '127.0.0.1,::1'
  ensure_env_force WAF_TRUSTED_PROXIES '127.0.0.1,::1'
  # Default off; superadmin toggle in DB wins at runtime (do not force every update)
  ensure_env_default WAF_ENABLED 'false'
  ensure_env_default WAF_TARPIT 'false'
  # Point Mongo URI at host loopback if a Docker hostname remained
  if declare -F normalize_mongodb_uri_to_localhost >/dev/null 2>&1; then
    normalize_mongodb_uri_to_localhost
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
  log_info "Fetching source from ${REPO_URL}…"
  if [[ -n "$TAG" ]]; then
    log_dim "tag ${TAG}"
    git clone --depth 1 --branch "$TAG" "$REPO_URL" "$CLONE_DIR" >/dev/null
  else
    log_dim "branch ${BRANCH}"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR" >/dev/null
  fi
  log_ok "Source ready"
}

# Migrate leftover Docker installs back to host mongod + systemd.
exit_docker_to_bare_metal_if_needed() {
  local marker="${INSTALL_DIR}/.docker-deployed"
  local envf="${INSTALL_DIR}/.env.docker"
  if [[ ! -f "$marker" && ! -f "$envf" ]]; then
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    rm -f "$marker" "$envf"
    return 0
  fi
  if ! docker info >/dev/null 2>&1; then
    log_warn "Docker is not running — clearing deploy markers only"
    rm -f "$marker" "$envf"
    return 0
  fi

  ui_blank
  echo -e "  ${BOLD}${CYAN}·${NC}  ${BOLD}Legacy Docker detected${NC}"
  ui_rule
  log_info "Moving data to host mongod and removing containers…"
  local compose_file="${INSTALL_DIR}/docker-compose.yml"
  local dump_file="${INSTALL_DIR}/backups/docker-exit-$(date +%Y%m%d-%H%M%S).archive"
  local db_name="${DB_NAME:-food_ordering}"
  mkdir -p "${INSTALL_DIR}/backups"

  if [[ -f "$compose_file" ]]; then
    if [[ -f "$envf" ]] && docker compose -f "$compose_file" --env-file "$envf" ps -q mongo 2>/dev/null | grep -q .; then
      log_info "Dumping MongoDB (${db_name}) from container…"
      if docker compose -f "$compose_file" --env-file "$envf" exec -T mongo \
          mongodump --archive --gzip --db "$db_name" >"$dump_file" 2>/dev/null \
        && [[ -s "$dump_file" ]]; then
        systemctl start mongod 2>/dev/null || true
        sleep 2
        if command -v mongorestore >/dev/null 2>&1; then
          mongorestore --archive="$dump_file" --gzip --drop --db="$db_name" >/dev/null 2>&1 \
            && log_ok "Data restored to host mongod (${db_name})" \
            || log_warn "mongorestore failed — dump kept at ${dump_file}"
        else
          log_warn "mongorestore not installed — dump kept at ${dump_file}"
        fi
      else
        log_warn "Docker Mongo dump failed"
        rm -f "$dump_file"
      fi
    fi
    log_info "Stopping containers…"
    if [[ -f "$envf" ]]; then
      docker compose -f "$compose_file" --env-file "$envf" down --remove-orphans 2>/dev/null || true
    else
      docker compose -f "$compose_file" down --remove-orphans 2>/dev/null || true
    fi
  fi

  systemctl enable mongod 2>/dev/null || true
  systemctl start mongod 2>/dev/null || true
  if [[ -f /etc/nginx/sites-available/food ]]; then
    sed -i 's|proxy_pass http://127.0.0.1:8080|proxy_pass http://127.0.0.1:3000|g' /etc/nginx/sites-available/food || true
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fi
  rm -f "$marker" "$envf"
  log_ok "Docker exit complete — continuing bare-metal update"
  ui_blank
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
    log_err ".env missing in ${INSTALL_DIR} — refusing to update."
    exit 1
  fi

  server_ip="$(detect_server_ip)"

  UPDATE_STEP=0
  UPDATE_STEPS_TOTAL=11

  ui_banner "FoodMood  ·  Update"
  ui_kv "From"    "v${old_version}"
  ui_kv "To"      "v${new_version}  ·  ${TAG:-$BRANCH} @ ${source_commit}"
  ui_kv "Target"  "${INSTALL_DIR}"
  ui_kv "Mode"    "bare-metal (systemd + host MongoDB + Nginx)"
  ui_blank

  ui_step "Backup configuration"
  cp -a "${INSTALL_DIR}/.env" "/tmp/food-env-backup-$(date +%s).env"
  log_ok ".env backed up"

  ui_step "Sync application files"
  log_info "Preserving .env, uploads, and certificates…"
  mkdir -p "${INSTALL_DIR}/backend/public/uploads/foods" \
           "${INSTALL_DIR}/certs/ssl"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude .env.docker \
    --exclude .npm \
    --exclude .cache \
    --exclude INSTALL_INFO.txt \
    --exclude '*.log' \
    --exclude 'backend/logs/' \
    --exclude 'backend/public/uploads/' \
    --exclude 'certs/ssl/' \
    "$source_dir/" "$INSTALL_DIR/"

  chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
  chmod 600 "${INSTALL_DIR}/.env"

  rm -rf "${INSTALL_DIR}/node_modules/puppeteer" 2>/dev/null || true
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    sed -i '/^PUPPETEER_/d' "${INSTALL_DIR}/.env" 2>/dev/null || true
  fi
  log_ok "Files synced"

  ui_step "Install dependencies"
  log_info "npm install --omit=dev…"
  if ! sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev"; then
    log_warn "npmjs.org unreachable — trying npmmirror.com…"
    sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev --registry=https://registry.npmmirror.com"
  fi
  log_ok "Dependencies installed"

  ui_step "Build assets"
  log_info "Vendor fonts & SPA bundles…"
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm run vendor:sync"
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm run build" \
    || log_warn "Build failed — non-minified JS / SPA may be stale"
  chmod -R a+rX "${INSTALL_DIR}/backend/public" 2>/dev/null || true
  log_ok "Assets ready"

  ui_step "Migrate service & environment"
  migrate_systemd_service
  log_ok "systemd unit and .env keys updated"

  ui_step "MongoDB"
  log_info "Ensuring mongod is healthy…"
  ensure_services_running
  repair_mongodb_from_env || log_warn "MongoDB repair pass 1 had issues — continuing"
  log_ok "MongoDB check finished"

  ui_step "Recover application data"
  auto_recover_app_data || log_warn "Auto data recovery had issues — continuing"
  ensure_superadmin_exists || log_warn "Superadmin ensure skipped"
  log_ok "Data recovery pass finished"

  ui_step "PDF runtime"
  log_info "Chrome / Chromium for report PDFs…"
  ensure_chrome_for_pdf || true
  ensure_pdf_runtime_dirs
  configure_chrome_env
  log_ok "PDF runtime prepared"

  ui_step "HTTPS / Nginx"
  configure_tls_deployment

  ui_step "Restart & health checks"
  log_info "Restarting ${SERVICE_NAME}…"
  systemctl restart "$SERVICE_NAME"
  sleep 2

  if ! repair_mongodb_from_env; then
    log_err "MongoDB repair failed after restart — login will not work"
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

  if ! wait_for_api_health 30; then
    log_warn "API not healthy yet — retrying repair and restart…"
    repair_mongodb_from_env || true
    systemctl restart "$SERVICE_NAME"
    if ! wait_for_api_health 20; then
      log_err "Health check failed. Logs: journalctl -u ${SERVICE_NAME} -n 40"
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

  # Persist + show DB version + data counts (helps empty-DB diagnosis)
  if [[ -x "${INSTALL_DIR}/deploy/restore-data.sh" ]]; then
    uri_dbg="$(grep '^MONGODB_URI=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
    if [[ -n "$uri_dbg" ]]; then
      db_ver="$(mongosh --quiet "$uri_dbg" --eval 'const s=db.appsettings.findOne({key:"default"})||{}; print(s.appVersion||"(syncing…)")' 2>/dev/null || echo '?')"
      u_count="$(mongosh --quiet "$uri_dbg" --eval 'print(db.users.estimatedDocumentCount())' 2>/dev/null || echo '?')"
      o_count="$(mongosh --quiet "$uri_dbg" --eval 'print(db.orders.estimatedDocumentCount())' 2>/dev/null || echo '?')"
      ui_kv "DB version" "${db_ver}"
      ui_kv "Users / Orders" "${u_count} / ${o_count}"
      if [[ "$u_count" == "0" || "$u_count" == "?" ]]; then
        log_warn "Database looks empty — run: sudo bash ${INSTALL_DIR}/deploy/restore-data.sh --scan"
      fi
    fi
  fi

  ui_step "Verify site"
  log_info "Fonts, HTTPS, login probe…"
  site_checks="$(verify_fonts_and_site "$server_ip")"
  log_dim "${site_checks}"

  if source_nginx_tls_lib 2>/dev/null; then
    if verify_https_only_deployment "$server_ip"; then
      log_ok "HTTPS / port 443 / CSS checks passed"
    else
      log_warn "HTTPS verification had issues — restarting nginx once"
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
    log_warn "PDF browser check failed — install Chrome/Chromium if reports need PDF"
  fi

  ensure_superadmin_exists || true

  log_warn "If login/settings still blocked: sudo bash ${INSTALL_DIR}/deploy/emergency-unlock.sh"

  ui_success_card "$new_version" "$source_commit" "https://${server_ip}/login"

  if [[ -n "${AUTO_SUPERADMIN_PASS:-}" ]]; then
    echo -e "  ${YELLOW}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "  ${YELLOW}${BOLD}║  SAVE THESE SUPERADMIN CREDENTIALS (shown once)          ║${NC}"
    echo -e "  ${YELLOW}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    ui_kv "Username" "${SUPERADMIN_USER:-superadmin}"
    ui_kv "Password" "${AUTO_SUPERADMIN_PASS}"
    [[ -n "${AUTO_SUPERADMIN_NOTE:-}" ]] && ui_kv "Saved in" "${AUTO_SUPERADMIN_NOTE}"
    log_warn "Copy the Second-factor token from the reset output above — required at login."
    ui_blank
  elif [[ -n "$SUPERADMIN_PASS" ]]; then
    log_ok "Superadmin password was reset as requested"
    ui_blank
  fi
  log_warn "Self-signed cert: browser may show ${BOLD}Not Secure${NC} — accept once or upload a cert in Superadmin."
  ui_blank

  {
    echo ""
    echo "─── Last update ───────────────────────────────────────────────"
    echo "  Version     : v${new_version}"
    echo "  Git commit  : ${source_commit}"
    echo "  Git ref     : ${TAG:-$BRANCH}"
    echo "  Date        : $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "  App URL     : https://${server_ip}"
    echo "  Mode        : bare-metal"
    if [[ -n "${AUTO_SUPERADMIN_PASS:-}" ]]; then
      echo "  Superadmin  : ${SUPERADMIN_USER:-superadmin} / ${AUTO_SUPERADMIN_PASS}"
    fi
  } >> "${INSTALL_DIR}/INSTALL_INFO.txt" 2>/dev/null || true
}

CLONE_DIR=""

main() {
  require_root
  export DEBIAN_FRONTEND=noninteractive
  command -v git >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq git rsync curl python3; }

  if [[ "$LIST_TAGS" -eq 1 ]]; then
    ui_banner "FoodMood  ·  Tags"
    list_remote_tags
    ui_blank
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
    ui_banner "FoodMood  ·  MongoDB repair"
    log_info "Repair only (no code sync)…"
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
    log_ok "Repair complete — open https://${server_ip}/login"
    ui_blank
    exit 0
  fi

  if [[ -n "$TAG" && ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log_err "Invalid tag format. Example: v1.5.0"
    exit 1
  fi

  if [[ ! -d "$INSTALL_DIR" || ! -f "${INSTALL_DIR}/.env" ]]; then
    log_err "FoodMood is not installed. Run install.sh first:"
    log_dim "curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/install.sh | sudo bash"
    exit 1
  fi

  ui_blank
  echo -e "  ${DIM}Preparing update…${NC}"
  ui_blank

  fetch_source
  trap 'rm -rf "$CLONE_DIR"' EXIT
  load_lib "${CLONE_DIR}/deploy/lib.sh"
  # Keep pretty loggers after lib.sh (lib may redefine them)
  log_info()  { echo -e "  ${CYAN}●${NC}  $*"; }
  log_ok()    { echo -e "  ${GREEN}✔${NC}  $*"; }
  log_warn()  { echo -e "  ${YELLOW}▲${NC}  $*"; }
  log_err()   { echo -e "  ${RED}✖${NC}  $*" >&2; }

  exit_docker_to_bare_metal_if_needed
  apply_update "$CLONE_DIR"
}

main "$@"
