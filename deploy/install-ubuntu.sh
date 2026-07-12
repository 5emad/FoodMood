#!/usr/bin/env bash
# نصب خودکار سامانه تغذیه روی Ubuntu/Debian
# اجرا از ریشه پروژه:
#   sudo bash deploy/install-ubuntu.sh            ← نصب تعاملی کامل
#   sudo bash deploy/install-ubuntu.sh --quick    ← فقط یوزر/پس دیتابیس را می‌پرسد؛ بقیه خودکار
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
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
APP_GROUP="foodapp"
DB_NAME="food_ordering"
SERVICE_NAME="food"
NODE_MAJOR="20"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CREDENTIALS_FILE="${INSTALL_DIR}/CREDENTIALS.txt"

log_info()  { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()   { echo -e "${RED}[✗]${NC} $*" >&2; }

red_box() {
  echo ""
  echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
  while IFS= read -r line; do
    printf "${RED}${BOLD}║${NC} %-64s ${RED}${BOLD}║${NC}\n" "$line"
  done <<< "$1"
  echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
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

collect_inputs() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  نصب خودکار سامانه تغذیه — Ubuntu / Debian${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo ""

  red_box $'⚠  هشدار مهم:\n   اطلاعات دیتابیس و رمزهای سامانه را حتماً در جای امن\n   (مدیریت رمز سازمان / خزانه امن) نگه دارید.\n   بدون این اطلاعات، بازیابی و دسترسی ممکن است غیرممکن شود.\n   پس از نصب، فایل CREDENTIALS.txt فقط برای root قابل خواندن است.'

  MONGO_USER="$(prompt_required "نام کاربری دیتابیس MongoDB")"
  MONGO_PASS="$(prompt_password_twice "رمز عبور دیتابیس MongoDB")"

  red_box $'⚠  این نام کاربری و رمز دیتابیس را همین الان یادداشت کنید!\n   پس از نصب در فایل زیر هم ذخیره می‌شود:\n   /opt/food/CREDENTIALS.txt'

  # ── حالت سریع: فقط دیتابیس پرسیده می‌شود؛ بقیه پیش‌فرض امن ─────────────────
  if [[ "$QUICK_MODE" -eq 1 ]]; then
    USE_NGINX=1
    USE_DOMAIN=0
    CREATE_SUPERADMIN=1
    SUPERADMIN_USER="superadmin"
    # رمز تصادفی قوی: حرف + عدد + نماد (الزامات اعتبارسنجی برنامه)
    SUPERADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-14)@Fm9"
    SERVER_IP="$(detect_server_ip)"
    log_info "حالت سریع: Nginx روی IP، بدون دامنه — دسترسی: http://${SERVER_IP}"
    log_info "سوپرادمین '${SUPERADMIN_USER}' با رمز تصادفی ساخته می‌شود — در CREDENTIALS.txt ذخیره خواهد شد."
    return
  fi

  if prompt_yes_no "Nginx به‌عنوان پروکسی معکوس نصب و پیکربندی شود؟" "y"; then
    USE_NGINX=1
    if prompt_yes_no "دسترسی با دامنه و HTTPS فعال شود؟ (به‌جای IP)" "n"; then
      USE_DOMAIN=1
      APP_DOMAIN="$(prompt_required "نام دامنه (مثال: food.company.ir)")"
      echo ""
      echo "نوع گواهی SSL:"
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
        SSL_FULLCHAIN="$(prompt_required "مسیر فایل fullchain (مثال: /path/to/fullchain.pem)")"
        SSL_PRIVKEY="$(prompt_required "مسیر فایل privkey (مثال: /path/to/privkey.pem)")"
        if [[ ! -f "$SSL_FULLCHAIN" || ! -f "$SSL_PRIVKEY" ]]; then
          log_err "فایل‌های گواهی پیدا نشدند."
          exit 1
        fi
      fi
    else
      USE_DOMAIN=0
      SERVER_IP="$(detect_server_ip)"
      log_info "دسترسی از طریق IP: http://${SERVER_IP}"
    fi
  else
    USE_NGINX=0
    USE_DOMAIN=0
    SERVER_IP="$(detect_server_ip)"
    log_info "سامانه مستقیم روی پورت 3000: http://${SERVER_IP}:3000"
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
  log_info "به‌روزرسانی مخازن و نصب بسته‌های پایه..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    curl gnupg ca-certificates lsb-release apt-transport-https \
    software-properties-common rsync openssl python3 \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils
  log_ok "بسته‌های پایه نصب شدند."
}

install_nodejs() {
  if command -v node >/dev/null 2>&1; then
    local ver
    ver="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$ver" -ge "$NODE_MAJOR" ]]; then
      log_ok "Node.js $(node -v) از قبل نصب است."
      return
    fi
  fi
  log_info "نصب Node.js ${NODE_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  log_ok "Node.js $(node -v) نصب شد."
}

