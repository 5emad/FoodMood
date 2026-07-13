#!/usr/bin/env bash
# نصب خودکار سامانه تغذیه روی Ubuntu/Debian
# اجرا از ریشه پروژه:
#   sudo bash deploy/install-ubuntu.sh            ← نصب تعاملی کامل
#   sudo bash deploy/install-ubuntu.sh --quick    ← فقط MongoDB؛ بقیه خودکار + نمایش ۱۷ مرحله
set -euo pipefail

QUICK_MODE=0
for arg in "$@"; do
  case "$arg" in
    --quick|-q) QUICK_MODE=1 ;;
  esac
done

# ─── رنگ‌ها ───────────────────────────────────────────────────────────────────
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

log_info()  { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()   { echo -e "${RED}[✗]${NC} $*" >&2; }

log_busy() {
  echo -e "${DIM}    ⏳ $*${NC}"
}

show_install_roadmap() {
  echo -e "${BOLD}نقشه نصب (${STEP_TOTAL} مرحله):${NC}"
  local steps=(
    "دریافت اطلاعات نصب"
    "نصب بسته‌های پایه"
    "هاردنینگ پایه لینوکس"
    "نصب Node.js"
    "نصب MongoDB"
    "نصب مرورگر PDF"
    "نصب Nginx"
    "استقرار سامانه FoodMood"
    "پیکربندی امنیت MongoDB"
    "ساخت تنظیمات محیط (.env)"
    "نصب وابستگی‌های Node.js"
    "فعال‌سازی سرویس systemd"
    "پیکربندی Nginx"
    "پیکربندی فایروال UFW"
    "ساخت سوپرادمین"
    "بررسی نهایی (verify-install)"
    "خلاصه و پایان نصب"
  )
  local i=1
  for s in "${steps[@]}"; do
    echo -e "  ${DIM}${i}.${NC} $s"
    i=$((i + 1))
  done
  echo ""
  if [[ "$QUICK_MODE" -eq 1 ]]; then
    echo -e "${CYAN}[*]${NC} حالت ${BOLD}سریع${NC}: فقط نام کاربری و رمز MongoDB پرسیده می‌شود."
    echo -e "${CYAN}[*]${NC} Nginx روی IP سرور، UFW، هاردنینگ و سوپرادمین — خودکار."
    echo -e "${YELLOW}[!]${NC} اگر چند دقیقه خروجی ندید، احتمالاً apt یا npm در حال اجراست — ${BOLD}قطع نکنید${NC}."
    echo ""
  fi
}

step_begin() {
  STEP_CURRENT=$((STEP_CURRENT + 1))
  echo ""
  echo -e "${MAGENTA}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${MAGENTA}${BOLD}  ▶ مرحله ${STEP_CURRENT}/${STEP_TOTAL}:${NC} ${BOLD}$*${NC}"
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
  echo -e "${CYAN}${BOLD}           سامانه سفارش و رزرو غذای سازمانی${NC}"
  echo -e "${DIM}              نصب خودکار · Ubuntu / Debian${NC}"
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
  red_box $'⚠  نکته امنیتی مهم:\n   • رمزها و توکن‌ها را فقط در خزانه رمز سازمانی (خارج از سرور) نگه دارید.\n   • هرگز روی همین سرور فایل یادداشت، اسکرین‌شات یا متن رمز نگه ندارید.\n   • این سرور فقط فایل .env برای اجرای سامانه دارد — کپی دستی رمزها مجاز نیست.'
}

prompt_off_server_ack() {
  local stage="$1"
  security_off_server_notice
  local reply=""
  echo -e "${YELLOW}${BOLD}  ▶ اسکریپت منتظر تأیید شماست — گیر نکرده است.${NC}"
  echo -e "${DIM}    پس از یادداشت رمزها در خزانه امن، «بله» یا «yes» بزنید و Enter.${NC}"
  while true; do
    read -r -p "$(echo -e "${CYAN}${stage}${NC} — تأیید می‌کنید اطلاعات را ${BOLD}خارج از سرور${NC} ذخیره کردید؟ (بله/yes): ")" reply
    case "${reply,,}" in
      y|yes|بله|تایید|confirm) return 0 ;;
      *) log_warn "پس از یادداشت در خزانه امن خارج از سرور، «بله» یا «yes» وارد کنید." ;;
    esac
  done
}

