#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — single-file automated installer (Ubuntu/Debian)
#  Zero prompts. All credentials are generated automatically and
#  shown ONCE at the end of the install.
#
#  One-line install (fresh server):
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/install.sh | sudo bash
#
#  After install — ONLY use update (code, HTTPS, fonts, MongoDB, health):
#    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash
#
#  Reset superadmin during update:
#    curl -fsSL .../deploy/update.sh | sudo bash -s -- --superadmin-pass 'YourPass@123!'
#
#  From a local clone:
#    sudo bash deploy/install.sh
#
#  Custom credentials (optional):
#    curl -fsSL .../install.sh | sudo MONGO_USER=foodadmin MONGO_PASS='Pass123!' bash
#    sudo bash deploy/install.sh --mongo-user foodadmin --mongo-pass 'Pass123!'
#
#  Options:
#    --repo <url>            Git repository (default: project GitHub repo)
#    --branch <name>         Branch (default: main)
#    --tag <vX.Y.Z>          Specific tag — overrides branch
#    --mongo-user <name>     MongoDB username (default: foodadmin)
#    --mongo-pass <pass>     MongoDB password (default: auto-generated)
#    --superadmin-user <u>   Superadmin username (default: superadmin)
#    --superadmin-pass <p>   Superadmin password (default: auto-generated)
#    --no-firewall           Skip UFW firewall
#    --no-hardening          Skip Linux hardening
# ═══════════════════════════════════════════════════════════════
# -E propagates the ERR trap into functions so failures report their line
set -Eeuo pipefail

# ─── Fixed configuration ──────────────────────────────────────
INSTALL_DIR="/opt/food"
APP_USER="foodapp"
APP_GROUP="foodapp"
DB_NAME="food_ordering"
SERVICE_NAME="foodmood"
NODE_MAJOR="20"
INSTALL_INFO_FILE="${INSTALL_DIR}/INSTALL_INFO.txt"
INSTALLER_VERSION="1.5.13"
STEP_TOTAL=17
STEP_CURRENT=0
SSH_PORT=22

# ─── Options (env vars or flags) ──────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/5emad/FoodMood.git}"
BRANCH="${BRANCH:-main}"
MONGO_USER="${MONGO_USER:-}"
MONGO_PASS="${MONGO_PASS:-}"
SUPERADMIN_USER="${SUPERADMIN_USER:-}"
SUPERADMIN_PASS="${SUPERADMIN_PASS:-}"
ENABLE_FIREWALL=1
ENABLE_HARDENING=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)            REPO_URL="$2"; shift 2 ;;
    --branch)          BRANCH="$2"; shift 2 ;;
    --tag)             BRANCH="$2"; shift 2 ;;
    --mongo-user)      MONGO_USER="$2"; shift 2 ;;
    --mongo-pass)      MONGO_PASS="$2"; shift 2 ;;
    --superadmin-user) SUPERADMIN_USER="$2"; shift 2 ;;
    --superadmin-pass) SUPERADMIN_PASS="$2"; shift 2 ;;
    --no-firewall)     ENABLE_FIREWALL=0; shift ;;
    --no-hardening)    ENABLE_HARDENING=0; shift ;;
    --quick|-q)        shift ;;  # legacy flag — quick is the only mode now
    *) shift ;;
  esac
done

# ─── Colors and logging ───────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
log_busy() { echo -e "${DIM}    ⏳ $*${NC}"; }

progress_percent() {
  local step="${1:-$STEP_CURRENT}"
  echo $(( step * 100 / STEP_TOTAL ))
}

render_progress_bar() {
  local pct="${1:-0}"
  local width=24
  local filled=$(( pct * width / 100 ))
  local empty=$(( width - filled ))
  local bar filled_part empty_part
  filled_part="$(printf '%*s' "$filled" '' | tr ' ' '█')"
  empty_part="$(printf '%*s' "$empty" '' | tr ' ' '░')"
  bar="${filled_part}${empty_part}"
  echo -e "${CYAN}${bar}${NC} ${BOLD}${pct}%${NC}"
}

show_progress() {
  local pct
  pct="$(progress_percent)"
  echo -e "${BOLD}Install progress:${NC} $(render_progress_bar "$pct")"
}

log_progress() {
  local pct
  pct="$(progress_percent)"
  echo -e "${DIM}    [${pct}%] $*${NC}"
}

trap 'log_err "Install stopped at line ${LINENO} (exit code $?). Fix the issue above and re-run."' ERR

step_begin() {
  STEP_CURRENT=$((STEP_CURRENT + 1))
  local pct start_pct
  pct="$(progress_percent)"
  start_pct=$(( (STEP_CURRENT - 1) * 100 / STEP_TOTAL ))
  echo ""
  echo -e "${MAGENTA}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${MAGENTA}${BOLD}  ▶ Step ${STEP_CURRENT}/${STEP_TOTAL}${NC} ${DIM}(${start_pct}% → ${pct}%)${NC}"
  echo -e "${MAGENTA}${BOLD}  ${BOLD}$*${NC}"
  echo -e "  $(render_progress_bar "$pct")"
  echo -e "${MAGENTA}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

step_complete() {
  local pct
  pct="$(progress_percent)"
  log_ok "Step ${STEP_CURRENT}/${STEP_TOTAL} complete — ${pct}%"
}

show_banner() {
  echo ""
  echo -e "${MAGENTA}${BOLD}"
  cat <<'BANNER'
    ███████╗ ██████╗  ██████╗ ██████╗     ███╗   ███╗ ██████╗  ██████╗ ██████╗
    ██╔════╝██╔═══██╗██╔═══██╗██╔══██╗    ████╗ ████║██╔═══██╗██╔═══██╗██╔══██╗
    █████╗  ██║   ██║██║   ██║██║  ██║    ██╔████╔██║██║   ██║██║   ██║██║  ██║
    ██╔══╝  ██║   ██║██║   ██║██║  ██║    ██║╚██╔╝██║██║   ██║██║   ██║██║  ██║
    ██║     ╚██████╔╝╚██████╔╝██████╔╝    ██║ ╚═╝ ██║╚██████╔╝╚██████╔╝██████╔╝
    ╚═╝      ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝     ╚═╝ ╚═════╝  ╚═════╝ ╚═════╝
BANNER
  echo -e "${NC}"
  echo -e "${CYAN}${BOLD}           FoodMood — Enterprise Meal Ordering${NC}"
  echo -e "           Installer v${INSTALLER_VERSION}"
  echo -e "${DIM}              Fully automated install · Ubuntu / Debian${NC}"
  echo ""
}

show_roadmap() {
  echo -e "${BOLD}Install plan (${STEP_TOTAL} steps — fully automatic, no questions):${NC}"
  local steps=(
    "Fetch application source"
    "Install base packages"
    "Linux hardening baseline"
    "Install Node.js"
    "Install MongoDB"
    "Install PDF browser"
    "Install Nginx"
    "Deploy FoodMood application"
    "Configure MongoDB security"
    "Create environment file (.env)"
    "Install Node.js dependencies"
    "Enable systemd service"
    "Configure Nginx"
    "Configure UFW firewall"
    "Create superadmin account"
    "Post-install verification"
    "Summary and credentials"
  )
  local i=1
  for s in "${steps[@]}"; do
    echo -e "  ${DIM}${i}.${NC} $s"
    i=$((i + 1))
  done
  echo ""
  echo -e "${CYAN}[*]${NC} All credentials are auto-generated and shown ${BOLD}once${NC} at the end."
  echo -e "${YELLOW}[!]${NC} If there is no output for several minutes, apt or npm is still running — ${BOLD}do not interrupt${NC}."
  echo ""
}

# ─── Helpers ──────────────────────────────────────────────────
require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_err "Run as root: curl -fsSL .../install.sh | sudo bash"
    exit 1
  fi
}

