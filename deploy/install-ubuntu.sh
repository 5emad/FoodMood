#!/usr/bin/env bash
# FoodMood automated installer for Ubuntu/Debian
# From project root:
#   sudo bash deploy/install-ubuntu.sh              # full interactive (English)
#   sudo bash deploy/install-ubuntu.sh --quick      # MongoDB only, then auto (default via bootstrap)
set -euo pipefail

QUICK_MODE=0
for arg in "$@"; do
  case "$arg" in
    --quick|-q) QUICK_MODE=1 ;;
  esac
done

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
APP_GROUP="foodapp"
DB_NAME="food_ordering"
SERVICE_NAME="foodmood"
NODE_MAJOR="20"
INSTALL_INFO_FILE="${INSTALL_DIR}/INSTALL_INFO.txt"
STEP_TOTAL=17
STEP_CURRENT=0
SSH_PORT=22
ENABLE_FIREWALL=1
ENABLE_HARDENING=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SUPERADMIN_CREDS_OUTPUT=""

# curl | bash feeds the script on stdin — read prompts from the real terminal
TTY_DEVICE="/dev/tty"
if [[ ! -r "$TTY_DEVICE" ]]; then
  TTY_DEVICE="/dev/stdin"
fi

require_interactive_tty() {
  if [[ ! -r /dev/tty ]]; then
    log_err "No interactive terminal detected."
    log_err "Download the script first, then run it:"
    log_err "  curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh -o /tmp/food-bootstrap.sh"
    log_err "  sudo bash /tmp/food-bootstrap.sh"
    exit 1
  fi
}

log_info()  { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()   { echo -e "${RED}[✗]${NC} $*" >&2; }

log_busy() {
  echo -e "${DIM}    ⏳ $*${NC}"
}

show_install_roadmap() {
  echo -e "${BOLD}Install plan (${STEP_TOTAL} steps):${NC}"
  local steps=(
    "Collect install inputs"
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
    "Summary and finish"
  )
  local i=1
  for s in "${steps[@]}"; do
    echo -e "  ${DIM}${i}.${NC} $s"
    i=$((i + 1))
  done
  echo ""
  if [[ "$QUICK_MODE" -eq 1 ]]; then
    echo -e "${CYAN}[*]${NC} ${BOLD}Quick mode${NC}: only MongoDB username and password are asked."
    echo -e "${CYAN}[*]${NC} Nginx on server IP, UFW, hardening, and superadmin — automatic."
    echo -e "${YELLOW}[!]${NC} If there is no output for several minutes, apt or npm is still running — ${BOLD}do not interrupt${NC}."
    echo ""
  fi
}

step_begin() {
  STEP_CURRENT=$((STEP_CURRENT + 1))
  echo ""
  echo -e "${MAGENTA}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${MAGENTA}${BOLD}  ▶ Step ${STEP_CURRENT}/${STEP_TOTAL}:${NC} ${BOLD}$*${NC}"
  echo -e "${MAGENTA}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

show_foodmood_banner() {
  clear 2>/dev/null || true
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
  echo -e "${DIM}              Automated install · Ubuntu / Debian${NC}"
  echo ""
}

detect_ssh_port() {
  local port=""
  if command -v sshd >/dev/null 2>&1; then
    port="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
  fi
  if [[ -z "$port" || ! "$port" =~ ^[0-9]+$ ]]; then
    port=22
  fi
  SSH_PORT="$port"
}

red_box() {
  echo ""
  echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
  while IFS= read -r line; do
    printf "${RED}${BOLD}║${NC} %-64s ${RED}${BOLD}║${NC}\n" "$line"
  done <<< "$1"
  echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

yellow_box() {
  echo ""
  echo -e "${YELLOW}${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
  while IFS= read -r line; do
    printf "${YELLOW}${BOLD}║${NC} %-64s ${YELLOW}${BOLD}║${NC}\n" "$line"
  done <<< "$1"
  echo -e "${YELLOW}${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

security_off_server_notice() {
  red_box $'SECURITY NOTICE:\n   • Store passwords and tokens in your org vault OFF this server.\n   • Never keep notes, screenshots, or password files on this host.\n   • Only .env exists on the server for runtime — do not copy secrets elsewhere on disk.'
}

prompt_off_server_ack() {
  local stage="$1"
  if [[ "$QUICK_MODE" -eq 1 ]]; then
    return 0
  fi
  security_off_server_notice
  local reply=""
  echo -e "${YELLOW}${BOLD}  ▶ Waiting for your confirmation — installer is not stuck.${NC}"
  echo -e "${DIM}    After saving credentials off-server, type yes and press Enter.${NC}"
  while true; do
    read -r -p "$(echo -e "${CYAN}${stage}${NC} — Confirm saved ${BOLD}off-server${NC}? (yes): ")" reply < "$TTY_DEVICE"
    case "${reply,,}" in
      y|yes|confirm) return 0 ;;
      *) log_warn "Type yes after saving credentials in your secure vault." ;;
    esac
  done
}

show_mongo_credentials_once() {
  yellow_box "$(printf '%s\n%s\n%s\n%s\n%s\n%s' \
    '  MongoDB credentials — shown once in this terminal' \
    '' \
    "  Username : ${MONGO_USER}" \
    "  Password : ${MONGO_PASS}" \
    "  Database : ${DB_NAME}" \
    '  Host     : 127.0.0.1:27017')"
  prompt_off_server_ack "Database credentials"
}

wipe_install_secrets_from_shell() {
  unset MONGO_PASS SUPERADMIN_PASS SUPERADMIN_CREDS_OUTPUT 2>/dev/null || true
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_err "Run as root: sudo bash deploy/install-ubuntu.sh"
    exit 1
  fi
}

detect_server_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
}

rand_secret() {
  openssl rand -base64 48 | tr -d '\n'
}

url_encode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote_plus(sys.argv[1]))' "$1"
}