show_mongo_credentials_once() {
  yellow_box "$(printf '%s\n%s\n%s\n%s\n%s\n%s' \
    '  اطلاعات دیتابیس MongoDB — فقط یک‌بار در همین ترمینال' \
    '' \
    "  نام کاربری : ${MONGO_USER}" \
    "  رمز عبور   : ${MONGO_PASS}" \
    "  پایگاه داده: ${DB_NAME}" \
    '  آدرس       : 127.0.0.1:27017')"
  prompt_off_server_ack "اطلاعات دیتابیس"
}

wipe_install_secrets_from_shell() {
  unset MONGO_PASS SUPERADMIN_PASS SUPERADMIN_CREDS_OUTPUT 2>/dev/null || true
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_err "این اسکریپت باید با root اجرا شود: sudo bash deploy/install-ubuntu.sh"
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
    read -r -p "$(echo -e "${CYAN}${question}${NC} [${hint}]: ")" reply
    reply="${reply:-$default}"
    case "${reply,,}" in
      y|yes|بله) return 0 ;;
      n|no|خیر) return 1 ;;
      *) log_warn "لطفاً y یا n وارد کنید." ;;
    esac
  done
}

prompt_required() {
  local label="$1"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -p "$(echo -e "${CYAN}${label}:${NC} ")" value
    value="$(echo "$value" | xargs)"
  done
  echo "$value"
}

prompt_password_twice() {
  local label="$1"
  local pass1="" pass2=""
  while true; do
    read -r -s -p "$(echo -e "${CYAN}${label}:${NC} ")" pass1
    echo ""
    read -r -s -p "$(echo -e "${CYAN}تکرار ${label}:${NC} ")" pass2
    echo ""
    if [[ -z "$pass1" ]]; then
      log_warn "رمز نمی‌تواند خالی باشد."
      continue
    fi
    if [[ "$pass1" != "$pass2" ]]; then
      log_warn "رمزها یکسان نیستند. دوباره تلاش کنید."
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
  echo -e "${BOLD}نوع گواهی SSL:${NC}"
  echo "  1) Let's Encrypt (خودکار — دامنه باید به IP سرور اشاره کند)"
  echo "  2) گواهی اختصاصی (مسیر فایل fullchain و privkey)"
  local cert_choice=""
  while [[ ! "$cert_choice" =~ ^[12]$ ]]; do
    read -r -p "$(echo -e "${CYAN}انتخاب [1/2]:${NC} ")" cert_choice
  done
  if [[ "$cert_choice" == "1" ]]; then
    CERT_MODE="letsencrypt"
    LE_EMAIL="$(prompt_required "ایمیل برای Let's Encrypt")"
  else
    CERT_MODE="custom"
    SSL_FULLCHAIN="$(prompt_required "مسیر فایل fullchain (مثال: /etc/ssl/certs/fullchain.pem)")"
    SSL_PRIVKEY="$(prompt_required "مسیر فایل privkey (مثال: /etc/ssl/private/privkey.pem)")"
    if [[ ! -f "$SSL_FULLCHAIN" || ! -f "$SSL_PRIVKEY" ]]; then
      log_err "فایل‌های گواهی پیدا نشدند. مسیرها را بررسی کنید."
      exit 1
    fi
    log_ok "فایل‌های گواهی تأیید شدند."
  fi
}