detect_server_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [[ -z "$ip" ]]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

detect_ssh_port() {
  local port=""
  if command -v sshd >/dev/null 2>&1; then
    port="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"
  fi
  if [[ -z "$port" || ! "$port" =~ ^[0-9]+$ ]]; then
    port=22
  fi
  SSH_PORT="$port"
}

rand_secret() {
  local secret
  secret="$({ openssl rand -base64 48 2>/dev/null || head -c 48 /dev/urandom | base64; } | tr -d '\n/+=' | cut -c1-64 || true)"
  if [[ -z "$secret" ]]; then
    secret="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  echo "${secret:0:64}"
}

rand_password() {
  # Alphanumeric only — safe in URIs, shells, and copy-paste
  local pw
  pw="$({ openssl rand -base64 24 2>/dev/null || head -c 24 /dev/urandom | base64; } | tr -dc 'A-Za-z0-9' | cut -c1-16 || true)"
  if [[ -z "$pw" ]]; then
    pw="$(openssl rand -hex 8 2>/dev/null || head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  echo "${pw:0:16}"
}

url_encode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote_plus(sys.argv[1]))' "$1"
}

mongo_auth_uri() {
  local encoded
  encoded="$(url_encode "$MONGO_PASS")"
  echo "mongodb://${MONGO_USER}:${encoded}@127.0.0.1:27017/${DB_NAME}?authSource=${DB_NAME}"
}

mongo_auth_uri_for() {
  local user="$1" pass="$2" encoded
  encoded="$(url_encode "$pass")"
  echo "mongodb://${user}:${encoded}@127.0.0.1:27017/${DB_NAME}?authSource=${DB_NAME}"
}

mongodb_auth_enabled() {
  grep -qE 'authorization:[[:space:]]*enabled' /etc/mongod.conf 2>/dev/null
}

parse_mongo_uri_credentials() {
  local uri="$1"
  python3 - "$uri" <<'PY'
import sys, urllib.parse
uri = sys.argv[1].strip()
if not uri.startswith('mongodb://'):
    sys.exit(1)
rest = uri[len('mongodb://'):]
at = rest.rfind('@')
if at < 0:
    sys.exit(1)
userpass = rest[:at]
user, _, passwd = userpass.partition(':')
if not user:
    sys.exit(1)
print(user)
print(urllib.parse.unquote(passwd))
PY
}

find_mongo_backup_env() {
  local candidate newest=""
  for candidate in /tmp/food-env-backup-*.env "${INSTALL_DIR}/.env"; do
    [[ -f "$candidate" ]] || continue
    newest="$candidate"
  done
  if [[ -n "$newest" ]]; then
    echo "$newest"
    return 0
  fi
  return 1
}

mongo_user_exists() {
  local uri="${1:-}" user="$2" result
  if [[ -n "$uri" ]]; then
    result="$(mongosh --quiet "$uri" --eval "db.getUser('${user}') ? 'yes' : 'no'" 2>/dev/null || echo "no")"
  else
    result="$(mongosh --quiet "$DB_NAME" --eval "db.getUser('${user}') ? 'yes' : 'no'" 2>/dev/null || echo "no")"
  fi
  [[ "$result" == "yes" ]]
}

mongo_create_user_js() {
  local tmp_js user="$1" pass="$2" db="$3"
  tmp_js="$(mktemp)"
  python3 - "$tmp_js" "$user" "$pass" "$db" <<'PY'
import json, sys
path, user, pwd, db = sys.argv[1:5]
body = f"""db.createUser({{
  user: {json.dumps(user)},
  pwd: {json.dumps(pwd)},
  roles: [{{ role: 'readWrite', db: {json.dumps(db)} }}]
}});"""
open(path, 'w', encoding='utf-8').write(body)
PY
  echo "$tmp_js"
}

mongo_set_user_password() {
  local user="$1" pass="$2" uri="${3:-}"
  local tmp_js encoded_pass
  encoded_pass="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$pass")"
  tmp_js="$(mktemp)"
  cat > "$tmp_js" <<EOF
db.updateUser('${user}', { pwd: ${encoded_pass} });
EOF
  if [[ -n "$uri" ]]; then
    mongosh --quiet "$uri" --file "$tmp_js"
  else
    mongosh --quiet "$DB_NAME" --file "$tmp_js"
  fi
  rm -f "$tmp_js"
}