prompt_yes_no() {
  local question="$1"
  local default="${2:-y}"
  local hint="y/n"
  local reply=""
  if [[ "$default" == "y" ]]; then hint="Y/n"; else hint="y/N"; fi
  while true; do
    read -r -p "$(echo -e "${CYAN}${question}${NC} [${hint}]: ")" reply < "$TTY_DEVICE"
    reply="${reply:-$default}"
    case "${reply,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) log_warn "Please enter y or n." ;;
    esac
  done
}

prompt_required() {
  local label="$1"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -p "$(echo -e "${CYAN}${label}:${NC} ")" value < "$TTY_DEVICE"
    value="$(echo "$value" | xargs)"
  done
  echo "$value"
}

prompt_password_once() {
  local label="$1"
  local pass=""
  while [[ -z "$pass" ]]; do
    read -r -s -p "$(echo -e "${CYAN}${label}:${NC} ")" pass < "$TTY_DEVICE"
    echo ""
    [[ -z "$pass" ]] && log_warn "Password cannot be empty."
  done
  echo "$pass"
}

prompt_password_twice() {
  local label="$1"
  local pass1="" pass2=""
  while true; do
    read -r -s -p "$(echo -e "${CYAN}${label}:${NC} ")" pass1 < "$TTY_DEVICE"
    echo ""
    read -r -s -p "$(echo -e "${CYAN}Repeat ${label}:${NC} ")" pass2 < "$TTY_DEVICE"
    echo ""
    if [[ -z "$pass1" ]]; then
      log_warn "Password cannot be empty."
      continue
    fi
    if [[ "$pass1" != "$pass2" ]]; then
      log_warn "Passwords do not match. Try again."
      continue
    fi
    echo "$pass1"
    return 0
  done
}