collect_web_ssl_options() {
  USE_NGINX=1
  if prompt_yes_no "دسترسی با دامنه و HTTPS فعال شود؟ (به‌جای IP)" "n"; then
    USE_DOMAIN=1
    APP_DOMAIN="$(prompt_required "نام دامنه (مثال: food.company.ir)")"
    collect_ssl_certificate_options
    log_info "دسترسی نهایی: https://${APP_DOMAIN}"
  else
    USE_DOMAIN=0
    SERVER_IP="$(detect_server_ip)"
    log_info "دسترسی از طریق IP: http://${SERVER_IP}"
  fi
}

collect_inputs() {
  red_box $'⚠  هشدار مهم:\n   اطلاعات دیتابیس و رمزهای سامانه را حتماً در خزانه رمز\n   سازمانی (خارج از این سرور) نگه دارید.\n   بدون این اطلاعات، بازیابی و دسترسی ممکن است غیرممکن شود.\n   هیچ فایل رمز روی سرور ساخته نمی‌شود — فقط همین ترمینال.'

  MONGO_USER="$(prompt_required "نام کاربری دیتابیس MongoDB")"
  MONGO_PASS="$(prompt_password_twice "رمز عبور دیتابیس MongoDB")"

  show_mongo_credentials_once

  detect_ssh_port
  log_info "پورت SSH شناسایی‌شده: ${SSH_PORT}"

  # ── حالت سریع: بدون سوال SSL/دامنه — همه پیش‌فرض خودکار ────────────────
  if [[ "$QUICK_MODE" -eq 1 ]]; then
    CREATE_SUPERADMIN=1
    SUPERADMIN_USER="superadmin"
    SUPERADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-14)@Fm9"
    USE_NGINX=1
    USE_DOMAIN=0
    SERVER_IP="$(detect_server_ip)"
    ENABLE_FIREWALL=1
    ENABLE_HARDENING=1
    log_ok "حالت سریع: Nginx روی http://${SERVER_IP} · UFW · هاردنینگ · سوپرادمین ${SUPERADMIN_USER}"
    return
  fi

  if prompt_yes_no "Nginx به‌عنوان پروکسی معکوس نصب و پیکربندی شود؟" "y"; then
    collect_web_ssl_options
  else
    USE_NGINX=0
    USE_DOMAIN=0
    SERVER_IP="$(detect_server_ip)"
    log_info "سامانه مستقیم روی پورت 3000: http://${SERVER_IP}:3000"
  fi

  if prompt_yes_no "فایروال UFW فعال شود و فقط پورت‌های لازم باز باشند؟" "y"; then
    ENABLE_FIREWALL=1
  else
    ENABLE_FIREWALL=0
    log_warn "فایروال غیرفعال ماند — توصیه امنیتی: UFW را بعداً فعال کنید."
  fi

  if prompt_yes_no "هاردنینگ پایه لینوکس (sysctl، fail2ban، به‌روزرسانی خودکار) اعمال شود؟" "y"; then
    ENABLE_HARDENING=1
  else
    ENABLE_HARDENING=0
  fi

  if prompt_yes_no "سوپرادمین اولیه ساخته شود؟" "y"; then
    CREATE_SUPERADMIN=1
    SUPERADMIN_USER="$(prompt_required "نام کاربری سوپرادمین")"
    while true; do
      SUPERADMIN_PASS="$(prompt_password_twice "رمز سوپرادمین (حداقل ۱۲ کاراکتر، حرف+عدد+نماد)")"
      if validate_superadmin_password "$SUPERADMIN_PASS"; then
        break
      fi
      log_warn "رمز ضعیف است. حداقل ۱۲ کاراکتر با حرف، عدد و نماد لازم است."
    done
  else
    CREATE_SUPERADMIN=0
  fi
}