mongodb_strip_auth_and_restart() {
  local conf="/etc/mongod.conf"
  [[ -f "$conf" ]] || return 0
  cp -a "$conf" "${conf}.bak.$(date +%s)"
  awk '
    /^security:/ { skip=1; next }
    skip && /^[^[:space:]#]/ { skip=0 }
    skip { next }
    { print }
  ' "$conf" > "${conf}.tmp"
  mv "${conf}.tmp" "$conf"
  systemctl restart mongod
  wait_for_mongodb "MongoDB (no auth)" "" 30
}

mongodb_disable_auth() {
  mongodb_strip_auth_and_restart
}

mongodb_enable_auth() {
  local conf="/etc/mongod.conf" auth_uri
  [[ -f "$conf" ]] || return 1
  if grep -qE 'authorization:[[:space:]]*disabled' "$conf"; then
    sed -i 's/authorization:[[:space:]]*disabled/authorization: enabled/' "$conf"
  elif ! grep -qE 'authorization:[[:space:]]*enabled' "$conf"; then
    if grep -q '^security:' "$conf"; then
      sed -i '/^security:/a\  authorization: enabled' "$conf"
    else
      printf '\nsecurity:\n  authorization: enabled\n' >> "$conf"
    fi
  fi
  systemctl restart mongod
  auth_uri="$(mongo_auth_uri)"
  wait_for_mongodb "MongoDB (authenticated)" "$auth_uri" 45
}

mongo_ping_server() {
  mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'
}

mongo_ping() {
  local uri="${1:-}"
  if [[ -n "$uri" ]]; then
    mongosh --quiet "$uri" --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'
  else
    mongo_ping_server
  fi
}

mongo_port_listening() {
  ss -tln 2>/dev/null | grep -q ':27017 ' \
    || netstat -tln 2>/dev/null | grep -q ':27017 '
}

start_mongod_direct() {
  command -v mongod >/dev/null 2>&1 || return 1
  mkdir -p /var/lib/mongodb /var/log/mongodb
  chown -R mongodb:mongodb /var/lib/mongodb /var/log/mongodb 2>/dev/null || true
  if [[ -f /etc/mongod.conf ]]; then
    mongod --config /etc/mongod.conf --fork >/dev/null 2>&1 && return 0
  fi
  mongod --dbpath /var/lib/mongodb --logpath /var/log/mongodb/mongod.log --bind_ip 127.0.0.1 --fork >/dev/null 2>&1
}

ensure_mongod_running() {
  local uri="${1:-}"
  local server_up=0

  if mongo_ping_server; then
    server_up=1
  else
    log_warn "MongoDB not responding — starting mongod..."
    systemctl start mongod 2>/dev/null || true
    sleep 2
    if mongo_ping_server; then
      server_up=1
    else
      log_warn "MongoDB still not responding — restarting mongod..."
      systemctl restart mongod 2>/dev/null || true
      sleep 2
      mongo_ping_server && server_up=1
    fi
    if [[ "$server_up" -ne 1 ]] && ! mongo_port_listening; then
      log_warn "Port 27017 is not listening — starting mongod directly..."
      start_mongod_direct || true
      sleep 2
      mongo_ping_server && server_up=1
    fi
  fi

  if [[ "$server_up" -ne 1 ]]; then
    return 1
  fi

  if [[ -n "$uri" ]]; then
    mongo_ping "$uri"
    return $?
  fi
  return 0
}

wait_for_mongodb() {
  local label="${1:-MongoDB}"
  local uri="${2:-}"
  local attempts="${3:-30}"
  local i
  log_busy "Waiting for ${label} — up to $((attempts * 2)) seconds"
  for ((i = 1; i <= attempts; i++)); do
    if [[ -n "$uri" ]]; then
      mongo_ping "$uri" && return 0
    else
      mongo_ping_server && return 0
    fi
    if (( i % 5 == 0 )); then
      log_progress "Still waiting for ${label} (attempt ${i}/${attempts})..."
      ensure_mongod_running "" || true
    fi
    sleep 2
  done
  return 1
}

wait_for_api_health() {
  local attempts="${1:-30}"
  local i body
  log_busy "Waiting for API health — up to $((attempts * 2)) seconds"
  for ((i = 1; i <= attempts; i++)); do
    body="$(curl -sf --max-time 5 http://127.0.0.1:3000/api/system/health 2>/dev/null || true)"
    if echo "$body" | grep -q '"healthy":[[:space:]]*true'; then
      return 0
    fi
    if (( i % 5 == 0 )); then
      log_progress "Still waiting for API health (attempt ${i}/${attempts})..."
    fi
    sleep 2
  done
  return 1
}

# ─── Step 1: fetch source ─────────────────────────────────────
PROJECT_DIR=""
CLONE_DIR=""

resolve_project_source() {
  step_begin "Fetch application source"

  # If this script lives inside a project checkout, use it directly
  local script_path="${BASH_SOURCE[0]:-}"
  if [[ -n "$script_path" && -f "$script_path" ]]; then
    local candidate
    candidate="$(cd "$(dirname "$script_path")/.." 2>/dev/null && pwd || true)"
    if [[ -n "$candidate" && -f "$candidate/package.json" && -f "$candidate/server.js" ]]; then
      PROJECT_DIR="$candidate"
      log_ok "Using local project source: ${PROJECT_DIR}"
      step_complete
      return
    fi
  fi

  log_info "Repository: ${REPO_URL}"
  log_info "Ref: ${BRANCH}"
  if ! command -v git >/dev/null 2>&1; then
    log_busy "Installing git..."
    apt-get update -qq
    apt-get install -y -qq git
  fi
  CLONE_DIR="$(mktemp -d /tmp/food-install-XXXXXX)"
  log_busy "Cloning — may take 30 seconds to 2 minutes..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR"
  PROJECT_DIR="$CLONE_DIR"
  log_ok "Source fetched to ${PROJECT_DIR}"
  step_complete
}

cleanup_clone() {
  if [[ -n "$CLONE_DIR" && -d "$CLONE_DIR" ]]; then
    rm -rf "$CLONE_DIR"
  fi
}

on_exit() {
  local code=$?
  cleanup_clone
  if [[ "$code" -ne 0 ]]; then
    log_err "Install exited unexpectedly (code ${code}). Re-run and send this output if it persists."
  fi
}
trap on_exit EXIT

# ─── Step 2: base packages ────────────────────────────────────
install_base_packages() {
  step_begin "Install base packages"
  export DEBIAN_FRONTEND=noninteractive
  log_busy "Updating apt repositories — usually 1-3 minutes"
  apt-get update
  log_busy "Installing base packages — watch apt output; please wait"
  apt-get install -y \
    curl gnupg ca-certificates lsb-release apt-transport-https \
    software-properties-common rsync openssl python3 ufw fail2ban \
    unattended-upgrades git sudo
  # Browser rendering libs (names differ across releases — non-fatal)
  apt-get install -y fonts-liberation xdg-utils 2>/dev/null || true
  apt-get install -y libasound2t64 2>/dev/null || apt-get install -y libasound2 2>/dev/null || true
  apt-get install -y \
    libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 \
    libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxrandr2 2>/dev/null || true
  log_ok "Base packages installed."
  step_complete
}

# ─── Step 3: hardening ────────────────────────────────────────
apply_system_hardening() {
  if [[ "$ENABLE_HARDENING" -ne 1 ]]; then
    step_begin "Linux hardening baseline"
    log_warn "Skipped (--no-hardening)."
    step_complete
    return
  fi
  step_begin "Linux hardening baseline"
  log_info "Applying kernel security settings (sysctl)..."
  cat > /etc/sysctl.d/99-foodmood-hardening.conf <<'SYSCTL'
# FoodMood — hardening baseline
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
fs.suid_dumpable = 0
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
SYSCTL
  sysctl --system >/dev/null 2>&1 || true

  log_info "Hardening SSH (keeps current access)..."
  mkdir -p /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/99-foodmood-hardening.conf <<'SSHCONF'
# FoodMood installer — SSH hardening (keeps existing auth methods)
MaxAuthTries 3
LoginGraceTime 30
PermitEmptyPasswords no
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
AllowTcpForwarding no
SSHCONF
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

  log_info "Enabling fail2ban for SSH..."
  detect_ssh_port
  cat > /etc/fail2ban/jail.d/foodmood-ssh.local <<EOF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
bantime = 3600
findtime = 600
EOF
  systemctl enable fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban >/dev/null 2>&1 || true

  log_info "Enabling unattended security upgrades..."
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AUTOUP'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTOUP
  systemctl enable unattended-upgrades >/dev/null 2>&1 || true
  systemctl start unattended-upgrades >/dev/null 2>&1 || true

  log_ok "Hardening applied (sysctl, SSH, fail2ban, auto-updates)."
  step_complete
}

# ─── Step 4: Node.js ──────────────────────────────────────────
install_nodejs() {
  step_begin "Install Node.js"
  if command -v node >/dev/null 2>&1; then
    local ver
    ver="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$ver" -ge "$NODE_MAJOR" ]]; then
      log_ok "Node.js $(node -v) already installed."
      step_complete
      return
    fi
  fi
  log_busy "Installing Node.js ${NODE_MAJOR}.x from NodeSource — 1-2 minutes"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
  log_ok "Node.js $(node -v) installed."
  step_complete
}