validate_superadmin_password() {
  local pw="$1"
  [[ ${#pw} -ge 12 ]] \
    && [[ "$pw" =~ [A-Za-z] ]] \
    && [[ "$pw" =~ [0-9] ]] \
    && [[ "$pw" =~ [^A-Za-z0-9] ]]
}

collect_ssl_certificate_options() {
  echo ""
  echo -e "${BOLD}SSL certificate type:${NC}"
  echo "  1) Let's Encrypt (automatic — domain must point to this server)"
  echo "  2) Custom certificate (fullchain and privkey file paths)"
  local cert_choice=""
  while [[ ! "$cert_choice" =~ ^[12]$ ]]; do
    read -r -p "$(echo -e "${CYAN}Choose [1/2]:${NC} ")" cert_choice < "$TTY_DEVICE"
  done
  if [[ "$cert_choice" == "1" ]]; then
    CERT_MODE="letsencrypt"
    LE_EMAIL="$(prompt_required "Email for Let's Encrypt")"
  else
    CERT_MODE="custom"
    SSL_FULLCHAIN="$(prompt_required "fullchain path (e.g. /etc/ssl/certs/fullchain.pem)")"
    SSL_PRIVKEY="$(prompt_required "privkey path (e.g. /etc/ssl/private/privkey.pem)")"
    if [[ ! -f "$SSL_FULLCHAIN" || ! -f "$SSL_PRIVKEY" ]]; then
      log_err "Certificate files not found. Check paths."
      exit 1
    fi
    log_ok "Certificate files verified."
  fi
}

collect_web_ssl_options() {
  USE_NGINX=1
  if prompt_yes_no "Use domain name with HTTPS? (instead of IP)" "n"; then
    USE_DOMAIN=1
    APP_DOMAIN="$(prompt_required "Domain name (e.g. food.company.com)")"
    collect_ssl_certificate_options
    log_info "App URL: https://${APP_DOMAIN}"
  else
    USE_DOMAIN=0
    SERVER_IP="$(detect_server_ip)"
    log_info "App URL: http://${SERVER_IP}"
  fi
}

collect_inputs() {
  require_interactive_tty

  if [[ "$QUICK_MODE" -eq 1 ]]; then
    log_info "Quick install — enter MongoDB credentials, then all steps run automatically."
    echo -e "${YELLOW}${BOLD}  ▶ Waiting for your input — type below and press Enter.${NC}"
    echo ""
    MONGO_USER="$(prompt_required "MongoDB username")"
    MONGO_PASS="$(prompt_password_once "MongoDB password")"
    detect_ssh_port
    CREATE_SUPERADMIN=1
    SUPERADMIN_USER="superadmin"
    SUPERADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-14)@Fm9"
    USE_NGINX=1
    USE_DOMAIN=0
    SERVER_IP="$(detect_server_ip)"
    ENABLE_FIREWALL=1
    ENABLE_HARDENING=1
    log_ok "Inputs collected. Continuing automatically — Nginx http://${SERVER_IP}, UFW, hardening, superadmin ${SUPERADMIN_USER}"
    return
  fi

  red_box $'IMPORTANT:\n   Store database and app secrets in your org password vault OFF this server.\n   Without them, recovery may be impossible.\n   No password file is written on disk — only this terminal shows secrets once.'

  MONGO_USER="$(prompt_required "MongoDB username")"
  MONGO_PASS="$(prompt_password_twice "MongoDB password")"

  show_mongo_credentials_once

  detect_ssh_port
  log_info "Detected SSH port: ${SSH_PORT}"

  if prompt_yes_no "Install and configure Nginx reverse proxy?" "y"; then
    collect_web_ssl_options
  else
    USE_NGINX=0
    USE_DOMAIN=0
    SERVER_IP="$(detect_server_ip)"
    log_info "App will listen directly on port 3000: http://${SERVER_IP}:3000"
  fi

  if prompt_yes_no "Enable UFW firewall (only required ports)?" "y"; then
    ENABLE_FIREWALL=1
  else
    ENABLE_FIREWALL=0
    log_warn "Firewall left disabled — enable UFW later for production."
  fi

  if prompt_yes_no "Apply Linux hardening (sysctl, fail2ban, auto-updates)?" "y"; then
    ENABLE_HARDENING=1
  else
    ENABLE_HARDENING=0
  fi

  if prompt_yes_no "Create initial superadmin account?" "y"; then
    CREATE_SUPERADMIN=1
    SUPERADMIN_USER="$(prompt_required "Superadmin username")"
    while true; do
      SUPERADMIN_PASS="$(prompt_password_twice "Superadmin password (min 12 chars, letter+digit+symbol)")"
      if validate_superadmin_password "$SUPERADMIN_PASS"; then
        break
      fi
      log_warn "Weak password. Use at least 12 characters with letters, digits, and symbols."
    done
  else
    CREATE_SUPERADMIN=0
  fi
}

install_base_packages() {
  step_begin "Install base packages"
  log_busy "Updating apt repositories — usually 1-3 minutes"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  log_busy "Installing base packages — watch apt output; please wait"
  apt-get install -y \
    curl gnupg ca-certificates lsb-release apt-transport-https \
    software-properties-common rsync openssl python3 ufw fail2ban \
    unattended-upgrades apt-listchanges \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils
  log_ok "Base packages installed."
}

apply_system_hardening() {
  if [[ "$ENABLE_HARDENING" -ne 1 ]]; then
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
  sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/99-foodmood-hardening.conf >/dev/null 2>&1 || true

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
  if systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet sshd 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  fi

  log_info "Enabling fail2ban for SSH..."
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
}

setup_firewall() {
  if [[ "$ENABLE_FIREWALL" -ne 1 ]]; then
    return
  fi
  step_begin "Configure UFW firewall"
  detect_ssh_port

  log_info "Allowing SSH port (${SSH_PORT}/tcp) before enabling firewall..."
  ufw --force reset >/dev/null 2>&1 || true
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "${SSH_PORT}/tcp" comment 'SSH'

  if [[ "$USE_NGINX" -eq 1 ]]; then
    ufw allow 80/tcp comment 'HTTP / Nginx'
    if [[ "${USE_DOMAIN:-0}" -eq 1 ]]; then
      ufw allow 443/tcp comment 'HTTPS / Nginx'
    fi
  else
    ufw allow 3000/tcp comment 'FoodMood direct'
  fi

  ufw logging medium
  ufw --force enable
  log_ok "UFW enabled — allowed: SSH(${SSH_PORT})$( [[ "$USE_NGINX" -eq 1 ]] && echo -n ', 80' )$( [[ "${USE_DOMAIN:-0}" -eq 1 ]] && echo -n ', 443' )$( [[ "$USE_NGINX" -ne 1 ]] && echo -n ', 3000' )."
}

install_nodejs() {
  step_begin "Install Node.js"
  if command -v node >/dev/null 2>&1; then
    local ver
    ver="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$ver" -ge "$NODE_MAJOR" ]]; then
      log_ok "Node.js $(node -v) already installed."
      return
    fi
  fi
  log_info "Installing Node.js ${NODE_MAJOR}.x..."
  log_busy "Downloading NodeSource repo — 1-2 minutes"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
  log_ok "Node.js $(node -v) installed."
}