install_base_packages() {
  step_begin "نصب بسته‌های پایه"
  log_busy "به‌روزرسانی مخازن apt — معمولاً ۱ تا ۳ دقیقه"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  log_busy "نصب بسته‌های پایه — خروجی apt را ببینید؛ صبر کنید"
  apt-get install -y \
    curl gnupg ca-certificates lsb-release apt-transport-https \
    software-properties-common rsync openssl python3 ufw fail2ban \
    unattended-upgrades apt-listchanges \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils
  log_ok "بسته‌های پایه نصب شدند."
}

apply_system_hardening() {
  if [[ "$ENABLE_HARDENING" -ne 1 ]]; then
    return
  fi
  step_begin "هاردنینگ پایه لینوکس"
  log_info "اعمال تنظیمات امنیتی هسته (sysctl)..."

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

  log_info "تقویت SSH (بدون قطع دسترسی فعلی)..."
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

  log_info "فعال‌سازی fail2ban برای SSH..."
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

  log_info "فعال‌سازی به‌روزرسانی امنیتی خودکار..."
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AUTOUP'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTOUP
  systemctl enable unattended-upgrades >/dev/null 2>&1 || true
  systemctl start unattended-upgrades >/dev/null 2>&1 || true

  log_ok "هاردنینگ پایه اعمال شد (sysctl، SSH، fail2ban، auto-updates)."
}

setup_firewall() {
  if [[ "$ENABLE_FIREWALL" -ne 1 ]]; then
    return
  fi
  step_begin "پیکربندی فایروال UFW"
  detect_ssh_port

  log_info "باز کردن پورت SSH (${SSH_PORT}/tcp) قبل از فعال‌سازی فایروال..."
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
  log_ok "فایروال UFW فعال شد — پورت‌های مجاز: SSH(${SSH_PORT})$( [[ "$USE_NGINX" -eq 1 ]] && echo -n ', 80' )$( [[ "${USE_DOMAIN:-0}" -eq 1 ]] && echo -n ', 443' )$( [[ "$USE_NGINX" -ne 1 ]] && echo -n ', 3000' )."
}

install_nodejs() {
  step_begin "نصب Node.js"
  if command -v node >/dev/null 2>&1; then
    local ver
    ver="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$ver" -ge "$NODE_MAJOR" ]]; then
      log_ok "Node.js $(node -v) از قبل نصب است."
      return
    fi
  fi
  log_info "نصب Node.js ${NODE_MAJOR}.x..."
  log_busy "دانلود مخزن NodeSource و نصب — ۱ تا ۲ دقیقه"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
  log_ok "Node.js $(node -v) نصب شد."
}

install_mongodb() {
  step_begin "نصب MongoDB"
  if command -v mongod >/dev/null 2>&1; then
    log_ok "MongoDB از قبل نصب است."
    return
  fi
  log_info "نصب MongoDB 7.0..."
  log_busy "افزودن مخزن MongoDB و نصب — ۲ تا ۵ دقیقه"
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
  log_ok "MongoDB نصب و راه‌اندازی شد."
}

install_chrome_for_pdf() {
  step_begin "نصب مرورگر PDF"
  if apt-get install -y -qq chromium-browser 2>/dev/null \
    || apt-get install -y -qq chromium 2>/dev/null; then
    log_ok "Chromium نصب شد."
    return
  fi
  log_warn "Chromium از مخزن نصب نشد؛ تلاش برای Google Chrome..."
  local chrome_deb="/tmp/google-chrome-stable.deb"
  curl -fsSL -o "$chrome_deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  if ! apt-get install -y -qq "$chrome_deb"; then
    dpkg -i "$chrome_deb" || true
    apt-get install -f -y -qq
  fi
  rm -f "$chrome_deb"
  log_ok "Google Chrome نصب شد."
}

install_nginx_stack() {
  if [[ "$USE_NGINX" -ne 1 ]]; then
    return
  fi
  step_begin "نصب Nginx"
  apt-get install -y -qq nginx
  if [[ "$USE_DOMAIN" -eq 1 && "$CERT_MODE" == "letsencrypt" ]]; then
    apt-get install -y -qq certbot python3-certbot-nginx
  fi
  systemctl enable nginx
  log_ok "Nginx نصب شد."
}