# ─── Step 5: MongoDB ──────────────────────────────────────────
MONGO_SOURCES_FILE="/etc/apt/sources.list.d/mongodb-org.list"

mongo_packages_available() {
  apt-cache show mongodb-org-server >/dev/null 2>&1 \
    || apt-cache show mongodb-org >/dev/null 2>&1
}

install_mongo_packages() {
  if apt-get install -y mongodb-org; then
    return 0
  fi
  log_warn "mongodb-org metapackage missing — installing core MongoDB packages..."
  apt-get install -y \
    mongodb-org-server \
    mongodb-org-database \
    mongodb-org-mongos \
    mongodb-org-tools \
    mongodb-mongosh
}

try_mongo_repo() {
  local label="$1" key_url="$2" keyring="$3" repo_line="$4"
  log_info "Trying MongoDB repository: ${label}"

  if ! curl -fsSL --max-time 60 "$key_url" | gpg -o "$keyring" --dearmor --yes 2>/dev/null; then
    log_warn "${label}: cannot download signing key — skipping."
    return 1
  fi
  echo "$repo_line" > "$MONGO_SOURCES_FILE"

  if ! apt-get update >/tmp/apt-mongo-update.log 2>&1; then
    log_warn "${label}: repository not reachable (403/blocked) — skipping."
    rm -f "$MONGO_SOURCES_FILE"
    apt-get update >/dev/null 2>&1 || true
    return 1
  fi

  if ! mongo_packages_available; then
    log_warn "${label}: MongoDB packages not found in repo — skipping."
    rm -f "$MONGO_SOURCES_FILE"
    apt-get update >/dev/null 2>&1 || true
    return 1
  fi

  log_busy "${label}: installing MongoDB — 2-5 minutes"
  if install_mongo_packages; then
    return 0
  fi
  rm -f "$MONGO_SOURCES_FILE"
  apt-get update >/dev/null 2>&1 || true
  return 1
}

install_mongodb() {
  step_begin "Install MongoDB"
  if command -v mongod >/dev/null 2>&1; then
    log_ok "MongoDB already installed."
    systemctl start mongod 2>/dev/null || true
    if ! wait_for_mongodb "MongoDB"; then
      log_err "MongoDB is installed but not accepting connections."
      exit 1
    fi
    step_complete
    return
  fi

  # Clean up any half-configured repo from a previous failed run
  rm -f "$MONGO_SOURCES_FILE" /etc/apt/sources.list.d/mongodb-org-7.0.list

  local codename distro abrha_component
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}")"
  if grep -qi '^ID=ubuntu' /etc/os-release 2>/dev/null; then
    distro="ubuntu"
    abrha_component="multiverse"
    case "$codename" in
      focal|jammy|noble) ;;
      *) log_warn "Ubuntu '${codename}' not in MongoDB repo matrix — using jammy packages."; codename="jammy" ;;
    esac
  else
    distro="debian"
    abrha_component="main"
    case "$codename" in
      bullseye|bookworm) ;;
      *) log_warn "Debian '${codename}' not in MongoDB repo matrix — using bookworm packages."; codename="bookworm" ;;
    esac
  fi

  # Repo 1: official MongoDB (blocked with 403 from some regions, e.g. Iran)
  # Repo 2: Abrha/ParsPack mirror hosted in Iran (mirrors mongodb-org packages)
  if try_mongo_repo \
      "official repo.mongodb.org" \
      "https://www.mongodb.org/static/pgp/server-7.0.asc" \
      "/usr/share/keyrings/mongodb-server-7.0.gpg" \
      "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/${distro} ${codename}/mongodb-org/7.0 multiverse"; then
    :
  elif try_mongo_repo \
      "Abrha mirror (Iran) 7.0" \
      "https://repo.abrha.net/mongodb/${distro}/gpg" \
      "/usr/share/keyrings/abrha-mongodb.gpg" \
      "deb [ arch=amd64 signed-by=/usr/share/keyrings/abrha-mongodb.gpg ] https://repo.abrha.net/mongodb/${distro} ${codename}/mongodb-org/7.0 ${abrha_component}"; then
    :
  elif try_mongo_repo \
      "Abrha mirror (Iran) 8.0" \
      "https://repo.abrha.net/mongodb/${distro}/gpg" \
      "/usr/share/keyrings/abrha-mongodb.gpg" \
      "deb [ arch=amd64 signed-by=/usr/share/keyrings/abrha-mongodb.gpg ] https://repo.abrha.net/mongodb/${distro} ${codename}/mongodb-org/8.0 ${abrha_component}"; then
    :
  else
    log_err "MongoDB could not be installed from any repository."
    log_err "Check network access to repo.mongodb.org or repo.abrha.net and re-run."
    exit 1
  fi

  systemctl enable mongod
  systemctl start mongod
  if ! wait_for_mongodb "MongoDB"; then
    log_err "MongoDB installed but failed to start."
    exit 1
  fi
  log_ok "MongoDB installed and started."
  step_complete
}

