#!/usr/bin/env bash
# مهاجرت امن از نصب bare-metal (/opt/food) به Docker — بدون از دست رفتن داده
# استفاده:
#   sudo bash /opt/food/deploy/migrate-to-docker.sh
# یا از سورس کلون‌شده:
#   sudo bash deploy/migrate-to-docker.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/food}"
SERVICE_NAME="${SERVICE_NAME:-foodmood}"
COMPOSE_DIR="${COMPOSE_DIR:-$INSTALL_DIR}"
BACKUP_ROOT="/var/backups/foodmood-docker-migrate-$(date +%Y%m%d-%H%M%S)"
ENV_DOCKER="${COMPOSE_DIR}/.env.docker"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || { err "نیاز به دستور: $1"; exit 1; }; }

[[ "$(id -u)" -eq 0 ]] || { err "با root اجرا کنید (sudo)"; exit 1; }
need docker
docker compose version >/dev/null 2>&1 || { err "docker compose در دسترس نیست"; exit 1; }

[[ -d "$INSTALL_DIR" ]] || { err "نصب پیدا نشد: $INSTALL_DIR"; exit 1; }
[[ -f "${INSTALL_DIR}/.env" ]] || { err "فایل .env نیست"; exit 1; }
[[ -f "${COMPOSE_DIR}/docker-compose.yml" ]] || { err "docker-compose.yml نیست — اول update بگیرید"; exit 1; }

mkdir -p "$BACKUP_ROOT"
log "بکاپ در: $BACKUP_ROOT"

# 1) بکاپ .env و آپلود
cp -a "${INSTALL_DIR}/.env" "${BACKUP_ROOT}/env.bak"
if [[ -d "${INSTALL_DIR}/backend/public/uploads" ]]; then
  tar -czf "${BACKUP_ROOT}/uploads.tgz" -C "${INSTALL_DIR}/backend/public" uploads
  log "آپلودها بکاپ شد"
fi

# 2) mongodump از URI فعلی
MONGODB_URI="$(grep '^MONGODB_URI=' "${INSTALL_DIR}/.env" | cut -d= -f2- | tr -d '\r')"
if [[ -z "$MONGODB_URI" ]]; then
  err "MONGODB_URI در .env خالی است"
  exit 1
fi
if command -v mongodump >/dev/null 2>&1; then
  mongodump --uri="$MONGODB_URI" --out="${BACKUP_ROOT}/mongodump"
  log "mongodump انجام شد"
else
  warn "mongodump نصب نیست — فقط volume خالی ساخته می‌شود؛ داده مونگو را دستی منتقل کنید"
fi

# 3) ساخت .env.docker از .env فعلی (رازها حفظ می‌شوند)
if [[ ! -f "$ENV_DOCKER" ]]; then
  if [[ -f "${COMPOSE_DIR}/.env.docker.example" ]]; then
    cp "${COMPOSE_DIR}/.env.docker.example" "$ENV_DOCKER"
  else
    touch "$ENV_DOCKER"
  fi
fi

copy_env_key() {
  local key="$1"
  local val
  val="$(grep "^${key}=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  [[ -n "$val" ]] || return 0
  if grep -q "^${key}=" "$ENV_DOCKER" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_DOCKER"
  else
    echo "${key}=${val}" >> "$ENV_DOCKER"
  fi
}

for k in SESSION_SECRET JWT_SECRET JWT_EXPIRE BACKUP_SECRET PASSWORD_PEPPER \
         ANNOUNCEMENT_ENCRYPTION_KEY LDAP_ENCRYPTION_KEY LOG_ENCRYPTION_KEY \
         APP_URL ALLOWED_ORIGINS TRUST_TLS TZ SESSION_IDLE_MINUTES SESSION_MAX_HOURS SESSION_BIND_UA; do
  copy_env_key "$k"
done

# پسوردهای مونگو داکر (اگر نبود بساز)
ensure_docker_secret() {
  local key="$1"
  if grep -q "^${key}=" "$ENV_DOCKER" 2>/dev/null; then
    local cur
    cur="$(grep "^${key}=" "$ENV_DOCKER" | cut -d= -f2-)"
    if [[ -n "$cur" && "$cur" != change-me-* && "$cur" != replace-with-* ]]; then
      return 0
    fi
  fi
  local val
  val="$(openssl rand -base64 24 | tr -d '\n=/+' | cut -c1-28)"
  if grep -q "^${key}=" "$ENV_DOCKER" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_DOCKER"
  else
    echo "${key}=${val}" >> "$ENV_DOCKER"
  fi
  warn "Generated ${key} for Docker Mongo — در خزانه رمز ذخیره کنید"
}