install_mongodb() {
  step_begin "Install MongoDB"
  if command -v mongod >/dev/null 2>&1; then
    log_ok "MongoDB already installed."
    return
  fi
  log_info "Installing MongoDB 7.0..."
  log_busy "Adding MongoDB repository — 2-5 minutes"
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
    | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
  local codename distro
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-$UBUNTU_CODENAME}")"
  if grep -qi '^ID=ubuntu' /etc/os-release 2>/dev/null; then
    distro="ubuntu"
  else
    distro="debian"
  fi
  echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/${distro} ${codename}/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update
  apt-get install -y mongodb-org
  systemctl enable mongod
  systemctl start mongod
  log_ok "MongoDB installed and started."
}

install_chrome_for_pdf() {
  step_begin "Install PDF browser"
  if apt-get install -y -qq chromium-browser 2>/dev/null \
    || apt-get install -y -qq chromium 2>/dev/null; then
    log_ok "Chromium installed."
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
}

install_nginx_stack() {
  if [[ "$USE_NGINX" -ne 1 ]]; then
    return
  fi
  step_begin "Install Nginx"
  apt-get install -y -qq nginx
  if [[ "$USE_DOMAIN" -eq 1 && "$CERT_MODE" == "letsencrypt" ]]; then
    apt-get install -y -qq certbot python3-certbot-nginx
  fi
  systemctl enable nginx
  log_ok "Nginx installed."
}

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
  chmod +x "${INSTALL_DIR}/deploy/"*.sh 2>/dev/null || true
  log_ok "Application deployed to ${INSTALL_DIR}."
}