# ─── Step 6: browser for PDF export ───────────────────────────
install_chrome_for_pdf() {
  step_begin "Install PDF browser"
  if apt-get install -y -qq chromium-browser 2>/dev/null \
    || apt-get install -y -qq chromium 2>/dev/null; then
    log_ok "Chromium installed."
    step_complete
    return
  fi
  log_warn "Chromium not in repo; trying Google Chrome..."
  local chrome_deb="/tmp/google-chrome-stable.deb"
  curl -fsSL -o "$chrome_deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  if ! apt-get install -y -qq "$chrome_deb"; then
    dpkg -i "$chrome_deb" || true
    apt-get install -f -y -qq
  fi
  rm -f "$chrome_deb"
  log_ok "Google Chrome installed."
  step_complete
}

# ─── Step 7: Nginx ────────────────────────────────────────────
install_nginx_stack() {
  step_begin "Install Nginx"
  apt-get install -y -qq nginx
  systemctl enable nginx
  systemctl start nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
  if systemctl is-active --quiet nginx; then
    log_ok "Nginx installed and started."
  else
    log_warn "Nginx installed but not running yet — will start at HTTPS configuration step."
  fi
  step_complete
}

# ─── Step 8: deploy application ───────────────────────────────
deploy_application() {
  step_begin "Deploy FoodMood application"
  log_info "Creating service user and copying project to ${INSTALL_DIR}..."
  if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -d "$INSTALL_DIR" -s /bin/bash "$APP_USER"
  fi
  mkdir -p "$INSTALL_DIR"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude INSTALL_INFO.txt \
    --exclude '*.log' \
    "$PROJECT_DIR/" "$INSTALL_DIR/"
  chown -R "$APP_USER:$APP_GROUP" "$INSTALL_DIR"
  chmod 755 "$INSTALL_DIR"
  chmod -R a+rX "${INSTALL_DIR}/public" 2>/dev/null || true
  chmod +x "${INSTALL_DIR}/deploy/"*.sh 2>/dev/null || true
  log_ok "Application deployed to ${INSTALL_DIR}."
  step_complete
}

# ─── Step 9: MongoDB auth ─────────────────────────────────────
setup_mongodb_auth() {
  step_begin "Configure MongoDB security"
  if ! ensure_mongod_running ""; then
    log_err "Cannot connect to MongoDB."
    exit 1
  fi

  local auth_uri backup_env backup_uri backup_user backup_pass tmp_js

  auth_uri="$(mongo_auth_uri)"
  if mongo_ping "$auth_uri"; then
    log_ok "MongoDB user '${MONGO_USER}' authenticated."
    step_complete
    return
  fi

  if backup_env="$(find_mongo_backup_env)"; then
    backup_uri="$(grep '^MONGODB_URI=' "$backup_env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
    if [[ -n "$backup_uri" ]]; then
      mapfile -t _mongo_creds < <(parse_mongo_uri_credentials "$backup_uri" 2>/dev/null || true)
      if [[ "${#_mongo_creds[@]}" -ge 2 ]]; then
        backup_user="${_mongo_creds[0]}"
        backup_pass="${_mongo_creds[1]}"
        auth_uri="$(mongo_auth_uri_for "$backup_user" "$backup_pass")"
        if mongo_ping "$auth_uri" && [[ "$backup_user" == "$MONGO_USER" ]]; then
          log_info "Resetting MongoDB password from backup credentials..."
          mongo_set_user_password "$MONGO_USER" "$MONGO_PASS" "$auth_uri"
          auth_uri="$(mongo_auth_uri)"
          if mongo_ping "$auth_uri"; then
            log_ok "MongoDB password updated for '${MONGO_USER}'."
            step_complete
            return
          fi
        fi
      fi
    fi
  fi

  log_warn "MongoDB credentials mismatch (reinstall) — removing auth to reset user..."
  mongodb_strip_auth_and_restart || {
    log_err "Failed to reset MongoDB authentication."
    log_err "Run first: curl -fsSL .../deploy/reset-mongodb.sh | sudo bash"
    exit 1
  }

  if mongo_user_exists "" "$MONGO_USER"; then
    log_info "Updating password for existing user '${MONGO_USER}'..."
    mongo_set_user_password "$MONGO_USER" "$MONGO_PASS"
    log_ok "MongoDB user '${MONGO_USER}' password updated."
  else
    tmp_js="$(mongo_create_user_js "$MONGO_USER" "$MONGO_PASS" "$DB_NAME")"
    mongosh --quiet "$DB_NAME" --file "$tmp_js"
    rm -f "$tmp_js"
    log_ok "Database user '${MONGO_USER}' created."
  fi

  mongodb_enable_auth || {
    log_err "MongoDB did not become ready after enabling authentication."
    exit 1
  }
  log_ok "MongoDB authentication enabled."

  auth_uri="$(mongo_auth_uri)"
  if ! mongo_ping "$auth_uri"; then
    log_err "MongoDB user '${MONGO_USER}' cannot authenticate after setup."
    log_err "Run: curl -fsSL .../deploy/reset-mongodb.sh | sudo bash  then re-run install."
    exit 1
  fi

  step_complete
}

# ─── Step 10: .env ────────────────────────────────────────────
SESSION_SECRET=""
JWT_SECRET=""
BACKUP_SECRET=""
PASSWORD_PEPPER=""
ANNOUNCEMENT_ENCRYPTION_KEY=""
LDAP_ENCRYPTION_KEY=""

write_env_file() {
  step_begin "Create environment file (.env)"
  local encoded_pass app_url mongo_uri
  encoded_pass="$(url_encode "$MONGO_PASS")"
  mongo_uri="mongodb://${MONGO_USER}:${encoded_pass}@127.0.0.1:27017/${DB_NAME}?authSource=${DB_NAME}"
  app_url="https://${SERVER_IP}"

  SESSION_SECRET="$(rand_secret)"
  JWT_SECRET="$(rand_secret)"
  BACKUP_SECRET="$(rand_secret)"
  PASSWORD_PEPPER="$(rand_secret)"
  ANNOUNCEMENT_ENCRYPTION_KEY="$(rand_secret)"
  LDAP_ENCRYPTION_KEY="$(rand_secret)"

  cat > "${INSTALL_DIR}/.env" <<EOF
NODE_ENV=production
PORT=3000
APP_URL=${app_url}
ALLOWED_ORIGINS=${app_url}
TRUST_TLS=true

MONGODB_URI=${mongo_uri}
MONGODB_TLS=false
MONGODB_MAX_POOL_SIZE=10
MONGODB_SERVER_SELECTION_TIMEOUT_MS=8000

SESSION_SECRET=${SESSION_SECRET}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRE=8h
SESSION_IDLE_MINUTES=30
SESSION_MAX_HOURS=8
SESSION_BIND_UA=true
BACKUP_SECRET=${BACKUP_SECRET}
PASSWORD_PEPPER=${PASSWORD_PEPPER}
ANNOUNCEMENT_ENCRYPTION_KEY=${ANNOUNCEMENT_ENCRYPTION_KEY}
LDAP_ENCRYPTION_KEY=${LDAP_ENCRYPTION_KEY}

LOG_DIR=/var/log/foodmood

# ── LDAP (optional — see docs/LDAP-PRODUCTION.md) ─────────
# LDAP_URL=ldaps://dc.company.local:636
# LDAP_SECURITY=ldaps
# LDAP_BASE_DN=DC=company,DC=local
# LDAP_BIND_DN=CN=svc-food,DC=company,DC=local
# LDAP_BIND_PASSWORD=          # or: encrypted value from admin panel
# LDAP_CA_CERT_PATH=/opt/food/certs/ldap-ca.pem
# LDAP_USER_FILTER=(sAMAccountName={{username}})
# LDAP_ALLOWED_HOSTS=dc.company.local
EOF

  chown "$APP_USER:$APP_GROUP" "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
  log_ok ".env file created."
  step_complete
}