deploy_application() {
  step_begin "استقرار سامانه FoodMood"
  log_info "ایجاد کاربر سرویس و کپی پروژه به ${INSTALL_DIR}..."
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
  log_ok "پروژه در ${INSTALL_DIR} مستقر شد."
}

setup_mongodb_auth() {
  step_begin "پیکربندی امنیت MongoDB"
  systemctl start mongod
  sleep 2

  if ! mongosh --quiet --eval "db.runCommand({ ping: 1 })" &>/dev/null; then
    log_err "اتصال به MongoDB ممکن نیست."
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
    log_ok "کاربر دیتابیس '${MONGO_USER}' ساخته شد."
  else
    log_warn "کاربر '${MONGO_USER}' از قبل وجود دارد — رمز تغییر داده نمی‌شود."
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
    log_ok "احراز هویت MongoDB فعال شد."
  else
    log_ok "احراز هویت MongoDB از قبل فعال است."
  fi
}

write_env_file() {
  step_begin "ساخت تنظیمات محیط (.env)"
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

# ── LDAP (اختیاری — راهنما: docs/LDAP-PRODUCTION.md) ─────────
# LDAP_URL=ldaps://dc.company.local:636
# LDAP_SECURITY=ldaps
# LDAP_BASE_DN=DC=company,DC=local
# LDAP_BIND_DN=CN=svc-food,DC=company,DC=local
# LDAP_BIND_PASSWORD=          # جایگزین: ذخیره رمزنگاری‌شده از پنل ادمین
# LDAP_CA_CERT_PATH=/opt/food/certs/ldap-ca.pem
# LDAP_USER_FILTER=(sAMAccountName={{username}})
# LDAP_ALLOWED_HOSTS=dc.company.local
EOF

  chown "$APP_USER:$APP_GROUP" "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
  log_ok "فایل .env ساخته شد."
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
  راهنمای نصب سامانه تغذیه — بدون اطلاعات حساس
  نسخه نصب‌شده: v${installed_version}
  تاریخ نصب: $(date '+%Y-%m-%d %H:%M:%S %Z')
═══════════════════════════════════════════════════════════════

⚠  این فایل عمداً رمز، توکن یا کلید ندارد.
   رمزها فقط یک‌بار در ترمینال نصب نمایش داده شدند.
   آن‌ها را در خزانه رمز سازمانی (خارج از سرور) نگه دارید.

─── MongoDB (بدون رمز) ───────────────────────────────────────
  نام کاربری : ${MONGO_USER}
  پایگاه داده: ${DB_NAME}
  آدرس       : 127.0.0.1:27017

─── دسترسی وب ─────────────────────────────────────────────────
  آدرس سامانه: ${access_url}
$( [[ "${USE_DOMAIN:-0}" -eq 1 ]] && echo "  دامنه       : ${APP_DOMAIN}" )
$( [[ "${USE_DOMAIN:-0}" -eq 1 && -n "${CERT_MODE:-}" ]] && echo "  نوع SSL     : ${CERT_MODE}" )

─── امنیت سرور ────────────────────────────────────────────────
  فایروال UFW : $( [[ "${ENABLE_FIREWALL:-0}" -eq 1 ]] && echo "فعال" || echo "غیرفعال" )
  پورت SSH    : ${SSH_PORT}
  هاردنینگ    : $( [[ "${ENABLE_HARDENING:-0}" -eq 1 ]] && echo "فعال (sysctl, fail2ban)" || echo "غیرفعال" )

─── مسیرها (استاندارد FHS / systemd) ─────────────────────────
  نصب برنامه  : ${INSTALL_DIR}              (/opt — FHS)
  تنظیمات اجرا : ${INSTALL_DIR}/.env         (600 — foodapp)
  لاگ سیستمی   : /var/log/foodmood/          (/var/log — FHS)
  لاگ متنی     : /var/log/foodmood/system.log
  گواهی LDAP   : ${INSTALL_DIR}/certs/
  واحد systemd : /etc/systemd/system/${SERVICE_NAME}.service
  کاربر سرویس  : ${APP_USER}
  داده MongoDB : /var/lib/mongodb
  راهنمای کامل : ${INSTALL_DIR}/docs/LINUX-DEPLOYMENT.md
  بررسی نهایی  : sudo bash ${INSTALL_DIR}/deploy/verify-install.sh

─── LDAP (اختیاری) ───────────────────────────────────────────
  راهنمای گواهی CA و Active Directory:
  ${INSTALL_DIR}/docs/LDAP-PRODUCTION.md

EOF

  chmod 644 "$INSTALL_INFO_FILE"
  chown root:root "$INSTALL_INFO_FILE"
  # حذف فایل قدیمی در صورت وجود — دیگر رمز روی سرور نگه نمی‌داریم
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
  echo -e "${YELLOW}${BOLD}  اطلاعات حساس — فقط یک‌بار در همین ترمینال${NC}"
  echo -e "${YELLOW}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${BOLD}─── MongoDB ───────────────────────────────────────────────────${NC}"
  echo "  نام کاربری : ${MONGO_USER}"
  echo "  رمز عبور   : ${MONGO_PASS}"
  echo "  پایگاه داده: ${DB_NAME}"
  echo ""
  echo -e "${BOLD}─── دسترسی وب ─────────────────────────────────────────────────${NC}"
  echo "  آدرس سامانه: ${access_url}"
  echo ""
  echo -e "${BOLD}─── کلیدهای رمزنگاری (.env) ──────────────────────────────────${NC}"
  echo "  SESSION_SECRET  : ${session_secret}"
  echo "  JWT_SECRET      : ${jwt_secret}"
  echo "  BACKUP_SECRET   : ${backup_secret}"
  echo "  PASSWORD_PEPPER : ${pepper}"
  echo "  ANNOUNCEMENT_ENCRYPTION_KEY : ${announcement_key}"
  echo "  LDAP_ENCRYPTION_KEY          : ${ldap_enc_key}"
  echo ""

  if [[ "$CREATE_SUPERADMIN" -eq 1 ]]; then
    echo -e "${BOLD}─── سوپرادمین ─────────────────────────────────────────────────${NC}"
    if [[ -n "$SUPERADMIN_CREDS_OUTPUT" ]]; then
      echo "$SUPERADMIN_CREDS_OUTPUT"
    else
      echo "  (ساخت سوپرادمین انجام نشد یا از قبل وجود داشت)"
    fi
    echo ""
  fi

  prompt_off_server_ack "اطلاعات نهایی نصب"
  wipe_install_secrets_from_shell
  log_ok "تأیید ذخیره خارج از سرور ثبت شد. رمزها از حافظه نصب‌کننده پاک شدند."
}

