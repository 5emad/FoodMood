#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  FoodMood — emergency unlock (WAF off + superadmin reset + DB scan)
#
#  Usage:
#    sudo bash /opt/food/deploy/emergency-unlock.sh
#    sudo bash /opt/food/deploy/emergency-unlock.sh --pass 'Food@Super2026!'
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="/opt/food"
APP_USER="foodapp"
SERVICE_NAME="foodmood"
SUPERADMIN_USER="${SUPERADMIN_USER:-superadmin}"
SUPERADMIN_PASS="${SUPERADMIN_PASS:-Food@Super2026!}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pass|--password) SUPERADMIN_PASS="$2"; shift 2 ;;
    --user) SUPERADMIN_USER="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

ENV_FILE="${INSTALL_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

echo "[*] Disabling WAF via env…"
if grep -q '^WAF_ENABLED=' "$ENV_FILE"; then
  sed -i 's/^WAF_ENABLED=.*/WAF_ENABLED=false/' "$ENV_FILE"
else
  echo 'WAF_ENABLED=false' >> "$ENV_FILE"
fi
# Keep loopback trusted for later re-enable
grep -q '^TRUSTED_PROXIES=' "$ENV_FILE" || echo 'TRUSTED_PROXIES=127.0.0.1,::1' >> "$ENV_FILE"
grep -q '^WAF_TRUSTED_PROXIES=' "$ENV_FILE" || echo 'WAF_TRUSTED_PROXIES=127.0.0.1,::1' >> "$ENV_FILE"

URI="$(grep '^MONGODB_URI=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r' || true)"

echo "[*] Forcing wafEnabled=false in Mongo…"
if [[ -n "$URI" ]]; then
  mongosh --quiet "$URI" --eval '
    db.appsettings.updateOne(
      { key: "default" },
      { $set: { wafEnabled: false, updatedAt: new Date() } },
      { upsert: true }
    );
    print("wafEnabled set false");
  ' 2>/dev/null || echo "[!] mongosh update skipped"
fi

echo "[*] Resetting superadmin credentials…"
sudo -u "$APP_USER" bash -c "cd '$INSTALL_DIR' && node backend/scripts/super-admin.js reset-credentials $(printf '%q' "$SUPERADMIN_USER") $(printf '%q' "$SUPERADMIN_PASS")" \
  || echo "[!] super-admin reset failed — see errors above"

echo "[*] Restarting ${SERVICE_NAME}…"
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl is-active --quiet "$SERVICE_NAME" && echo "[✓] Service active" || echo "[!] Service not active"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Login with:"
echo "    Username : ${SUPERADMIN_USER}"
echo "    Password : ${SUPERADMIN_PASS}"
echo "  (Second-factor token was printed above — save it)"
echo "  WAF is OFF until you re-enable it in Super → Security"
echo "════════════════════════════════════════════════════════"
echo ""

if [[ -n "$URI" ]]; then
  echo "[*] Database counts:"
  mongosh --quiet "$URI" --eval '
    const names = db.getCollectionNames();
    if (!names.length) print("  (EMPTY DATABASE)");
    names.forEach(c => print("  - " + c + ": " + db[c].estimatedDocumentCount()));
    print("---");
    db.users.find({}, {username:1, role:1, status:1}).limit(20).forEach(u =>
      print("  user: " + u.username + " role=" + u.role + " status=" + u.status)
    );
  ' 2>/dev/null || true
  echo ""
  echo "If counts are 0, previous data is not here. Scan backups:"
  echo "  sudo bash ${INSTALL_DIR}/deploy/restore-data.sh --scan"
fi
