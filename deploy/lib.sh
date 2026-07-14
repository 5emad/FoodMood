#!/usr/bin/env bash
# FoodMood deploy shared helpers (sourced by install.sh / update.sh)
# Do not run directly.

: "${INSTALL_DIR:=/opt/food}"
: "${APP_USER:=foodapp}"
: "${SERVICE_NAME:=foodmood}"
: "${DB_NAME:=food_ordering}"

if ! declare -F log_info >/dev/null 2>&1; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  NC='\033[0m'
  log_info() { echo -e "${CYAN}[*]${NC} $*"; }
  log_ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
  log_warn() { echo -e "${YELLOW}[!]${NC} $*"; }
  log_err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
fi

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
  echo "${ip:-127.0.0.1}"
}

url_encode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote_plus(sys.argv[1]))' "$1"
}

parse_mongo_uri_credentials() {
  local uri="$1"
  python3 - "$uri" <<'PY'
import sys, urllib.parse
uri = sys.argv[1]
if not uri.startswith('mongodb://'):
    sys.exit(1)
rest = uri[len('mongodb://'):]
if '@' not in rest:
    sys.exit(1)
creds, _ = rest.split('@', 1)
if ':' not in creds:
    sys.exit(1)
user, pwd = creds.split(':', 1)
print(urllib.parse.unquote_plus(user))
print(urllib.parse.unquote_plus(pwd))
PY
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
  ss -tln 2>/dev/null | awk '$4 ~ /:27017$/ {found=1} END{exit !found}'
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
    systemctl enable mongod 2>/dev/null || true
    systemctl start mongod 2>/dev/null || true
    sleep 2
    mongo_ping_server && server_up=1
    if [[ "$server_up" -ne 1 ]]; then
      systemctl restart mongod 2>/dev/null || true
      sleep 2
      mongo_ping_server && server_up=1
    fi
    if [[ "$server_up" -ne 1 ]] && ! mongo_port_listening; then
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
  for ((i = 1; i <= attempts; i++)); do
    if [[ -n "$uri" ]]; then
      mongo_ping "$uri" && return 0
    else
      mongo_ping_server && return 0
    fi
    if (( i % 5 == 0 )); then
      ensure_mongod_running "" || true
    fi
    sleep 2
  done
  log_err "${label} did not become ready in time."
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

mongodb_enable_auth() {
  local conf="/etc/mongod.conf"
  [[ -f "$conf" ]] || return 1
  if ! grep -qE '^security:' "$conf" 2>/dev/null; then
    printf '\nsecurity:\n  authorization: enabled\n' >> "$conf"
  elif ! grep -qE 'authorization:[[:space:]]*enabled' "$conf" 2>/dev/null; then
    sed -i 's/authorization:.*/  authorization: enabled/' "$conf" 2>/dev/null || true
  fi
  systemctl restart mongod
}

test_mongodb_uri_from_env() {
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node -e \"
require('dotenv').config();
const mongoose = require('mongoose');
const uri = process.env.MONGODB_URI || '';
if (!uri) { console.log('MISSING_URI'); process.exit(2); }
mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 })
  .then(() => mongoose.connection.db.admin().command({ ping: 1 }))
  .then(() => { console.log('OK'); return mongoose.disconnect(); })
  .catch((e) => { console.log('FAIL:' + (e.message || e)); process.exit(1); });
\"" 2>&1 || true
}

