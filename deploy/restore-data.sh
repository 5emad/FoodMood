#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — find & restore MongoDB backups after bad migrate
#
#  Usage:
#    sudo bash /opt/food/deploy/restore-data.sh --scan
#    sudo bash /opt/food/deploy/restore-data.sh --from /path/to/dump-or-archive
#    sudo bash /opt/food/deploy/restore-data.sh --promote-superadmin 'Food@Super2026!'
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
DB_NAME="${DB_NAME:-food_ordering}"
SERVICE_NAME="foodmood"
SUPERADMIN_USER="${SUPERADMIN_USER:-superadmin}"
SUPERADMIN_PASS=""
SCAN_ONLY=0
FROM_PATH=""
PROMOTE_ONLY=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()   { echo -e "${RED}[✗]${NC} $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scan) SCAN_ONLY=1; shift ;;
    --from) FROM_PATH="$2"; shift 2 ;;
    --promote-superadmin) SUPERADMIN_PASS="$2"; PROMOTE_ONLY=1; shift 2 ;;
    --superadmin-user) SUPERADMIN_USER="$2"; shift 2 ;;
    --db) DB_NAME="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) log_err "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  log_err "Run as root"
  exit 1
fi

load_uri() {
  grep '^MONGODB_URI=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

scan_backups() {
  echo ""
  echo -e "${BOLD}Possible backup locations${NC}"
  echo ""

  log_info "Mongo databases on this host:"
  mongosh --quiet --eval 'db.adminCommand({ listDatabases: 1 }).databases.forEach(d => print("  - " + d.name + "  (" + Math.round(d.sizeOnDisk/1024) + " KB)"))' 2>/dev/null \
    || log_warn "Cannot list DBs (auth?). Try with URI from .env"

  echo ""
  log_info "Collections in ${DB_NAME}:"
  local uri
  uri="$(load_uri)"
  if [[ -n "$uri" ]]; then
    mongosh --quiet "$uri" --eval 'db.getCollectionNames().forEach(c => { const n=db[c].estimatedDocumentCount(); print("  - " + c + ": " + n); })' 2>/dev/null \
      || true
    echo ""
    log_info "Users sample (roles):"
    mongosh --quiet "$uri" --eval 'db.users.find({}, {username:1, role:1, status:1}).limit(20).forEach(u => print("  - " + u.username + "  role=" + u.role + "  status=" + u.status))' 2>/dev/null \
      || true
  fi

  echo ""
  log_info "Filesystem backups:"
  ls -lah /var/backups/foodmood-docker-migrate-* 2>/dev/null || true
  ls -lah /var/backups/foodmood-* 2>/dev/null || true
  ls -lah "${INSTALL_DIR}/backups/" 2>/dev/null || true
  find /var/backups /opt/food/backups /tmp -maxdepth 3 \( -name 'mongodump' -o -name 'docker-exit-*.archive' -o -name '*.archive' -o -name 'food_ordering' \) 2>/dev/null \
    | head -40 || true

  echo ""
  log_info "Docker volumes (if engine still installed):"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker volume ls 2>/dev/null | grep -i food || true
    docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | head -20 || true
  else
    echo "  (docker not available)"
  fi

  echo ""
  log_warn "If data is in DB food_reservation by mistake, restore with:"
  echo "  sudo bash $0 --from /opt/food/backups/docker-exit-XXXX.archive --db food_ordering"
  echo "  (script maps archive into food_ordering)"
}

restore_from() {
  local src="$1"
  local uri
  uri="$(load_uri)"
  if [[ -z "$uri" ]]; then
    log_err "MONGODB_URI missing in ${INSTALL_DIR}/.env"
    exit 1
  fi
  if [[ ! -e "$src" ]]; then
    log_err "Path not found: $src"
    exit 1
  fi

  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  log_info "Restoring into ${DB_NAME} from ${src}…"

  if [[ -f "$src" && "$src" == *.archive ]]; then
    # May have been dumped as wrong db name; force nsFrom/nsTo when possible
    if mongorestore --uri="$uri" --archive="$src" --gzip --drop --nsFrom='food_reservation.*' --nsTo="${DB_NAME}.*" 2>/dev/null \
      || mongorestore --uri="$uri" --archive="$src" --gzip --drop --nsFrom='food_ordering.*' --nsTo="${DB_NAME}.*" 2>/dev/null \
      || mongorestore --uri="$uri" --archive="$src" --gzip --drop --db="$DB_NAME" 2>/dev/null; then
      log_ok "Archive restored"
    else
      # try without gzip
      mongorestore --uri="$uri" --archive="$src" --drop --db="$DB_NAME" \
        || { log_err "mongorestore failed"; exit 1; }
      log_ok "Archive restored (uncompressed)"
    fi
  elif [[ -d "$src" ]]; then
    local dump_dir="$src"
    [[ -d "${src}/food_ordering" ]] && dump_dir="${src}/food_ordering"
    [[ -d "${src}/food_reservation" ]] && dump_dir="${src}/food_reservation"
    mongorestore --uri="$uri" --drop --db="$DB_NAME" "$dump_dir" \
      || { log_err "mongorestore dir failed"; exit 1; }
    log_ok "Directory dump restored → ${DB_NAME}"
  else
    log_err "Unsupported backup format: $src"
    exit 1
  fi

  systemctl start "$SERVICE_NAME" 2>/dev/null || true
  log_ok "Service restarted"
}

promote_superadmin() {
  local pass="$1"
  if [[ -z "$pass" ]]; then
    log_err "Password required"
    exit 1
  fi
  sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node backend/scripts/super-admin.js reset-credentials $(printf '%q' "$SUPERADMIN_USER") $(printf '%q' "$pass")"
}

if [[ "$SCAN_ONLY" -eq 1 ]]; then
  scan_backups
  exit 0
fi

if [[ "$PROMOTE_ONLY" -eq 1 ]]; then
  promote_superadmin "$SUPERADMIN_PASS"
  exit 0
fi

if [[ -n "$FROM_PATH" ]]; then
  restore_from "$FROM_PATH"
  if [[ -n "$SUPERADMIN_PASS" ]]; then
    promote_superadmin "$SUPERADMIN_PASS"
  fi
  scan_backups
  exit 0
fi

scan_backups
echo ""
log_info "Next steps:"
echo "  1) Pick a backup path from the list above"
echo "  2) sudo bash $0 --from /path/to/backup"
echo "  3) sudo bash $0 --promote-superadmin 'Food@Super2026!'"
