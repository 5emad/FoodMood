#!/usr/bin/env bash
# Deprecated — vendor sync is included in update.sh
echo "[!] sync-vendor.sh is deprecated. Run update instead:"
echo "    curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/update.sh | sudo bash"
exec "$(dirname "$0")/update.sh" "$@"
