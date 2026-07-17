#!/usr/bin/env bash
# توابع مشترک استقرار Docker برای update / migrate
# shellcheck shell=bash

FOOD_DOCKER_MARKER="${FOOD_DOCKER_MARKER:-${INSTALL_DIR:-/opt/food}/.docker-deployed}"
FOOD_DOCKER_HTTP_PORT="${FOOD_DOCKER_HTTP_PORT:-8080}"

docker_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    return 1
  fi
}

ensure_docker_engine() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker_compose_cmd >/dev/null || {
      log_err "docker هست ولی docker compose نیست"
      return 1
    }
    return 0
  fi

  log_info "Installing Docker Engine..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  local codename
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-jammy}")"
  local distro
  distro="$(. /etc/os-release && echo "${ID:-ubuntu}")"
  # Debian/Ubuntu docker repo
  if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${distro} ${codename} stable" \
      > /etc/apt/sources.list.d/docker.list
  fi
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin \
    || apt-get install -y -qq docker.io docker-compose-v2 \
    || apt-get install -y -qq docker.io docker-compose

  systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
  sleep 2
  docker info >/dev/null 2>&1 || {
    log_err "Docker نصب شد ولی daemon بالا نیامد"
    return 1
  }
  log_ok "Docker آماده است"
}

is_docker_stack_active() {
  [[ -f "$FOOD_DOCKER_MARKER" ]] || return 1
  local dc
  dc="$(docker_compose_cmd)" || return 1
  (cd "${INSTALL_DIR}" && $dc --env-file .env.docker ps -q app 2>/dev/null | grep -q .)
}

ensure_env_docker_file() {
  local env_file="${INSTALL_DIR}/.env"
  local env_docker="${INSTALL_DIR}/.env.docker"
  local example="${INSTALL_DIR}/.env.docker.example"

  if [[ ! -f "$env_docker" ]]; then
    if [[ -f "$example" ]]; then
      cp "$example" "$env_docker"
    else
      touch "$env_docker"
    fi
  fi

  copy_key() {
    local key="$1"
    local val
    val="$(grep "^${key}=" "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
    [[ -n "$val" ]] || return 0
    if grep -q "^${key}=" "$env_docker" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$env_docker"
    else
      echo "${key}=${val}" >> "$env_docker"
    fi
  }

  for k in SESSION_SECRET JWT_SECRET JWT_EXPIRE BACKUP_SECRET PASSWORD_PEPPER \
           ANNOUNCEMENT_ENCRYPTION_KEY LDAP_ENCRYPTION_KEY LOG_ENCRYPTION_KEY \
           APP_URL ALLOWED_ORIGINS TRUST_TLS TZ SESSION_IDLE_MINUTES SESSION_MAX_HOURS SESSION_BIND_UA \
           API_RATE_LIMIT_MAX WAF_RATE_LIMIT_MAX; do
    copy_key "$k"
  done

  set_default() {
    local key="$1" val="$2"
    if ! grep -q "^${key}=" "$env_docker" 2>/dev/null; then
      echo "${key}=${val}" >> "$env_docker"
      return
    fi
    local cur
    cur="$(grep "^${key}=" "$env_docker" | cut -d= -f2- | tr -d '\r')"
    if [[ -z "$cur" || "$cur" == change-me-* || "$cur" == replace-with-* ]]; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$env_docker"
    fi
  }

  gen_secret() {
    openssl rand -base64 24 | tr -d '\n=/+' | cut -c1-28
  }

  set_default MONGO_ROOT_USER foodroot
  set_default MONGO_APP_USER foodapp
  if ! grep -q '^MONGO_ROOT_PASSWORD=' "$env_docker" 2>/dev/null \
    || grep -q '^MONGO_ROOT_PASSWORD=change-me' "$env_docker" 2>/dev/null; then
    sed -i '/^MONGO_ROOT_PASSWORD=/d' "$env_docker"
    echo "MONGO_ROOT_PASSWORD=$(gen_secret)" >> "$env_docker"
  fi
  if ! grep -q '^MONGO_APP_PASSWORD=' "$env_docker" 2>/dev/null \
    || grep -q '^MONGO_APP_PASSWORD=change-me' "$env_docker" 2>/dev/null; then
    sed -i '/^MONGO_APP_PASSWORD=/d' "$env_docker"
    echo "MONGO_APP_PASSWORD=$(gen_secret)" >> "$env_docker"
  fi

  # پشت nginx هاست: فقط لوکال — HTTPS همان nginx میزبان می‌ماند
  set_default HTTP_BIND 127.0.0.1
  set_default HTTP_PORT "$FOOD_DOCKER_HTTP_PORT"
  set_default CLUSTER_WORKERS auto
  set_default TRUSTED_PROXIES '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'
  set_default API_RATE_LIMIT_MAX 800
  set_default WAF_RATE_LIMIT_MAX 800
  set_default APP_MEM_LIMIT 2048m
  set_default MONGO_CACHE_GB 1.5

  chmod 600 "$env_docker"
  chown root:root "$env_docker" 2>/dev/null || true
}