install_mongodb() {
  if command -v mongod >/dev/null 2>&1; then
    log_ok "MongoDB از قبل نصب است."
    return
  fi
  log_info "نصب MongoDB 7.0..."
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
  apt-get update -qq
  apt-get install -y -qq mongodb-org
  systemctl enable mongod
  systemctl start mongod
  log_ok "MongoDB نصب و راه‌اندازی شد."
}

install_chrome_for_pdf() {
  log_info "نصب مرورگر برای ساخت PDF..."
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
  log_info "نصب Nginx..."
  apt-get install -y -qq nginx
  if [[ "$USE_DOMAIN" -eq 1 && "$CERT_MODE" == "letsencrypt" ]]; then
    apt-get install -y -qq certbot python3-certbot-nginx
  fi
  systemctl enable nginx
  log_ok "Nginx نصب شد."
}

deploy_application() {
  log_info "ایجاد کاربر سرویس و کپی پروژه به ${INSTALL_DIR}..."
  if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -d "$INSTALL_DIR" -s /bin/bash "$APP_USER"
  fi

  mkdir -p "$INSTALL_DIR"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude CREDENTIALS.txt \
    --exclude '*.log' \
    "$PROJECT_DIR/" "$INSTALL_DIR/"

  chown -R "$APP_USER:$APP_GROUP" "$INSTALL_DIR"
  log_ok "پروژه در ${INSTALL_DIR} مستقر شد."
}

setup_mongodb_auth() {
  log_info "پیکربندی احراز هویت MongoDB..."
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
  log_info "ساخت فایل .env..."
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
BACKUP_SECRET=${BACKUP_SECRET}
PASSWORD_PEPPER=${PASSWORD_PEPPER}
EOF

  chown "$APP_USER:$APP_GROUP" "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
  log_ok "فایل .env ساخته شد."
}

write_credentials_file() {
  local access_url
  if [[ "$USE_DOMAIN" -eq 1 ]]; then
    access_url="https://${APP_DOMAIN}"
  elif [[ "$USE_NGINX" -eq 1 ]]; then
    access_url="http://${SERVER_IP:-$(detect_server_ip)}"
  else
    access_url="http://${SERVER_IP:-$(detect_server_ip)}:3000"
  fi

  cat > "$CREDENTIALS_FILE" <<EOF
═══════════════════════════════════════════════════════════════
  اطلاعات حساس سامانه تغذیه — این فایل را در جای امن نگه دارید
  تاریخ نصب: $(date '+%Y-%m-%d %H:%M:%S %Z')
═══════════════════════════════════════════════════════════════

⚠  هشدار: بدون این اطلاعات، بازیابی دیتابیس و پشتیبان ممکن است
   غیرممکن شود. یک کپی در خزانه رمز سازمان نگه دارید.

─── MongoDB ───────────────────────────────────────────────────
  نام کاربری : ${MONGO_USER}
  رمز عبور   : ${MONGO_PASS}
  پایگاه داده: ${DB_NAME}
  آدرس       : 127.0.0.1:27017

─── دسترسی وب ─────────────────────────────────────────────────
  آدرس سامانه: ${access_url}

─── کلیدهای رمزنگاری (.env) ──────────────────────────────────
  SESSION_SECRET  : $(grep '^SESSION_SECRET=' "${INSTALL_DIR}/.env" | cut -d= -f2-)
  JWT_SECRET      : $(grep '^JWT_SECRET=' "${INSTALL_DIR}/.env" | cut -d= -f2-)
  BACKUP_SECRET   : $(grep '^BACKUP_SECRET=' "${INSTALL_DIR}/.env" | cut -d= -f2-)
  PASSWORD_PEPPER : $(grep '^PASSWORD_PEPPER=' "${INSTALL_DIR}/.env" | cut -d= -f2-)

─── مسیرها ────────────────────────────────────────────────────
  نصب سامانه : ${INSTALL_DIR}
  فایل env   : ${INSTALL_DIR}/.env
  لاگ سرویس  : journalctl -u ${SERVICE_NAME} -f

EOF

  chmod 600 "$CREDENTIALS_FILE"
  chown root:root "$CREDENTIALS_FILE"
}