setup_mongodb_auth() {
  step_begin "Configure MongoDB security"
  systemctl start mongod
  sleep 2

  if ! mongosh --quiet --eval "db.runCommand({ ping: 1 })" &>/dev/null; then
    log_err "Cannot connect to MongoDB."
    exit 1
  fi

  local user_exists
  user_exists="$(mongosh --quiet "$DB_NAME" --eval "db.getUser('${MONGO_USER}') ? 'yes' : 'no'" 2>/dev/null || echo "no")"

  if [[ "$user_exists" != "yes" ]]; then
    local tmp_js
    tmp_js="$(mktemp)"
    python3 - "$tmp_js" "$MONGO_USER" "$MONGO_PASS" "$DB_NAME" <<'PY'
import json, sys
path, user, pwd, db = sys.argv[1:5]
body = f"""db.createUser({{
  user: {json.dumps(user)},
  pwd: {json.dumps(pwd)},
  roles: [{{ role: 'readWrite', db: {json.dumps(db)} }}]
}});"""
open(path, 'w', encoding='utf-8').write(body)
PY
    mongosh --quiet "$DB_NAME" --file "$tmp_js"
    rm -f "$tmp_js"
    log_ok "Database user '${MONGO_USER}' created."
  else
    log_warn "User '${MONGO_USER}' already exists — password not changed."
  fi

  local mongod_conf="/etc/mongod.conf"
  if ! grep -q 'authorization: enabled' "$mongod_conf" 2>/dev/null; then
    if grep -q '^security:' "$mongod_conf"; then
      sed -i '/^security:/a\  authorization: enabled' "$mongod_conf"
    else
      printf '\nsecurity:\n  authorization: enabled\n' >> "$mongod_conf"
    fi
    systemctl restart mongod
    sleep 2
    log_ok "MongoDB authentication enabled."
  else
    log_ok "MongoDB authentication already enabled."
  fi
}

write_env_file() {
  step_begin "Create environment file (.env)"
  local encoded_pass app_url allowed_origins mongo_uri

  encoded_pass="$(url_encode "$MONGO_PASS")"
  mongo_uri="mongodb://${MONGO_USER}:${encoded_pass}@127.0.0.1:27017/${DB_NAME}?authSource=${DB_NAME}"

  if [[ "$USE_DOMAIN" -eq 1 ]]; then
    app_url="https://${APP_DOMAIN}"
    allowed_origins="https://${APP_DOMAIN}"
  elif [[ "$USE_NGINX" -eq 1 ]]; then
    SERVER_IP="${SERVER_IP:-$(detect_server_ip)}"
    app_url="http://${SERVER_IP}"
    allowed_origins="http://${SERVER_IP}"
  else
    SERVER_IP="${SERVER_IP:-$(detect_server_ip)}"
    app_url="http://${SERVER_IP}:3000"
    allowed_origins="http://${SERVER_IP}:3000"
  fi

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
ALLOWED_ORIGINS=${allowed_origins}

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
}

