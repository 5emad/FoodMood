#!/usr/bin/env bash
# Nginx HTTPS setup for FoodMood (internal IP + optional custom certificate).
# Sourced by deploy/install.sh, deploy/update.sh, deploy/apply-custom-ssl.sh

NGINX_SSL_DIR="/etc/nginx/ssl"
DEFAULT_TLS_CERT="${NGINX_SSL_DIR}/foodmood.crt"
DEFAULT_TLS_KEY="${NGINX_SSL_DIR}/foodmood.key"
NGINX_SITE="/etc/nginx/sites-available/food"

nginx_tls_set_env_kv() {
  local env_file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    echo "${key}=${value}" >> "$env_file"
  fi
}

custom_ssl_paths() {
  local install_dir="$1"
  local cert="${install_dir}/certs/ssl/custom.crt"
  local key="${install_dir}/certs/ssl/custom.key"
  if [[ -f "$cert" && -f "$key" ]]; then
    echo "$cert|$key"
    return 0
  fi
  return 1
}

cert_matches_server_ip() {
  local cert_path="$1"
  local server_ip="$2"
  openssl x509 -in "$cert_path" -noout -ext subjectAltName 2>/dev/null \
    | grep -q "IP Address:${server_ip}"
}

resolve_ssl_certificate_paths() {
  local install_dir="$1"
  local server_ip="$2"
  local custom
  if custom="$(custom_ssl_paths "$install_dir")"; then
    echo "${custom%%|*}|${custom##*|}|custom"
    return 0
  fi
  ensure_self_signed_certificate "$server_ip"
  echo "${DEFAULT_TLS_CERT}|${DEFAULT_TLS_KEY}|self-signed"
}

ensure_self_signed_certificate() {
  local server_ip="$1"
  mkdir -p "$NGINX_SSL_DIR"

  if [[ -f "$DEFAULT_TLS_CERT" && -f "$DEFAULT_TLS_KEY" ]] \
    && cert_matches_server_ip "$DEFAULT_TLS_CERT" "$server_ip"; then
    return 0
  fi

  local openssl_cnf
  openssl_cnf="$(mktemp)"
  cat > "$openssl_cnf" <<EOF
[req]
distinguished_name=req_distinguished_name
x509_extensions=v3_req
prompt=no
[req_distinguished_name]
CN=${server_ip}
O=FoodMood
C=IR
[v3_req]
subjectAltName=IP:${server_ip},DNS:localhost
EOF

  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$DEFAULT_TLS_KEY" -out "$DEFAULT_TLS_CERT" \
    -config "$openssl_cnf" -extensions v3_req 2>/dev/null \
    || openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout "$DEFAULT_TLS_KEY" -out "$DEFAULT_TLS_CERT" \
      -subj "/CN=${server_ip}/O=FoodMood/C=IR"

  rm -f "$openssl_cnf"
  chmod 644 "$DEFAULT_TLS_CERT"
  chmod 640 "$DEFAULT_TLS_KEY"
  chown root:root "$DEFAULT_TLS_CERT" "$DEFAULT_TLS_KEY"
  if getent group ssl-cert >/dev/null 2>&1; then
    chgrp ssl-cert "$DEFAULT_TLS_KEY"
  elif id www-data >/dev/null 2>&1; then
    chgrp www-data "$DEFAULT_TLS_KEY"
  fi
}

write_nginx_https_site() {
  local cert_path="$1"
  local key_path="$2"
  local install_dir="$3"
  cat > "$NGINX_SITE" <<EOF
# FoodMood — all traffic on HTTPS (HTTP redirects to HTTPS)
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate ${cert_path};
    ssl_certificate_key ${key_path};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }
}
EOF
  fix_install_permissions "$install_dir"
}

fix_install_permissions() {
  local install_dir="$1"
  [[ -d "$install_dir" ]] || return 0
  chmod 755 "$install_dir" 2>/dev/null || true
  if [[ -d "${install_dir}/public" ]]; then
    find "${install_dir}/public" -type d -exec chmod a+rx {} + 2>/dev/null || true
    find "${install_dir}/public" -type f -exec chmod a+r {} + 2>/dev/null || true
  fi
}

nginx_listens_on() {
  local port="$1"
  ss -tln 2>/dev/null | grep -qE ":${port}[[:space:]]"
}