install_npm_deps() {
  step_begin "نصب وابستگی‌های Node.js"
  mkdir -p "${INSTALL_DIR}/certs"
  chown "$APP_USER:$APP_GROUP" "${INSTALL_DIR}/certs"
  chmod 750 "${INSTALL_DIR}/certs"
  log_busy "npm install --omit=dev — معمولاً ۲ تا ۸ دقیقه؛ تا پایان صبر کنید"
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev --progress=true"
  log_ok "npm install انجام شد."
}

setup_systemd() {
  step_begin "فعال‌سازی سرویس systemd (foodmood)"
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
    log_ok "سرویس ${SERVICE_NAME} فعال شد — با هر بار روشن شدن سرور خودکار بالا می‌آید."
  else
    log_err "سرویس بالا نیامد. لاگ: journalctl -u ${SERVICE_NAME} -n 30"
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
  log_ok "Nginx روی http://${server_ip} پیکربندی شد."
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
  log_ok "Nginx با گواهی اختصاصی روی https://${APP_DOMAIN} پیکربندی شد."
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

  log_info "دریافت گواهی Let's Encrypt برای ${APP_DOMAIN}..."
  certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL" --redirect
  log_ok "HTTPS با Let's Encrypt فعال شد: https://${APP_DOMAIN}"
}