# ─── Step 11: npm install ─────────────────────────────────────
install_npm_deps() {
  step_begin "Install Node.js dependencies"
  mkdir -p "${INSTALL_DIR}/certs/ssl"
  chown "$APP_USER:$APP_GROUP" "${INSTALL_DIR}/certs" "${INSTALL_DIR}/certs/ssl"
  chmod 750 "${INSTALL_DIR}/certs" "${INSTALL_DIR}/certs/ssl"
  log_busy "npm install --omit=dev — usually 2-8 minutes; please wait"

  local npm_rc=1
  if sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev --progress=true"; then
    npm_rc=0
  else
    log_warn "npm registry.npmjs.org unreachable — trying npmmirror.com fallback..."
    if sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev --progress=true --registry=https://registry.npmmirror.com"; then
      npm_rc=0
    fi
  fi

  if [[ "$npm_rc" -ne 0 ]]; then
    log_err "npm install failed from all registries. Check network and re-run."
    exit 1
  fi

  log_busy "Syncing frontend vendor assets (CSS/JS/fonts)..."
  if ! sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm run vendor:sync"; then
    log_err "Vendor asset sync failed — CSS/JS will not load. Check node_modules and re-run."
    exit 1
  fi
  if [[ ! -f "${INSTALL_DIR}/public/css/enterprise-theme.css" \
     || ! -f "${INSTALL_DIR}/public/vendor/fontawesome/css/all.min.css" \
     || ! -f "${INSTALL_DIR}/public/vendor/vazirmatn/vazirmatn.css" \
     || ! -f "${INSTALL_DIR}/public/vendor/vazirmatn/Vazirmatn-Regular.woff2" \
     || ! -f "${INSTALL_DIR}/public/vendor/fontawesome/webfonts/fa-solid-900.woff2" ]]; then
    log_err "Required static assets are missing under ${INSTALL_DIR}/public/"
    log_err "Run: sudo -u ${APP_USER} bash -c 'cd ${INSTALL_DIR} && npm run vendor:sync'"
    exit 1
  fi
  log_ok "npm install completed."
  step_complete
}

# ─── Step 12: systemd ─────────────────────────────────────────
setup_systemd() {
  step_begin "Enable systemd service (foodmood)"
  mkdir -p /var/log/foodmood
  chown "$APP_USER:$APP_GROUP" /var/log/foodmood
  chmod 750 /var/log/foodmood

  if systemctl list-unit-files food.service >/dev/null 2>&1; then
    systemctl disable food 2>/dev/null || true
    systemctl stop food 2>/dev/null || true
    rm -f /etc/systemd/system/food.service
  fi

  cp "${INSTALL_DIR}/deploy/foodmood.service" "/etc/systemd/system/${SERVICE_NAME}.service"
  chmod +x "${INSTALL_DIR}/deploy/"*.sh 2>/dev/null || true

  # Allow foodapp to apply uploaded SSL certs without password.
  cat > /etc/sudoers.d/foodmood-ssl <<EOF
${APP_USER} ALL=(root) NOPASSWD: ${INSTALL_DIR}/deploy/apply-custom-ssl.sh
EOF
  chmod 440 /etc/sudoers.d/foodmood-ssl
  visudo -cf /etc/sudoers.d/foodmood-ssl >/dev/null 2>&1 || {
    rm -f /etc/sudoers.d/foodmood-ssl
    log_warn "Could not install sudoers rule for SSL apply — use manual apply-custom-ssl.sh"
  }

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"

  local auth_uri
  auth_uri="$(mongo_auth_uri)"
  if ! ensure_mongod_running "$auth_uri"; then
    log_err "MongoDB must be running before starting ${SERVICE_NAME}."
    exit 1
  fi

  systemctl restart "$SERVICE_NAME"
  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    log_err "Service failed to start. Log: journalctl -u ${SERVICE_NAME} -n 30"
    exit 1
  fi
  if ! wait_for_api_health 45; then
    log_err "Service is running but API is not healthy. Log: journalctl -u ${SERVICE_NAME} -n 30"
    exit 1
  fi
  log_ok "Service ${SERVICE_NAME} is active — starts automatically on boot."
  step_complete
}

# ─── Step 13: Nginx + HTTPS (self-signed cert) ─────────────────
source_nginx_tls_lib() {
  local candidate
  for candidate in "${INSTALL_DIR}/deploy/nginx-tls.sh" "${PROJECT_DIR}/deploy/nginx-tls.sh"; do
    if [[ -f "$candidate" ]]; then
      # shellcheck source=/dev/null
      source "$candidate"
      return 0
    fi
  done
  log_err "deploy/nginx-tls.sh not found — cannot configure HTTPS."
  exit 1
}

configure_nginx() {
  step_begin "Configure Nginx (HTTPS only)"
  source_nginx_tls_lib
  configure_https_only "$SERVER_IP" "$INSTALL_DIR" "$APP_USER"
  systemctl restart "$SERVICE_NAME"
  wait_for_api_health 45 || log_warn "API health check slow after HTTPS setup — continuing."
  log_ok "Nginx: https://${SERVER_IP} (self-signed — Not Secure until real certificate)"
  step_complete
}

# ─── Step 14: UFW ─────────────────────────────────────────────
setup_firewall() {
  if [[ "$ENABLE_FIREWALL" -ne 1 ]]; then
    step_begin "Configure UFW firewall"
    log_warn "Skipped (--no-firewall)."
    step_complete
    return
  fi
  step_begin "Configure UFW firewall"
  detect_ssh_port
  log_info "Allowing SSH port (${SSH_PORT}/tcp) before enabling firewall..."
  ufw --force reset >/dev/null 2>&1 || true
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "${SSH_PORT}/tcp" comment 'SSH'
  ufw allow 80/tcp comment 'HTTP / redirect'
  ufw allow 443/tcp comment 'HTTPS / Nginx'
  ufw logging medium
  ufw --force enable
  log_ok "UFW enabled — allowed ports: SSH(${SSH_PORT}), HTTP(80), HTTPS(443)."
  step_complete
}