ensure_docker_secret MONGO_ROOT_PASSWORD
ensure_docker_secret MONGO_APP_PASSWORD
grep -q '^MONGO_ROOT_USER=' "$ENV_DOCKER" 2>/dev/null || echo 'MONGO_ROOT_USER=foodroot' >> "$ENV_DOCKER"
grep -q '^MONGO_APP_USER=' "$ENV_DOCKER" 2>/dev/null || echo 'MONGO_APP_USER=foodapp' >> "$ENV_DOCKER"
grep -q '^HTTP_PORT=' "$ENV_DOCKER" 2>/dev/null || echo 'HTTP_PORT=80' >> "$ENV_DOCKER"
grep -q '^CLUSTER_WORKERS=' "$ENV_DOCKER" 2>/dev/null || echo 'CLUSTER_WORKERS=auto' >> "$ENV_DOCKER"
grep -q '^TRUSTED_PROXIES=' "$ENV_DOCKER" 2>/dev/null || echo 'TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16' >> "$ENV_DOCKER"

chmod 600 "$ENV_DOCKER"
log ".env.docker آماده شد"

# 4) توقف سرویس قدیمی (داده مونگو روی دیسک می‌ماند؛ dump جدا گرفته شد)
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
log "سرویس ${SERVICE_NAME} متوقف شد"

# 5) بالا آوردن استک داکر
cd "$COMPOSE_DIR"
docker compose --env-file "$ENV_DOCKER" up -d --build
log "استک Docker بالا آمد"

# 6) بازگردانی آپلود به volume
if [[ -f "${BACKUP_ROOT}/uploads.tgz" ]]; then
  APP_CID="$(docker compose --env-file "$ENV_DOCKER" ps -q app | head -n1)"
  if [[ -n "$APP_CID" ]]; then
    docker cp "${BACKUP_ROOT}/uploads.tgz" "${APP_CID}:/tmp/uploads.tgz"
    docker exec -u root "$APP_CID" sh -c 'mkdir -p /app/backend/public/uploads && tar -xzf /tmp/uploads.tgz -C /app/backend/public && chown -R foodmood:foodmood /app/backend/public/uploads && rm -f /tmp/uploads.tgz'
    log "آپلودها به volume منتقل شد"
  fi
fi

# 7) mongorestore داخل کانتینر mongo
if [[ -d "${BACKUP_ROOT}/mongodump" ]]; then
  MONGO_CID="$(docker compose --env-file "$ENV_DOCKER" ps -q mongo | head -n1)"
  APP_USER="$(grep '^MONGO_APP_USER=' "$ENV_DOCKER" | cut -d= -f2-)"
  APP_PASS="$(grep '^MONGO_APP_PASSWORD=' "$ENV_DOCKER" | cut -d= -f2-)"
  if [[ -n "$MONGO_CID" ]]; then
    docker cp "${BACKUP_ROOT}/mongodump" "${MONGO_CID}:/tmp/mongodump"
    # صبر برای healthy
    sleep 5
    docker exec "$MONGO_CID" mongorestore \
      --username="$APP_USER" --password="$APP_PASS" --authenticationDatabase=food_ordering \
      --db=food_ordering --drop /tmp/mongodump/food_ordering 2>/dev/null \
      || docker exec "$MONGO_CID" bash -c \
        "mongorestore -u \"\$MONGO_INITDB_ROOT_USERNAME\" -p \"\$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin --db food_ordering --drop /tmp/mongodump/food_ordering"
    docker exec "$MONGO_CID" rm -rf /tmp/mongodump
    log "دیتابیس با mongorestore بازگردانی شد"
  fi
fi

systemctl disable "$SERVICE_NAME" 2>/dev/null || true
warn "سرویس systemd غیرفعال شد تا با Docker تداخل نکند. mongod میزبان را در صورت نیاز دستی stop کنید."

echo ""
log "مهاجرت تمام شد."
echo "  بکاپ:     $BACKUP_ROOT"
echo "  آدرس:     http://SERVER_IP (پورت HTTP_PORT در .env.docker)"
echo "  لاگ:      docker compose --env-file .env.docker logs -f"
echo "  مقیاس:    docker compose --env-file .env.docker up -d --scale app=2"
echo ""