backup_bare_metal_data() {
  local backup_root="$1"
  mkdir -p "$backup_root"
  cp -a "${INSTALL_DIR}/.env" "${backup_root}/env.bak" 2>/dev/null || true

  if [[ -d "${INSTALL_DIR}/backend/public/uploads" ]]; then
    tar -czf "${backup_root}/uploads.tgz" -C "${INSTALL_DIR}/backend/public" uploads || true
  fi

  local mongo_uri
  mongo_uri="$(grep '^MONGODB_URI=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -n "$mongo_uri" ]] && command -v mongodump >/dev/null 2>&1; then
    mongodump --uri="$mongo_uri" --out="${backup_root}/mongodump" \
      && log_ok "mongodump → ${backup_root}/mongodump" \
      || log_warn "mongodump ناموفق — داده قبلی در volume خالی نمی‌آید مگر restore دستی"
  else
    log_warn "mongodump در دسترس نیست — اگر اولین مهاجرت است، دیتای مونگو را بعداً restore کنید"
  fi
}

restore_data_into_docker() {
  local backup_root="$1"
  local dc env_docker
  dc="$(docker_compose_cmd)"
  env_docker="${INSTALL_DIR}/.env.docker"

  if [[ -f "${backup_root}/uploads.tgz" ]]; then
    local app_cid
    app_cid="$(cd "$INSTALL_DIR" && $dc --env-file .env.docker ps -q app | head -n1)"
    if [[ -n "$app_cid" ]]; then
      docker cp "${backup_root}/uploads.tgz" "${app_cid}:/tmp/uploads.tgz"
      docker exec -u root "$app_cid" sh -c \
        'mkdir -p /app/backend/public/uploads && tar -xzf /tmp/uploads.tgz -C /app/backend/public && chown -R 10001:10001 /app/backend/public/uploads 2>/dev/null || chown -R foodmood:foodmood /app/backend/public/uploads; rm -f /tmp/uploads.tgz'
      log_ok "آپلودها به volume داکر منتقل شد"
    fi
  fi

  if [[ -d "${backup_root}/mongodump/food_ordering" ]] || [[ -d "${backup_root}/mongodump" ]]; then
    local mongo_cid dump_path
    mongo_cid="$(cd "$INSTALL_DIR" && $dc --env-file .env.docker ps -q mongo | head -n1)"
    dump_path="${backup_root}/mongodump/food_ordering"
    [[ -d "$dump_path" ]] || dump_path="${backup_root}/mongodump"
    if [[ -n "$mongo_cid" && -d "$dump_path" ]]; then
      sleep 3
      docker cp "$dump_path" "${mongo_cid}:/tmp/food_ordering_dump"
      local app_user app_pass
      app_user="$(grep '^MONGO_APP_USER=' "$env_docker" | cut -d= -f2- | tr -d '\r')"
      app_pass="$(grep '^MONGO_APP_PASSWORD=' "$env_docker" | cut -d= -f2- | tr -d '\r')"
      if docker exec "$mongo_cid" mongorestore \
          --username="$app_user" --password="$app_pass" --authenticationDatabase=food_ordering \
          --db=food_ordering --drop /tmp/food_ordering_dump 2>/dev/null; then
        log_ok "دیتابیس داخل Docker restore شد"
      else
        docker exec "$mongo_cid" bash -c \
          'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db food_ordering --drop /tmp/food_ordering_dump' \
          && log_ok "دیتابیس با root داخل Docker restore شد" \
          || log_warn "mongorestore ناموفق — بکاپ در ${backup_root}"
      fi
      docker exec "$mongo_cid" rm -rf /tmp/food_ordering_dump
    fi
  fi
}

repoint_host_nginx_to_docker() {
  local port="${1:-$FOOD_DOCKER_HTTP_PORT}"
  local site="/etc/nginx/sites-available/food"
  [[ -f "$site" ]] || return 0
  if grep -q "proxy_pass http://127.0.0.1:" "$site"; then
    sed -i -E "s|proxy_pass http://127\.0\.0\.1:[0-9]+;|proxy_pass http://127.0.0.1:${port};|g" "$site"
  fi
  if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
    log_ok "Nginx هاست → 127.0.0.1:${port} (Docker)"
  else
    log_warn "nginx -t ناموفق — دستی proxy_pass را به 127.0.0.1:${port} بگذارید"
  fi
}

stop_bare_metal_app_services() {
  systemctl stop "${SERVICE_NAME:-foodmood}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME:-foodmood}" 2>/dev/null || true
  # mongod میزبان را بعد از مهاجرت موفق خاموش می‌کنیم تا تداخل پورت/منابع نباشد
  if [[ -f "$FOOD_DOCKER_MARKER" ]]; then
    systemctl stop mongod 2>/dev/null || true
    systemctl disable mongod 2>/dev/null || true
    log_info "mongod میزبان متوقف شد (داده در volume داکر است)"
  fi
}

docker_stack_up() {
  local dc scale="${1:-1}"
  dc="$(docker_compose_cmd)"
  cd "$INSTALL_DIR"
  if [[ "$scale" -gt 1 ]]; then
    $dc --env-file .env.docker up -d --build --scale "app=${scale}"
  else
    $dc --env-file .env.docker up -d --build
  fi
}

wait_docker_health() {
  local tries="${1:-40}" i
  for ((i=1; i<=tries; i++)); do
    if curl -fsS "http://127.0.0.1:${FOOD_DOCKER_HTTP_PORT}/api/system/health" >/dev/null 2>&1 \
      || curl -fsS "http://127.0.0.1:${FOOD_DOCKER_HTTP_PORT}/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}
