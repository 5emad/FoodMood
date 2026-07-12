#!/usr/bin/env bash
# انتشار نسخه جدید FoodMood (برای نگهدارنده مخزن)
#
# استفاده:
#   bash deploy/release.sh 1.2.0
#   bash deploy/release.sh 1.2.0 "fix(auth): session idle timeout tweak"
#
# کارها:
#   1) به‌روزرسانی version در package.json
#   2) ثبت در CHANGELOG.md (بخش Unreleased → نسخه جدید)
#   3) کامیت، تگ vX.Y.Z، push به GitHub
#
# پیش‌نیاز: working tree تمیز، دسترسی push به origin
set -euo pipefail

VERSION="${1:-}"
SUMMARY="${2:-}"
REPO_URL="${REPO_URL:-https://github.com/5emad/FoodMood.git}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[*]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
log_err()  { echo -e "${RED}[✗]${NC} $*" >&2; }

if [[ -z "$VERSION" ]]; then
  echo "Usage: bash deploy/release.sh <major.minor.patch> [changelog-summary]"
  echo "Example: bash deploy/release.sh 1.2.0 \"feat(admin): export orders CSV\""
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log_err "نسخه باید semver باشد: 1.2.0"
  exit 1
fi

TAG="v${VERSION}"
TODAY="$(date +%Y-%m-%d)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  log_err "working tree باید تمیز باشد. ابتدا تغییرات را commit کنید."
  git status --short
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  log_err "تگ ${TAG} از قبل وجود دارد."
  exit 1
fi

CURRENT="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
log_info "نسخه فعلی: ${CURRENT} → ${VERSION}"

python3 - "$VERSION" <<'PY'
import json, sys
path = "package.json"
data = json.load(open(path, encoding="utf-8"))
data["version"] = sys.argv[1]
json.dump(data, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
open(path, "a", encoding="utf-8").write("\n")
PY

if [[ -f package-lock.json ]]; then
  npm install --package-lock-only --omit=dev >/dev/null 2>&1 || true
fi

if [[ -f CHANGELOG.md ]]; then
  if grep -q '^## \[Unreleased\]' CHANGELOG.md; then
    entry="## [${VERSION}] - ${TODAY}"
    [[ -n "$SUMMARY" ]] && entry="${entry}\n\n### Changed\n- ${SUMMARY}"
    python3 - "$VERSION" "$TODAY" "$SUMMARY" <<'PY'
import sys, pathlib
version, today, summary = sys.argv[1:4]
text = pathlib.Path("CHANGELOG.md").read_text(encoding="utf-8")
block = f"## [{version}] - {today}\n"
if summary.strip():
    block += f"\n### Changed\n- {summary.strip()}\n"
text = text.replace("## [Unreleased]\n\n", f"## [Unreleased]\n\n{block}\n", 1)
pathlib.Path("CHANGELOG.md").write_text(text, encoding="utf-8")
PY
  fi
fi

git add package.json package-lock.json CHANGELOG.md 2>/dev/null || git add package.json CHANGELOG.md

git commit -m "$(cat <<EOF
chore(release): bump version to ${VERSION}

${SUMMARY:-Routine release.}
EOF
)"

git tag -a "$TAG" -m "FoodMood ${TAG}"

log_ok "تگ ${TAG} ساخته شد."
echo ""
echo -e "${BOLD}برای انتشار در GitHub:${NC}"
echo "  git push origin main"
echo "  git push origin ${TAG}"
echo ""
echo -e "${BOLD}سرورها برای دریافت این نسخه:${NC}"
echo "  sudo bash /opt/food/deploy/update.sh --tag ${TAG}"
echo ""