repair_mongodb_from_env() {
  local env_file="${INSTALL_DIR}/.env"
  local uri mongo_user mongo_pass tmp_js encoded_pass new_uri

  [[ -f "$env_file" ]] || return 1
  uri="$(grep '^MONGODB_URI=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -z "$uri" ]]; then
    log_err "MONGODB_URI is missing in .env"
    return 1
  fi

  local test_result
  test_result="$(test_mongodb_uri_from_env)"
  if [[ "$test_result" == "OK" ]]; then
    log_ok "MongoDB connection OK (.env credentials)"
    return 0
  fi

  log_warn "MongoDB connection failed (${test_result#FAIL:}) — attempting repair..."
  if ! ensure_mongod_running ""; then
    log_err "mongod is not running"
    return 1
  fi

  test_result="$(test_mongodb_uri_from_env)"
  if [[ "$test_result" == "OK" ]]; then
    log_ok "MongoDB connection OK after mongod restart"
    return 0
  fi

  mapfile -t _creds < <(parse_mongo_uri_credentials "$uri" 2>/dev/null || true)
  if [[ "${#_creds[@]}" -lt 2 ]]; then
    log_err "Cannot parse MongoDB credentials from MONGODB_URI"
    return 1
  fi
  mongo_user="${_creds[0]}"
  mongo_pass="${_creds[1]}"

  if mongo_ping "$uri"; then
    log_ok "MongoDB shell auth OK — app may need foodmood restart"
    return 0
  fi

  log_warn "Resetting MongoDB user '${mongo_user}' from .env credentials..."
  mongodb_strip_auth_and_restart || return 1

  if mongo_user_exists "" "$mongo_user"; then
    mongo_set_user_password "$mongo_user" "$mongo_pass"
  else
    tmp_js="$(mongo_create_user_js "$mongo_user" "$mongo_pass" "$DB_NAME")"
    mongosh --quiet "$DB_NAME" --file "$tmp_js"
    rm -f "$tmp_js"
  fi

  mongodb_enable_auth || return 1
  encoded_pass="$(url_encode "$mongo_pass")"
  new_uri="mongodb://${mongo_user}:${encoded_pass}@127.0.0.1:27017/${DB_NAME}?authSource=${DB_NAME}"
  wait_for_mongodb "MongoDB (authenticated)" "$new_uri" 30 || return 1

  if ! mongo_ping "$new_uri"; then
    log_err "MongoDB repair failed — run install.sh again or reset-mongodb.sh"
    return 1
  fi

  if grep -q '^MONGODB_URI=' "$env_file" 2>/dev/null; then
    sed -i "s|^MONGODB_URI=.*|MONGODB_URI=${new_uri}|" "$env_file"
  else
    echo "MONGODB_URI=${new_uri}" >> "$env_file"
  fi
  chown "$APP_USER:$APP_USER" "$env_file"
  chmod 600 "$env_file"

  test_result="$(test_mongodb_uri_from_env)"
  if [[ "$test_result" == "OK" ]]; then
    log_ok "MongoDB repaired and .env verified"
    return 0
  fi

  log_err "MongoDB repair finished but app still cannot connect"
  return 1
}

ensure_services_running() {
  systemctl enable mongod nginx "$SERVICE_NAME" 2>/dev/null || true
  systemctl start mongod 2>/dev/null || systemctl restart mongod 2>/dev/null || true
  systemctl start nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
}

wait_for_api_health() {
  local attempts="${1:-30}"
  local i body
  for ((i = 1; i <= attempts; i++)); do
    body="$(curl -sf --max-time 5 http://127.0.0.1:3000/api/system/health 2>/dev/null || curl -s --max-time 5 http://127.0.0.1:3000/api/system/health 2>/dev/null || true)"
    if echo "$body" | grep -q '"healthy":[[:space:]]*true'; then
      return 0
    fi
    if (( i % 5 == 0 )); then
      ensure_mongod_running "" || true
      systemctl restart "$SERVICE_NAME" 2>/dev/null || true
    fi
    sleep 2
  done
  return 1
}

read_installed_version() {
  local pkg="${INSTALL_DIR}/package.json"
  if [[ -f "$pkg" ]]; then
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("version","?"))' "$pkg" 2>/dev/null || echo "?"
  else
    echo "?"
  fi
}

test_login_api() {
  local server_ip="$1"
  local login_code login_msg
  login_code="$(curl -s -o /tmp/food-login-probe.json -w '%{http_code}' --max-time 10 \
    -X POST http://127.0.0.1:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -H "Origin: https://${server_ip}" \
    -d '{"username":"probe","password":"probe"}' 2>/dev/null || echo '000')"
  login_msg="$(python3 -c 'import json; print(json.load(open("/tmp/food-login-probe.json", encoding="utf-8")).get("message",""))' 2>/dev/null || true)"
  echo "${login_code}|${login_msg}"
}

verify_fonts_and_site() {
  local server_ip="$1"
  local node_font https_login https_css
  node_font="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/vendor/vazirmatn/Vazirmatn-Regular.woff2 2>/dev/null || echo '000')"
  https_login="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "https://${server_ip}/login" 2>/dev/null || echo '000')"
  https_css="$(curl -skf -o /dev/null -w '%{http_code}' --max-time 15 "https://${server_ip}/css/enterprise-theme.css" 2>/dev/null || echo '000')"
  echo "node_font=${node_font} https_login=${https_login} https_css=${https_css}"
}

