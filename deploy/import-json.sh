#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — import mongoexport JSON folder into food_ordering
#
#  Usage:
#    sudo bash /opt/food/deploy/import-json.sh /path/to/json-20260725-154241
#    sudo bash /opt/food/deploy/import-json.sh /path/to/json-dir --drop
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/food"
DB_NAME="${DB_NAME:-food_ordering}"
SERVICE_NAME="foodmood"
DROP=0
JSON_DIR=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()   { echo -e "${RED}[✗]${NC} $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --drop) DROP=1; shift ;;
    --db) DB_NAME="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *)
      if [[ -z "$JSON_DIR" ]]; then JSON_DIR="$1"; shift
      else log_err "Unknown arg: $1"; exit 1
      fi
      ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  log_err "Run as root"
  exit 1
fi

if [[ -z "$JSON_DIR" || ! -d "$JSON_DIR" ]]; then
  log_err "Pass a directory of .json files (mongoexport --jsonArray)"
  echo "Example: sudo bash $0 /root/json-20260725-154241"
  exit 1
fi

URI="$(grep '^MONGODB_URI=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
if [[ -z "$URI" ]]; then
  log_err "MONGODB_URI missing in ${INSTALL_DIR}/.env"
  exit 1
fi

if ! command -v mongoimport >/dev/null 2>&1; then
  log_err "mongoimport not found — install mongodb-database-tools"
  exit 1
fi

echo ""
log_info "Scanning ${JSON_DIR}"
mapfile -t FILES < <(find "$JSON_DIR" -maxdepth 1 -type f -name '*.json' | sort)
if [[ "${#FILES[@]}" -eq 0 ]]; then
  log_err "No .json files in ${JSON_DIR}"
  exit 1
fi

empty=0
nonempty=0
for f in "${FILES[@]}"; do
  size="$(wc -c <"$f" | tr -d ' ')"
  name="$(basename "$f")"
  if [[ "$size" -lt 5 ]]; then
    log_warn "${name}: empty (${size} bytes) — skip"
    empty=$((empty + 1))
  else
    log_info "${name}: ${size} bytes"
    nonempty=$((nonempty + 1))
  fi
done

if [[ "$nonempty" -lt 1 ]]; then
  log_err "All JSON files are empty — nothing to import."
  log_err "This folder was exported from an already-empty database."
  log_err "You need an older .archive backup or Docker volume dump."
  exit 1
fi

systemctl stop "$SERVICE_NAME" 2>/dev/null || true

imported=0
for f in "${FILES[@]}"; do
  size="$(wc -c <"$f" | tr -d ' ')"
  [[ "$size" -lt 5 ]] && continue
  base="$(basename "$f" .json)"
  # map common aliases
  coll="$base"
  case "$base" in
    appsettings|AppSetting|appSettings) coll="appsettings" ;;
    foodcategories|FoodCategory|foodCategories) coll="foodcategories" ;;
    dailymenus|DailyMenu|dailyMenus) coll="dailymenus" ;;
    menuitems|MenuItem|menuItems) coll="menuitems" ;;
    ldapprofiles|LdapProfile|ldapProfiles) coll="ldapprofiles" ;;
    securitylogs|SecurityLog|securityLogs) coll="securitylogs" ;;
    announcements|Announcement) coll="announcements" ;;
  esac

  args=(--uri="$URI" --db="$DB_NAME" --collection="$coll" --file="$f" --jsonArray)
  if [[ "$DROP" -eq 1 ]]; then
    args+=(--drop)
  else
    args+=(--mode=upsert --upsertFields=_id)
  fi

  log_info "Import ${base} → ${DB_NAME}.${coll}"
  if mongoimport "${args[@]}" ; then
    imported=$((imported + 1))
    log_ok "Imported ${coll}"
  else
    # retry without upsert if schema lacks _id uniqueness issues
    if mongoimport --uri="$URI" --db="$DB_NAME" --collection="$coll" --file="$f" --jsonArray ${DROP:+--drop}; then
      imported=$((imported + 1))
      log_ok "Imported ${coll} (insert)"
    else
      log_warn "Failed: ${f}"
    fi
  fi
done

systemctl start "$SERVICE_NAME" 2>/dev/null || true

echo ""
log_ok "Done. Imported ${imported} collection file(s) into ${DB_NAME}"
mongosh --quiet "$URI" --eval 'db.getCollectionNames().forEach(c => print(c + ": " + db[c].estimatedDocumentCount()))' 2>/dev/null || true
echo ""
log_info "If users exist but you cannot login as superadmin:"
echo "  sudo bash ${INSTALL_DIR}/deploy/restore-data.sh --promote-superadmin 'Food@Super2026!'"