ensure_nginx_running() {
  systemctl enable nginx 2>/dev/null || true
  nginx -t
  systemctl restart nginx
  if systemctl is-active --quiet nginx; then
    return 0
  fi
  echo "nginx failed to start — check: journalctl -u nginx -n 30" >&2
  return 1
}

reload_nginx_food_site() {
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/food
  rm -f /etc/nginx/sites-enabled/default
  ensure_nginx_running || return 1
  if ! nginx_listens_on 443; then
    echo "nginx is not listening on port 443 after restart" >&2
    echo "Config: ${NGINX_SITE}" >&2
    echo "Check SSL cert: ${DEFAULT_TLS_CERT}" >&2
    return 1
  fi
}

configure_app_https_env() {
  local server_ip="$1"
  local install_dir="$2"
  local app_user="$3"
  local env_file="${install_dir}/.env"
  local https_url="https://${server_ip}"

  [[ -f "$env_file" ]] || return 0

  nginx_tls_set_env_kv "$env_file" "TRUST_TLS" "true"
  nginx_tls_set_env_kv "$env_file" "APP_URL" "$https_url"
  nginx_tls_set_env_kv "$env_file" "ALLOWED_ORIGINS" "$https_url"
  chown "${app_user}:${app_user}" "$env_file"
  chmod 600 "$env_file"

  local mongo_uri
  mongo_uri="$(grep '^MONGODB_URI=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -n "$mongo_uri" ]] && command -v mongosh >/dev/null 2>&1; then
    mongosh "$mongo_uri" --quiet --eval \
      "db.appsettings.updateOne({key:'default'}, {\$set:{publicUrl:'${https_url}'}}, {upsert:true})" \
      >/dev/null 2>&1 || true
  fi
}

ensure_ufw_web_ports() {
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 80/tcp comment 'HTTP redirect' >/dev/null 2>&1 || true
    ufw allow 443/tcp comment 'HTTPS / Nginx' >/dev/null 2>&1 || true
  fi
}

# Standard production install: HTTPS only, self-signed until panel upload.
configure_https_only() {
  local server_ip="$1"
  local install_dir="$2"
  local app_user="$3"
  local cert_path key_path resolved

  resolved="$(resolve_ssl_certificate_paths "$install_dir" "$server_ip")"
  cert_path="${resolved%%|*}"
  resolved="${resolved#*|}"
  key_path="${resolved%%|*}"

  write_nginx_https_site "$cert_path" "$key_path" "$install_dir"
  reload_nginx_food_site || return 1
  configure_app_https_env "$server_ip" "$install_dir" "$app_user"
  ensure_ufw_web_ports
}

# Legacy alias
configure_standard_tls() {
  configure_https_only "$@"
}

configure_dual_stack() {
  configure_https_only "$@"
}

verify_https_only_deployment() {
  local server_ip="$1"
  local https_url="https://${server_ip}"
  local css_code redirect_code listen_443

  listen_443="$(ss -tln 2>/dev/null | awk '$4 ~ /:443$/ {found=1} END{print found+0}')"
  if [[ "$listen_443" != "1" ]]; then
    echo "Port 443 is not listening"
    return 1
  fi

  redirect_code="$(curl -sI --max-time 10 "http://${server_ip}/login" 2>/dev/null \
    | tr -d '\r' | awk 'toupper($1)=="HTTP/" && $2 ~ /^301|302$/ {print $2; exit}')"
  if [[ -z "$redirect_code" ]]; then
    echo "HTTP to HTTPS redirect missing"
    return 1
  fi

  css_code="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "${https_url}/css/enterprise-theme.css" 2>/dev/null || echo '000')"
  if [[ "$css_code" != "200" ]]; then
    echo "HTTPS CSS check failed (${css_code})"
    return 1
  fi

  css_code="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "${https_url}/vendor/fontawesome/css/all.min.css" 2>/dev/null || echo '000')"
  if [[ "$css_code" != "200" ]]; then
    echo "HTTPS vendor CSS check failed (${css_code})"
    return 1
  fi

  return 0
}

verify_https_deployment() {
  verify_https_only_deployment "$@"
}

verify_dual_stack_deployment() {
  verify_https_only_deployment "$@"
}