reset_superadmin_credentials() {
  local username="$1" password="$2"
  if [[ -z "$username" || -z "$password" ]]; then
    return 1
  fi
  log_info "Resetting superadmin credentials for '${username}'..."
  local output
  if output="$(sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node scripts/super-admin.js reset-credentials $(printf '%q' "$username") $(printf '%q' "$password")" 2>&1)"; then
    log_ok "Superadmin credentials updated"
    echo "$output" | sed 's/^/  /'
    return 0
  fi
  if echo "$output" | grep -qi 'reset-credentials'; then
    log_warn "reset-credentials not in script yet — trying create..."
    if output="$(sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node scripts/super-admin.js create $(printf '%q' "$username") $(printf '%q' "$password")" 2>&1)"; then
      log_ok "Superadmin created"
      echo "$output" | sed 's/^/  /'
      return 0
    fi
  fi
  log_err "Superadmin reset failed: $output"
  return 1
}

run_diagnose() {
  local server_ip="$1"
  local mongod_state food_state health_json login_probe

  echo ""
  echo -e "${BOLD}FoodMood diagnosis${NC}"
  echo -e "Server: ${server_ip}  |  Path: ${INSTALL_DIR}"
  echo ""

  mongod_state="$(systemctl is-active mongod 2>/dev/null || echo inactive)"
  food_state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo inactive)"
  echo "  mongod:   ${mongod_state}"
  echo "  foodmood: ${food_state}"
  echo "  nginx:    $(systemctl is-active nginx 2>/dev/null || echo inactive)"
  echo "  version:  v$(read_installed_version)"

  ensure_mongod_running "" || true
  if mongo_ping_server; then
    log_ok "mongod ping OK"
  else
    log_err "mongod not responding"
  fi

  local mongo_test
  mongo_test="$(test_mongodb_uri_from_env)"
  case "$mongo_test" in
    OK) log_ok "App MongoDB connection OK" ;;
    MISSING_URI) log_err "MONGODB_URI missing" ;;
    FAIL:*) log_err "App MongoDB failed: ${mongo_test#FAIL:}" ;;
    *) log_err "MongoDB test failed: $mongo_test" ;;
  esac

  health_json="$(curl -s --max-time 8 http://127.0.0.1:3000/api/system/health 2>/dev/null || echo '{}')"
  echo "  health: ${health_json}"
  if echo "$health_json" | grep -q '"healthy":true'; then
    log_ok "API healthy"
  else
    log_warn "API unhealthy — login shows «در دسترس نیست»"
  fi

  login_probe="$(test_login_api "$server_ip")"
  echo "  login probe: HTTP ${login_probe%%|*} — ${login_probe#*|}"
  if [[ "${login_probe%%|*}" == "401" || "${login_probe%%|*}" == "400" ]]; then
    log_ok "Login API reachable"
  elif [[ "${login_probe%%|*}" == "503" ]] || echo "${login_probe#*|}" | grep -q 'در دسترس نمی'; then
    log_err "Login blocked — MongoDB/service issue"
  fi

  verify_fonts_and_site "$server_ip" | sed 's/^/  /'
  echo ""
}

ensure_chrome_for_pdf() {
  local chrome_bin=""
  chrome_bin="$(pdf_browser_path || true)"
  if [[ -n "$chrome_bin" ]]; then
    configure_chrome_bin "$chrome_bin"
    log_ok "PDF browser ready: ${chrome_bin}"
    return 0
  fi

  log_info "Downloading Chrome for PDF from npmmirror (no Puppeteer)..."
  chrome_bin="$(install_chrome_from_mirror || true)"
  if [[ -n "$chrome_bin" && -x "$chrome_bin" ]]; then
    configure_chrome_bin "$chrome_bin"
    log_ok "PDF browser installed from mirror: ${chrome_bin}"
    return 0
  fi

  log_warn "Mirror failed — trying Google Chrome .deb..."
  if install_google_chrome_deb && [[ -x /usr/bin/google-chrome-stable ]]; then
    configure_chrome_bin "/usr/bin/google-chrome-stable"
    log_ok "PDF browser: /usr/bin/google-chrome-stable"
    return 0
  fi

  log_err "Could not install PDF browser"
  return 1
}

pdf_browser_path() {
  local env_file="${INSTALL_DIR}/.env" chrome_bin
  if [[ -f "$env_file" ]]; then
    chrome_bin="$(grep '^CHROME_BIN=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
    if [[ -n "$chrome_bin" && -x "$chrome_bin" && "$chrome_bin" != *"/snap/"* ]]; then
      echo "$chrome_bin"
      return 0
    fi
  fi
  if [[ -x "${INSTALL_DIR}/.cache/chrome-linux64/chrome" ]]; then
    echo "${INSTALL_DIR}/.cache/chrome-linux64/chrome"
    return 0
  fi
  if [[ -x /usr/bin/google-chrome-stable ]]; then
    echo "/usr/bin/google-chrome-stable"
    return 0
  fi
  return 1
}