write_install_info_file() {
  local access_url installed_version
  installed_version="$(python3 -c 'import json; print(json.load(open("'"${INSTALL_DIR}/package.json"'", encoding="utf-8"))["version"])' 2>/dev/null || echo '?')"
  if [[ "$USE_DOMAIN" -eq 1 ]]; then
    access_url="https://${APP_DOMAIN}"
  elif [[ "$USE_NGINX" -eq 1 ]]; then
    access_url="http://${SERVER_IP:-$(detect_server_ip)}"
  else
    access_url="http://${SERVER_IP:-$(detect_server_ip)}:3000"
  fi

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
  App URL  : ${access_url}
$( [[ "${USE_DOMAIN:-0}" -eq 1 ]] && echo "  Domain   : ${APP_DOMAIN}" )
$( [[ "${USE_DOMAIN:-0}" -eq 1 && -n "${CERT_MODE:-}" ]] && echo "  SSL type : ${CERT_MODE}" )

─── Server security ───────────────────────────────────────────
  UFW      : $( [[ "${ENABLE_FIREWALL:-0}" -eq 1 ]] && echo "enabled" || echo "disabled" )
  SSH port : ${SSH_PORT}
  Hardening: $( [[ "${ENABLE_HARDENING:-0}" -eq 1 ]] && echo "enabled (sysctl, fail2ban)" || echo "disabled" )

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
  Verify      : sudo bash ${INSTALL_DIR}/deploy/verify-install.sh

─── LDAP (optional) ───────────────────────────────────────────
  CA certificate and Active Directory guide:
  ${INSTALL_DIR}/docs/LDAP-PRODUCTION.md

EOF

  chmod 644 "$INSTALL_INFO_FILE"
  chown root:root "$INSTALL_INFO_FILE"
  # Remove legacy file — we no longer keep passwords on disk
  rm -f "${INSTALL_DIR}/CREDENTIALS.txt"
}

reveal_final_secrets_once() {
  local access_url session_secret jwt_secret backup_secret pepper announcement_key ldap_enc_key
  if [[ "$USE_DOMAIN" -eq 1 ]]; then
    access_url="https://${APP_DOMAIN}"
  elif [[ "$USE_NGINX" -eq 1 ]]; then
    access_url="http://${SERVER_IP:-$(detect_server_ip)}"
  else
    access_url="http://${SERVER_IP:-$(detect_server_ip)}:3000"
  fi

  session_secret="$(grep '^SESSION_SECRET=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"
  jwt_secret="$(grep '^JWT_SECRET=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"
  backup_secret="$(grep '^BACKUP_SECRET=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"
  pepper="$(grep '^PASSWORD_PEPPER=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"
  announcement_key="$(grep '^ANNOUNCEMENT_ENCRYPTION_KEY=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"
  ldap_enc_key="$(grep '^LDAP_ENCRYPTION_KEY=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"

  echo ""
  echo -e "${YELLOW}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}${BOLD}  Sensitive credentials — shown once in this terminal${NC}"
  echo -e "${YELLOW}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${BOLD}─── MongoDB ───────────────────────────────────────────────────${NC}"
  echo "  Username : ${MONGO_USER}"
  echo "  Password : ${MONGO_PASS}"
  echo "  Database : ${DB_NAME}"
  echo ""
  echo -e "${BOLD}─── Web access ────────────────────────────────────────────────${NC}"
  echo "  App URL  : ${access_url}"
  echo ""
  echo -e "${BOLD}─── Encryption keys (.env) ────────────────────────────────────${NC}"
  echo "  SESSION_SECRET  : ${session_secret}"
  echo "  JWT_SECRET      : ${jwt_secret}"
  echo "  BACKUP_SECRET   : ${backup_secret}"
  echo "  PASSWORD_PEPPER : ${pepper}"
  echo "  ANNOUNCEMENT_ENCRYPTION_KEY : ${announcement_key}"
  echo "  LDAP_ENCRYPTION_KEY          : ${ldap_enc_key}"
  echo ""

  if [[ "$CREATE_SUPERADMIN" -eq 1 ]]; then
    echo -e "${BOLD}─── Superadmin ────────────────────────────────────────────────${NC}"
    if [[ -n "$SUPERADMIN_CREDS_OUTPUT" ]]; then
      echo "$SUPERADMIN_CREDS_OUTPUT"
    else
      echo "  (Superadmin was not created or already exists)"
    fi
    echo ""
  fi

  if [[ "$QUICK_MODE" -eq 1 ]]; then
    security_off_server_notice
    echo -e "${DIM}    Save the above off-server, then press Enter to finish.${NC}"
    read -r -p "" < "$TTY_DEVICE"
    wipe_install_secrets_from_shell
    log_ok "Install secrets cleared from installer memory."
    return
  fi

  prompt_off_server_ack "Final install credentials"
  wipe_install_secrets_from_shell
  log_ok "Off-server storage confirmed. Secrets cleared from installer memory."
}