configure_nginx() {
  if [[ "$USE_NGINX" -ne 1 ]]; then
    return
  fi
  step_begin "پیکربندی Nginx"

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
  step_begin "ساخت سوپرادمین"
  local output
  output="$(sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node scripts/super-admin.js create $(printf '%q' "$SUPERADMIN_USER") $(printf '%q' "$SUPERADMIN_PASS")" 2>&1)" || {
    log_warn "ساخت سوپرادمین ناموفق بود (شاید از قبل وجود دارد):"
    echo "$output"
    return
  }
  SUPERADMIN_CREDS_OUTPUT="$output"
  log_ok "سوپرادمین '${SUPERADMIN_USER}' ساخته شد — اطلاعات ورود در پایان نصب یک‌بار در ترمینال نمایش داده می‌شود."
}

run_post_install_verify() {
  step_begin "بررسی نهایی و پذیرش نصب (verify-install)"
  if [[ -f "${INSTALL_DIR}/deploy/verify-install.sh" ]]; then
    bash "${INSTALL_DIR}/deploy/verify-install.sh" --from-install || {
      log_err "بررسی نهایی ناموفق — قبل از Go-Live مشکلات را رفع کنید."
      exit 1
    }
  else
    log_warn "اسکریپت verify-install.sh پیدا نشد — بررسی خودکار رد شد."
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
  echo -e "${GREEN}${BOLD}  ✓ نصب FoodMood با موفقیت انجام شد${NC}"
  echo ""
  echo -e "  ${BOLD}آدرس سامانه:${NC}  ${access_url}/login"
  echo -e "  ${BOLD}پنل مدیریت:${NC}   ${access_url}/admin/dashboard"
  if [[ "$ENABLE_FIREWALL" -eq 1 ]]; then
    echo -e "  ${BOLD}فایروال UFW:${NC}   فعال — پورت‌های مجاز: ${fw_ports}"
  fi
  if [[ "$ENABLE_HARDENING" -eq 1 ]]; then
    echo -e "  ${BOLD}هاردنینگ:${NC}     sysctl · fail2ban · auto-updates"
  fi
  echo ""
  red_box $'✓  نصب کامل شد.\n   اطلاعات حساس فقط یک‌بار در ترمینال نمایش داده شد\n   و تأیید ذخیره خارج از سرور دریافت شد.\n\n   راهنمای بدون رمز: /opt/food/INSTALL_INFO.txt\n   (فقط آدرس‌ها و مسیرها — بدون رمز یا توکن)'
  echo -e "  ${BOLD}دستورات مفید:${NC}"
  echo "    sudo systemctl status foodmood"
  echo "    sudo journalctl -u foodmood -f"
  echo "    sudo tail -f /var/log/foodmood/system.log"
  echo "    sudo systemctl restart foodmood"
  echo "    sudo bash ${INSTALL_DIR}/deploy/verify-install.sh"
  echo ""
  echo -e "  ${BOLD}مستندات:${NC}"
  echo "    ${INSTALL_DIR}/docs/LINUX-DEPLOYMENT.md  (مسیرها + چک‌لیست Go-Live)"
  echo "    ${INSTALL_DIR}/docs/LDAP-PRODUCTION.md   (LDAP + گواهی CA)"
  echo ""
}

main() {
  require_root
  show_foodmood_banner
  show_install_roadmap
  step_begin "دریافت اطلاعات نصب"
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
  step_begin "خلاصه و پایان نصب"
  print_summary
}

main "$@"