# ─── Step 15: superadmin ──────────────────────────────────────
SUPERADMIN_CREDS_OUTPUT=""

create_superadmin_account() {
  step_begin "Create superadmin account"
  local auth_uri output attempt
  auth_uri="$(mongo_auth_uri)"
  if ! ensure_mongod_running "$auth_uri"; then
    log_err "MongoDB is not available — cannot create superadmin."
    exit 1
  fi

  for attempt in 1 2 3; do
    if output="$(sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node scripts/super-admin.js create $(printf '%q' "$SUPERADMIN_USER") $(printf '%q' "$SUPERADMIN_PASS")" 2>&1)"; then
      SUPERADMIN_CREDS_OUTPUT="$output"
      log_ok "Superadmin '${SUPERADMIN_USER}' created — credentials shown at the end."
      step_complete
      return
    fi
    if echo "$output" | grep -qi 'already exists'; then
      log_warn "Superadmin '${SUPERADMIN_USER}' already exists — skipping creation."
      step_complete
      return
    fi
    if (( attempt < 3 )); then
      log_warn "Superadmin creation attempt ${attempt}/3 failed — retrying in 5s..."
      ensure_mongod_running "$auth_uri" || true
      sleep 5
    fi
  done

  log_err "Superadmin creation failed:"
  echo "$output"
  exit 1
}

# ─── Step 16: verification ────────────────────────────────────
run_post_install_verify() {
  step_begin "Post-install verification"
  local ok=1

  if systemctl is-active --quiet "$SERVICE_NAME"; then
    log_ok "systemd: ${SERVICE_NAME} is active"
  else
    log_err "systemd: ${SERVICE_NAME} is not active"
    ok=0
  fi

  local auth_uri
  auth_uri="$(mongo_auth_uri)"
  if mongo_ping "$auth_uri"; then
    log_ok "MongoDB: accepting authenticated connections"
  else
    log_err "MongoDB: not accepting connections"
    ok=0
  fi

  local body=""
  if wait_for_api_health 15; then
    body="$(curl -sf --max-time 10 http://127.0.0.1:3000/api/system/health 2>/dev/null || true)"
    log_ok "API health: service is healthy"
  else
    body="$(curl -sf --max-time 10 http://127.0.0.1:3000/api/system/health 2>/dev/null || true)"
    if echo "$body" | grep -q '"healthy":[[:space:]]*false'; then
      log_err "API health: service unhealthy — ${body:0:200}"
    elif [[ -n "$body" ]]; then
      log_err "API health: unexpected response — ${body:0:120}"
    else
      log_err "API health: no response from http://127.0.0.1:3000/api/system/health"
    fi
    ok=0
  fi

  local css_code vendor_css redirect_code listen_443
  listen_443="$(ss -tln 2>/dev/null | awk '$4 ~ /:443$/ {found=1} END{print found+0}')"
  if [[ "$listen_443" == "1" ]]; then
    log_ok "Port 443: listening"
  else
    log_err "Port 443: not listening — HTTPS will timeout in browser"
    ok=0
  fi

  redirect_code="$(curl -sI --max-time 10 "http://${SERVER_IP}/login" 2>/dev/null | tr -d '\r' | awk 'toupper($1)=="HTTP/" && $2 ~ /^301|302$/ {print $2; exit}')"
  if [[ -n "$redirect_code" ]]; then
    log_ok "HTTP redirect: port 80 → HTTPS (${redirect_code})"
  else
    log_err "HTTP redirect: port 80 does not redirect to HTTPS"
    ok=0
  fi

  css_code="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "https://${SERVER_IP}/css/enterprise-theme.css" 2>/dev/null || echo '000')"
  if [[ "$css_code" == "200" ]]; then
    log_ok "HTTPS CSS: /css/enterprise-theme.css is served"
  else
    log_err "HTTPS CSS: /css/enterprise-theme.css returned HTTP ${css_code}"
    ok=0
  fi

  vendor_css="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "https://${SERVER_IP}/vendor/fontawesome/css/all.min.css" 2>/dev/null || echo '000')"
  if [[ "$vendor_css" == "200" ]]; then
    log_ok "HTTPS vendor: Font Awesome CSS is served"
  else
    log_err "HTTPS vendor: Font Awesome returned HTTP ${vendor_css}"
    ok=0
  fi

  local hsts_header
  hsts_header="$(curl -skI --max-time 10 "https://${SERVER_IP}/login" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="strict-transport-security"{print $2; exit}')"
  if [[ -n "$hsts_header" ]] && echo "$hsts_header" | grep -qi 'max-age=[1-9]'; then
    log_ok "HTTPS headers: HSTS enabled"
  else
    log_warn "HTTPS headers: HSTS not detected (non-fatal)"
  fi

  if [[ "$ok" -ne 1 ]]; then
    log_err "Verification failed — check logs: journalctl -u ${SERVICE_NAME} -n 40"
    step_complete
    return 1
  fi
  log_ok "Verification passed."
  step_complete
  return 0
}

# ─── Step 17: summary + credentials ───────────────────────────
write_install_info_file() {
  local installed_version
  installed_version="$(python3 -c 'import json; print(json.load(open("'"${INSTALL_DIR}/package.json"'", encoding="utf-8"))["version"])' 2>/dev/null || echo '?')"

  cat > "$INSTALL_INFO_FILE" <<EOF
═══════════════════════════════════════════════════════════════
  FoodMood install guide — no sensitive data
  Installed version: v${installed_version}
  Install date: $(date '+%Y-%m-%d %H:%M:%S %Z')
═══════════════════════════════════════════════════════════════

⚠  This file intentionally has no passwords, tokens, or keys.
   Secrets were shown once in the install terminal.
   Store them in your org password vault (off this server).

─── MongoDB (no password) ─────────────────────────────────────
  Username : ${MONGO_USER}
  Database : ${DB_NAME}
  Host     : 127.0.0.1:27017

─── Web access ────────────────────────────────────────────────
  App URL  : https://${SERVER_IP}

─── Server security ───────────────────────────────────────────
  UFW      : $( [[ "$ENABLE_FIREWALL" -eq 1 ]] && echo "enabled" || echo "disabled" )
  SSH port : ${SSH_PORT}
  Hardening: $( [[ "$ENABLE_HARDENING" -eq 1 ]] && echo "enabled (sysctl, fail2ban)" || echo "disabled" )

─── Paths (FHS / systemd) ─────────────────────────────────────
  Application : ${INSTALL_DIR}              (/opt — FHS)
  Runtime env : ${INSTALL_DIR}/.env         (600 — foodapp)
  System logs : /var/log/foodmood/          (/var/log — FHS)
  Text log    : /var/log/foodmood/system.log
  LDAP certs  : ${INSTALL_DIR}/certs/
  systemd unit: /etc/systemd/system/${SERVICE_NAME}.service
  Service user: ${APP_USER}
  MongoDB data: /var/lib/mongodb
  Full guide  : ${INSTALL_DIR}/docs/LINUX-DEPLOYMENT.md

─── LDAP (optional) ───────────────────────────────────────────
  CA certificate and Active Directory guide:
  ${INSTALL_DIR}/docs/LDAP-PRODUCTION.md

EOF

  chmod 644 "$INSTALL_INFO_FILE"
  chown root:root "$INSTALL_INFO_FILE"
  rm -f "${INSTALL_DIR}/CREDENTIALS.txt"
}