install_npm_deps() {
  step_begin "Install Node.js dependencies"
  mkdir -p "${INSTALL_DIR}/certs"
  chown "$APP_USER:$APP_GROUP" "${INSTALL_DIR}/certs"
  chmod 750 "${INSTALL_DIR}/certs"
  log_busy "npm install --omit=dev — usually 2-8 minutes; please wait"
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev --progress=true"
  log_ok "npm install completed."
}

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
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    log_ok "Service ${SERVICE_NAME} is active — starts automatically on boot."
  else
    log_err "Service failed to start. Log: journalctl -u ${SERVICE_NAME} -n 30"
    exit 1
  fi
}

configure_nginx_http() {
  local server_ip="${SERVER_IP:-$(detect_server_ip)}"
  cat > /etc/nginx/sites-available/food <<'NGINX_HTTP'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
NGINX_HTTP

  ln -sf /etc/nginx/sites-available/food /etc/nginx/sites-enabled/food
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  SERVER_IP="$server_ip"
  log_ok "Nginx configured on http://${server_ip}."
}

configure_nginx_https_custom() {
  local ssl_dir="/etc/ssl/food"
  mkdir -p "$ssl_dir"
  cp "$SSL_FULLCHAIN" "${ssl_dir}/fullchain.pem"
  cp "$SSL_PRIVKEY" "${ssl_dir}/privkey.pem"
  chmod 600 "${ssl_dir}/privkey.pem"

  cat > /etc/nginx/sites-available/food <<NGINX_CUSTOM
server {
    listen 80;
    listen [::]:80;
    server_name ${APP_DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${APP_DOMAIN};

    ssl_certificate ${ssl_dir}/fullchain.pem;
    ssl_certificate_key ${ssl_dir}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX_CUSTOM

  ln -sf /etc/nginx/sites-available/food /etc/nginx/sites-enabled/food
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  log_ok "Nginx configured with custom certificate on https://${APP_DOMAIN}."
}

configure_nginx_https_letsencrypt() {
  cat > /etc/nginx/sites-available/food <<NGINX_LE
server {
    listen 80;
    listen [::]:80;
    server_name ${APP_DOMAIN};

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX_LE

  ln -sf /etc/nginx/sites-available/food /etc/nginx/sites-enabled/food
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx

  log_info "Requesting Let's Encrypt certificate for ${APP_DOMAIN}..."
  certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL" --redirect
  log_ok "HTTPS enabled with Let's Encrypt: https://${APP_DOMAIN}"
}

configure_nginx() {
  if [[ "$USE_NGINX" -ne 1 ]]; then
    return
  fi
  step_begin "Configure Nginx"

  if [[ "$USE_DOMAIN" -eq 1 ]]; then
    if [[ "$CERT_MODE" == "letsencrypt" ]]; then
      configure_nginx_https_letsencrypt
    else
      configure_nginx_https_custom
    fi
  else
    configure_nginx_http
  fi
}

create_superadmin_account() {
  if [[ "$CREATE_SUPERADMIN" -ne 1 ]]; then
    return
  fi
  step_begin "Create superadmin account"
  local output
  output="$(sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node scripts/super-admin.js create $(printf '%q' "$SUPERADMIN_USER") $(printf '%q' "$SUPERADMIN_PASS")" 2>&1)" || {
    log_warn "Superadmin creation failed (may already exist):"
    echo "$output"
    return
  }
  SUPERADMIN_CREDS_OUTPUT="$output"
  log_ok "Superadmin '${SUPERADMIN_USER}' created — login shown once at end of install."
}

run_post_install_verify() {
  step_begin "Post-install verification (verify-install)"
  if [[ -f "${INSTALL_DIR}/deploy/verify-install.sh" ]]; then
    bash "${INSTALL_DIR}/deploy/verify-install.sh" --from-install || {
      log_err "Verification failed — fix issues before go-live."
      exit 1
    }
  else
    log_warn "verify-install.sh not found — automatic check skipped."
  fi
}

print_summary() {
  local access_url fw_ports
  if [[ "$USE_DOMAIN" -eq 1 ]]; then
    access_url="https://${APP_DOMAIN}"
  elif [[ "$USE_NGINX" -eq 1 ]]; then
    access_url="http://${SERVER_IP:-$(detect_server_ip)}"
  else
    access_url="http://${SERVER_IP:-$(detect_server_ip)}:3000"
  fi

  fw_ports="SSH:${SSH_PORT}"
  if [[ "$USE_NGINX" -eq 1 ]]; then
    fw_ports+=", HTTP:80"
    [[ "${USE_DOMAIN:-0}" -eq 1 ]] && fw_ports+=", HTTPS:443"
  else
    fw_ports+=", App:3000"
  fi

  echo ""
  show_foodmood_banner
  echo -e "${GREEN}${BOLD}  ✓ FoodMood installed successfully${NC}"
  echo ""
  echo -e "  ${BOLD}App URL:${NC}       ${access_url}/login"
  echo -e "  ${BOLD}Admin panel:${NC}   ${access_url}/admin/dashboard"
  if [[ "$ENABLE_FIREWALL" -eq 1 ]]; then
    echo -e "  ${BOLD}UFW firewall:${NC}  enabled — allowed ports: ${fw_ports}"
  fi
  if [[ "$ENABLE_HARDENING" -eq 1 ]]; then
    echo -e "  ${BOLD}Hardening:${NC}     sysctl · fail2ban · auto-updates"
  fi
  echo ""
  if [[ "$QUICK_MODE" -eq 1 ]]; then
    red_box $'✓  Install complete.\n   Sensitive data was shown once in this terminal.\n\n   Non-secret guide: /opt/food/INSTALL_INFO.txt\n   (URLs and paths only — no passwords or tokens)'
  else
    red_box $'✓  Install complete.\n   Sensitive data was shown once in this terminal\n   and off-server storage was confirmed.\n\n   Non-secret guide: /opt/food/INSTALL_INFO.txt\n   (URLs and paths only — no passwords or tokens)'
  fi
  echo -e "  ${BOLD}Useful commands:${NC}"
  echo "    sudo systemctl status foodmood"
  echo "    sudo journalctl -u foodmood -f"
  echo "    sudo tail -f /var/log/foodmood/system.log"
  echo "    sudo systemctl restart foodmood"
  echo "    sudo bash ${INSTALL_DIR}/deploy/verify-install.sh"
  echo ""
  echo -e "  ${BOLD}Documentation:${NC}"
  echo "    ${INSTALL_DIR}/docs/LINUX-DEPLOYMENT.md  (paths + go-live checklist)"
  echo "    ${INSTALL_DIR}/docs/LDAP-PRODUCTION.md   (LDAP + CA certificate)"
  echo ""
}

main() {
  require_root
  show_foodmood_banner
  show_install_roadmap
  step_begin "Collect install inputs"
  collect_inputs
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
  configure_nginx
  setup_firewall
  create_superadmin_account
  write_install_info_file
  reveal_final_secrets_once
  run_post_install_verify
  step_begin "Summary and finish"
  print_summary
}

main "$@"