install_chrome_from_mirror() {
  local version="${CHROME_CFT_VERSION:-131.0.6778.85}"
  local cache_dir="${INSTALL_DIR}/.cache"
  local chrome_bin="${cache_dir}/chrome-linux64/chrome"
  local zip="/tmp/chrome-linux64-${version}.zip"
  local url

  if [[ -x "$chrome_bin" ]]; then
    echo "$chrome_bin"
    return 0
  fi

  apt-get install -y -qq unzip curl ca-certificates 2>/dev/null || true
  mkdir -p "$cache_dir"

  for url in \
    "https://cdn.npmmirror.com/binaries/chrome-for-testing/${version}/linux64/chrome-linux64.zip" \
    "https://registry.npmmirror.com/-/binary/chrome-for-testing/${version}/linux64/chrome-linux64.zip"; do
    log_info "Trying ${url} ..."
    if curl -fsSL --connect-timeout 30 --max-time 600 -o "$zip" "$url" && [[ -s "$zip" ]]; then
      rm -rf "${cache_dir}/chrome-linux64"
      if unzip -q -o "$zip" -d "$cache_dir" && [[ -x "$chrome_bin" ]]; then
        chmod +x "$chrome_bin"
        chown -R "${APP_USER}:${APP_USER}" "$cache_dir"
        rm -f "$zip"
        echo "$chrome_bin"
        return 0
      fi
    fi
    rm -f "$zip"
  done
  return 1
}

install_google_chrome_deb() {
  export DEBIAN_FRONTEND=noninteractive
  local chrome_deb="/tmp/google-chrome-stable.deb"
  if curl -fsSL --connect-timeout 30 --max-time 300 -o "$chrome_deb" \
    https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && [[ -s "$chrome_deb" ]]; then
    apt-get install -y -qq "$chrome_deb" 2>/dev/null \
      || { dpkg -i "$chrome_deb" || true; apt-get install -f -y -qq; }
    rm -f "$chrome_deb"
    [[ -x /usr/bin/google-chrome-stable ]]
    return $?
  fi
  rm -f "$chrome_deb"
  return 1
}

configure_chrome_bin() {
  local chrome_bin="$1"
  local env_file="${INSTALL_DIR}/.env"
  [[ -f "$env_file" && -n "$chrome_bin" ]] || return 0
  if grep -q '^CHROME_BIN=' "$env_file" 2>/dev/null; then
    sed -i "s|^CHROME_BIN=.*|CHROME_BIN=${chrome_bin}|" "$env_file"
  else
    echo "CHROME_BIN=${chrome_bin}" >> "$env_file"
  fi
  chown "$APP_USER:$APP_USER" "$env_file"
  chmod 600 "$env_file"
}

configure_chrome_env() {
  local chrome_bin
  chrome_bin="$(pdf_browser_path || true)"
  [[ -n "$chrome_bin" ]] || return 0
  configure_chrome_bin "$chrome_bin"
  log_ok "CHROME_BIN=${chrome_bin}"
}

ensure_pdf_runtime_dirs() {
  local cache_root="${INSTALL_DIR}/.cache/pdf-runtime"
  local uid
  uid="$(id -u "$APP_USER" 2>/dev/null || echo 999)"
  mkdir -p "${cache_root}/config" "${cache_root}/cache" "${cache_root}/run"
  mkdir -p "/run/user/${uid}" 2>/dev/null || true
  chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/.cache" 2>/dev/null || true
  chown "${APP_USER}:${APP_USER}" "/run/user/${uid}" 2>/dev/null || true
  chmod 700 "${cache_root}" "${cache_root}/config" "${cache_root}/cache" "${cache_root}/run" 2>/dev/null || true
  chmod 700 "/run/user/${uid}" 2>/dev/null || true

  cat > /etc/tmpfiles.d/foodmood-runtime.conf <<EOF
d /run/user/${uid} 0700 ${APP_USER} ${APP_USER} -
d ${cache_root}/run 0700 ${APP_USER} ${APP_USER} -
EOF
  systemd-tmpfiles --create /etc/tmpfiles.d/foodmood-runtime.conf 2>/dev/null || true
}

test_pdf_browser() {
  local chrome_bin
  chrome_bin="$(pdf_browser_path || true)"
  [[ -n "$chrome_bin" && -x "$chrome_bin" ]] || return 1
  sudo -u "$APP_USER" bash -c "
    export CHROME_BIN='${chrome_bin}'
    export FOOD_INSTALL_DIR='${INSTALL_DIR}'
    \"\${CHROME_BIN}\" --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage \
      --dump-dom 'data:text/html,<html><body>ok</body></html>' >/dev/null 2>&1
  "
}