print_summary() {
  step_begin "Summary and credentials"
  write_install_info_file

  echo ""
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}${BOLD}  ✓ INSTALLATION COMPLETE — 100%${NC}"
  echo -e "  $(render_progress_bar 100)"
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${BOLD}─── دسترسی وب (Web access) ────────────────────────────────────${NC}"
  echo -e "  ${BOLD}Login:${NC}         https://${SERVER_IP}/login"
  echo -e "  ${BOLD}Admin panel:${NC}   https://${SERVER_IP}/admin/dashboard"
  echo ""
  echo -e "  ${YELLOW}[!]${NC} Self-signed certificate — browser shows ${BOLD}Not Secure${NC} until you upload a real certificate."
  echo -e "  ${YELLOW}[!]${NC} Accept the warning once: Advanced → Proceed to ${SERVER_IP}"
  echo -e "  ${YELLOW}[!]${NC} Real certificate: Superadmin → تنظیمات سامانه → گواهی SSL"
  echo -e "${YELLOW}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}${BOLD}  CREDENTIALS — shown ONCE. Save them off-server NOW.${NC}"
  echo -e "${YELLOW}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${BOLD}─── Superadmin login ──────────────────────────────────────────${NC}"
  echo "  Username : ${SUPERADMIN_USER}"
  echo "  Password : ${SUPERADMIN_PASS}"
  if [[ -n "$SUPERADMIN_CREDS_OUTPUT" ]]; then
    echo "$SUPERADMIN_CREDS_OUTPUT" | sed 's/^/  /'
  fi
  echo ""
  echo -e "${BOLD}─── MongoDB ───────────────────────────────────────────────────${NC}"
  echo "  Username : ${MONGO_USER}"
  echo "  Password : ${MONGO_PASS}"
  echo "  Database : ${DB_NAME}"
  echo "  Host     : 127.0.0.1:27017"
  echo ""
  if [[ "$ENABLE_FIREWALL" -eq 1 ]]; then
    echo -e "  ${BOLD}UFW firewall:${NC}  enabled — SSH(${SSH_PORT}), HTTP(80), HTTPS(443)"
  fi
  if [[ "$ENABLE_HARDENING" -eq 1 ]]; then
    echo -e "  ${BOLD}Hardening:${NC}     sysctl · fail2ban · auto-updates"
  fi
  echo ""
  echo -e "${BOLD}─── Encryption keys (.env backup) ─────────────────────────────${NC}"
  echo "  SESSION_SECRET  : ${SESSION_SECRET}"
  echo "  JWT_SECRET      : ${JWT_SECRET}"
  echo "  BACKUP_SECRET   : ${BACKUP_SECRET}"
  echo "  PASSWORD_PEPPER : ${PASSWORD_PEPPER}"
  echo "  ANNOUNCEMENT_ENCRYPTION_KEY : ${ANNOUNCEMENT_ENCRYPTION_KEY}"
  echo "  LDAP_ENCRYPTION_KEY         : ${LDAP_ENCRYPTION_KEY}"
  echo ""
  echo -e "${RED}${BOLD}  ⚠  Store these in your organization's password vault.${NC}"
  echo -e "${RED}${BOLD}     They are NOT saved anywhere on this server except .env.${NC}"
  echo ""
  echo -e "  ${BOLD}After install — only this command:${NC}"
  echo "    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash"
  echo ""
  echo -e "  ${BOLD}Useful commands:${NC}"
  echo "    sudo systemctl status foodmood"
  echo "    sudo journalctl -u foodmood -f"
  echo "    sudo bash ${INSTALL_DIR}/deploy/update.sh --diagnose"
  echo ""
  echo -e "  ${BOLD}Non-secret info file:${NC} ${INSTALL_INFO_FILE}"
  echo -e "  ${BOLD}Documentation:${NC}"
  echo "    ${INSTALL_DIR}/docs/LINUX-DEPLOYMENT.md  (paths + go-live checklist)"
  echo "    ${INSTALL_DIR}/docs/LDAP-PRODUCTION.md   (LDAP + CA certificate)"
  echo ""
  step_complete
}

# ─── Main ─────────────────────────────────────────────────────
main() {
  require_root
  show_banner
  show_roadmap

  # Resolve all values up-front — no interaction needed anywhere
  local mongo_pass_source="auto-generated"
  [[ -n "$MONGO_PASS" ]] && mongo_pass_source="provided"
  MONGO_USER="${MONGO_USER:-foodadmin}"
  MONGO_PASS="${MONGO_PASS:-$(rand_password)}"
  SUPERADMIN_USER="${SUPERADMIN_USER:-superadmin}"
  SUPERADMIN_PASS="${SUPERADMIN_PASS:-$(rand_password)@Fm9}"
  SERVER_IP="$(detect_server_ip)"
  detect_ssh_port

  log_info "MongoDB user: ${MONGO_USER} (password ${mongo_pass_source})"
  log_info "Superadmin: ${SUPERADMIN_USER}"
  log_info "App URL after install: https://${SERVER_IP}"
  echo ""
  show_progress
  echo -e "${DIM}  Estimated time: 10–15 minutes. Do not interrupt.${NC}"
  echo ""
  resolve_project_source
  install_base_packages
  apply_system_hardening
  install_nodejs
  install_mongodb
  install_chrome_for_pdf
  install_nginx_stack
  deploy_application
  setup_mongodb_auth
  write_env_file
  install_npm_deps
  setup_systemd
  setup_firewall
  configure_nginx
  create_superadmin_account
  if ! run_post_install_verify; then
    log_warn "Verification reported issues — showing credentials and URL anyway."
  fi
  print_summary
}

main "$@"
