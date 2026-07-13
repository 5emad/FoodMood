#!/usr/bin/env bash
# One-line FoodMood install from GitHub on a fresh Ubuntu/Debian server
#
# Recommended:
#   curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh -o /tmp/food-bootstrap.sh
#   sudo bash /tmp/food-bootstrap.sh
#
# One-liner (auto re-downloads when piped so prompts work):
#   curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh | sudo bash
#
# Full interactive install (more prompts):
#   curl -fsSL .../bootstrap.sh | sudo bash -s -- --full
#
# Private repo with token:
#   sudo bash bootstrap.sh --repo https://<TOKEN>@github.com/5emad/FoodMood.git
#
# Specific version:
#   curl -fsSL .../bootstrap.sh | sudo bash -s -- --tag v1.1.0
#
# Options:
#   --repo <url>     Git repository URL (default: project GitHub repo)
#   --branch <name>  Branch (default: main)
#   --tag <vX.Y.Z>   Specific tag (e.g. v1.1.0) — overrides branch
#   --quick|-q       Quick install (default): MongoDB only, then auto
#   --full           Full interactive install (SSL, firewall, superadmin prompts)
set -euo pipefail

BOOTSTRAP_SOURCE_URL="${BOOTSTRAP_SOURCE_URL:-https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh}"

# curl | bash leaves stdin closed (EOF) — re-run from a file with /dev/tty as stdin
if [[ ! -t 0 ]] && [[ -z "${FOODMOOD_BOOTSTRAP_REEXEC:-}" ]]; then
  export FOODMOOD_BOOTSTRAP_REEXEC=1
  reexec_script="$(mktemp /tmp/food-bootstrap-XXXXXX.sh)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$BOOTSTRAP_SOURCE_URL" -o "$reexec_script"
  else
    echo "[✗] curl is required for one-line install. Or download bootstrap.sh manually." >&2
    exit 1
  fi
  chmod +x "$reexec_script"
  exec bash "$reexec_script" "$@" </dev/tty
fi

REPO_URL="${REPO_URL:-https://github.com/5emad/FoodMood.git}"
BRANCH="main"
GIT_REF=""
QUICK_FLAG="--quick"
FULL_MODE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)   REPO_URL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --tag)    GIT_REF="$2"; shift 2 ;;
    --quick|-q) QUICK_FLAG="--quick"; shift ;;
    --full)   FULL_MODE=1; QUICK_FLAG=""; shift ;;
    *) shift ;;
  esac
done

[[ -n "$GIT_REF" ]] && BRANCH="$GIT_REF"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "[✗] Must run as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq git; }

CLONE_DIR="$(mktemp -d /tmp/food-install-XXXXXX)"
trap 'rm -rf "$CLONE_DIR"' EXIT

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ▶ Step 0/17: Fetch source from GitHub"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[*] Repository: ${REPO_URL}"
echo "[*] Ref: ${BRANCH}"
if [[ -n "$QUICK_FLAG" ]]; then
  echo "[*] Mode: quick install (MongoDB credentials only, then automatic)"
else
  echo "[*] Mode: full interactive install"
fi
echo "[*] Cloning — may take 30 seconds to 2 minutes..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ▶ Starting install-ubuntu.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "$CLONE_DIR/deploy/install-ubuntu.sh" $QUICK_FLAG </dev/tty