install_npm_deps() {
  log_info "نصب وابستگی‌های Node.js (ممکن است چند دقیقه طول بکشد)..."
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev"
  log_ok "npm install انجام شد."
}

setup_systemd() {
  log_info "فعال‌سازی سرویس systemd..."
  cp "${INSTALL_DIR}/deploy/food.service" "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    log_ok "سرویس ${SERVICE_NAME} در حال اجراست."
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

  if [[ "$USE_DOMAIN" -eq 1 ]]; then
    if [[ "$CERT_MODE" == "letsencrypt" ]]; then
      configure_nginx_https_letsencrypt
    else
      configure_nginx_https_custom
    fi
    if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
      ufw allow 80/tcp
      ufw allow 443/tcp
    fi
  else
    configure_nginx_http
    if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
      ufw allow 80/tcp
    fi
  fi
}

create_superadmin_account() {
  if [[ "$CREATE_SUPERADMIN" -ne 1 ]]; then
    return
  fi
  log_info "ساخت سوپرادمین..."
  local output
  output="$(sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node scripts/super-admin.js create $(printf '%q' "$SUPERADMIN_USER") $(printf '%q' "$SUPERADMIN_PASS")" 2>&1)" || {
    log_warn "ساخت سوپرادمین ناموفق بود (شاید از قبل وجود دارد):"
    echo "$output"
    return
  }
  echo "$output" >> "$CREDENTIALS_FILE"
  chmod 600 "$CREDENTIALS_FILE"
  log_ok "سوپرادمین '${SUPERADMIN_USER}' ساخته شد — توکن دومرحله‌ای در CREDENTIALS.txt ذخیره شد."
}

print_summary() {
  local access_url
  if [[ "$USE_DOMAIN" -eq 1 ]]; then
    access_url="https://${APP_DOMAIN}"
  elif [[ "$USE_NGINX" -eq 1 ]]; then
    access_url="http://${SERVER_IP:-$(detect_server_ip)}"
  else
    access_url="http://${SERVER_IP:-$(detect_server_ip)}:3000"
  fi

  echo ""
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  نصب با موفقیت انجام شد${NC}"
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BOLD}آدرس سامانه:${NC}  ${access_url}/login"
  echo -e "  ${BOLD}پنل مدیریت:${NC}   ${access_url}/admin/dashboard"
  echo ""
  red_box $'⚠  حتماً اطلاعات زیر را در جای امن نگه دارید:\n   • نام کاربری و رمز MongoDB\n   • کلیدهای BACKUP_SECRET و سایر رمزهای .env\n   • توکن دومرحله‌ای سوپرادمین (اگر ساخته شد)\n\n   فایل کامل: /opt/food/CREDENTIALS.txt\n   (فقط root می‌تواند بخواند — یک کپی امن بگیرید)'
  echo -e "  ${BOLD}دستورات مفید:${NC}"
  echo "    sudo systemctl status food"
  echo "    sudo journalctl -u food -f"
  echo "    sudo systemctl restart food"
  echo ""
}

main() {
  require_root
  collect_inputs
  install_base_packages
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
  write_credentials_file
  create_superadmin_account
  print_summary
}

main "$@"
