#!/usr/bin/env bash
# FoodMood one-command install on Ubuntu/Debian
#
# Quick install (zero prompts — credentials auto-generated, shown at end):
#   curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh -o /tmp/food-bootstrap.sh
#   sudo bash /tmp/food-bootstrap.sh
#
# Quick with your MongoDB credentials:
#   sudo MONGO_USER=foodadmin MONGO_PASS='YourPass123!' bash /tmp/food-bootstrap.sh
#   sudo bash /tmp/food-bootstrap.sh --mongo-user foodadmin --mongo-pass 'YourPass123!'
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh | sudo bash
#
# Full interactive (SSL, firewall, prompts):
#   sudo bash /tmp/food-bootstrap.sh --full
set -euo pipefail

BOOTSTRAP_SOURCE_URL="${BOOTSTRAP_SOURCE_URL:-https://raw.githubusercontent.com/5emad/FoodMood/main/deploy/bootstrap.sh}"

if [[ ! -t 0 ]] && [[ -z "${FOODMOOD_BOOTSTRAP_REEXEC:-}" ]]; then
  export FOODMOOD_BOOTSTRAP_REEXEC=1
  reexec_script="$(mktemp /tmp/food-bootstrap-XXXXXX.sh)"
  curl -fsSL "$BOOTSTRAP_SOURCE_URL" -o "$reexec_script"
  chmod +x "$reexec_script"
  exec bash "$reexec_script" "$@" </dev/tty
fi

REPO_URL="${REPO_URL:-https://github.com/5emad/FoodMood.git}"
BRANCH="main"
GIT_REF=""
QUICK_FLAG="--quick"
FULL_MODE=0
MONGO_USER_ARG=""
MONGO_PASS_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)        REPO_URL="$2"; shift 2 ;;
    --branch)      BRANCH="$2"; shift 2 ;;
    --tag)         GIT_REF="$2"; shift 2 ;;
    --quick|-q)    QUICK_FLAG="--quick"; shift ;;
    --full)        FULL_MODE=1; QUICK_FLAG=""; shift ;;
    --mongo-user)  MONGO_USER_ARG="$2"; shift 2 ;;
    --mongo-pass)  MONGO_PASS_ARG="$2"; shift 2 ;;
    --ask-mongo)   ASK_MONGO_FLAG="--ask-mongo"; shift ;;
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

INSTALL_ARGS=()
[[ -n "$QUICK_FLAG" ]] && INSTALL_ARGS+=("$QUICK_FLAG")
[[ -n "${ASK_MONGO_FLAG:-}" ]] && INSTALL_ARGS+=("$ASK_MONGO_FLAG")
[[ -n "$MONGO_USER_ARG" ]] && INSTALL_ARGS+=(--mongo-user "$MONGO_USER_ARG")
[[ -n "$MONGO_PASS_ARG" ]] && INSTALL_ARGS+=(--mongo-pass "$MONGO_PASS_ARG")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ▶ Step 0/17: Fetch source from GitHub"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[*] Repository: ${REPO_URL}"
echo "[*] Ref: ${BRANCH}"
if [[ -n "$QUICK_FLAG" ]]; then
  if [[ -n "${MONGO_USER:-}" || -n "$MONGO_USER_ARG" ]]; then
    echo "[*] Mode: quick install (using provided MongoDB credentials)"
  else
    echo "[*] Mode: quick install (auto credentials — no prompts)"
  fi
else
  echo "[*] Mode: full interactive install"
fi
echo "[*] Cloning — may take 30 seconds to 2 minutes..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ▶ Starting install-ubuntu.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

set +e
bash "${CLONE_DIR}/deploy/install-ubuntu.sh" "${INSTALL_ARGS[@]}"
install_status=$?
set -e

if [[ "$install_status" -ne 0 ]]; then
  echo "[✗] Installer failed (exit ${install_status}). See messages above." >&2
  exit "$install_status"
fi
