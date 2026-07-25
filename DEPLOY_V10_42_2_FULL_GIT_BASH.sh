#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
REPO_URL="https://github.com/damolax/Scout-app.git"
BRANCH="main"
WORK_DIR="${HOME}/scout-v10-42-deploy"
EXPECTED_VERSION="10.42.2"
EXPECTED_BUILD="pending-delete-cancelled-import-unlock-hotfix"
LIVE_URL="${SCOUT_LIVE_URL:-https://scout-app-oyeola.vercel.app}"

fail(){ echo; echo "ERROR: $*" >&2; return 1; }
on_error(){
  local exit_code="$1" line_number="$2" failed_command="$3"
  trap - ERR
  echo >&2
  echo "ERROR: Deployment stopped at line ${line_number}." >&2
  echo "Failed command: ${failed_command}" >&2
  echo "GitHub was not updated unless the push step had already completed." >&2
  exit "$exit_code"
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

command -v git >/dev/null || fail "Git is not installed."
command -v npm >/dev/null || fail "Node.js/npm is not installed."
command -v node >/dev/null || fail "Node.js is not installed."
[ -f "$SOURCE_DIR/package.json" ] || fail "package.json not found in $SOURCE_DIR"
[ -f "$SOURCE_DIR/RUN_THIS_V10_42_2_PENDING_DELETE_UNLOCK_IN_CURRENT_SUPABASE.sql" ] || fail "v10.42.2 hotfix SQL is missing."
[ -f "$SOURCE_DIR/SCOUT_V10_42_ONE_SCREEN_SETUP_WIZARD.html" ] || fail "The one-screen deployment wizard is missing."

ACTUAL_VERSION="$(cd "$SOURCE_DIR" && node -p "require('./package.json').version")"
[ "$ACTUAL_VERSION" = "$EXPECTED_VERSION" ] || fail "Expected Scout $EXPECTED_VERSION but package.json says $ACTUAL_VERSION."
grep -Fq "$REPO_URL" "$SOURCE_DIR/DEPLOY_V10_42_2_FULL_GIT_BASH.sh" || fail "Deployment target verification failed."

echo "Target repository: $REPO_URL"
echo "Target branch:     $BRANCH"
echo "Source version:    $ACTUAL_VERSION"
echo

rm -rf "$WORK_DIR"
git clone "$REPO_URL" "$WORK_DIR"
cd "$WORK_DIR"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

BACKUP_BRANCH="backup-before-v10-42-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
git push origin "$BACKUP_BRANCH"

find "$WORK_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$SOURCE_DIR"/. "$WORK_DIR"/
rm -rf node_modules .next tsconfig.tsbuildinfo

npm config set fetch-retries 5
npm config set fetch-retry-mintimeout 2000
npm config set fetch-retry-maxtimeout 20000
npm ci
npm run verify:static
npm run verify:sql-contract
npm run typecheck
npm run build

git add -A
if git diff --cached --quiet; then
  echo "No source changes were detected. GitHub main already matches this package."
else
  git commit -m "Fix pending no-email deletion and unlock cancelled imports"
  git push origin "$BRANCH"
fi

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git ls-remote origin "refs/heads/$BRANCH" | awk '{print $1}')"
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || fail "GitHub main does not match the validated local commit."

echo
echo "GITHUB PUSH VERIFIED"
echo "Commit: $LOCAL_SHA"
echo "Backup: $BACKUP_BRANCH"

if command -v curl >/dev/null && [ -n "$LIVE_URL" ]; then
  echo
  echo "Checking live Vercel release at: ${LIVE_URL%/}/api/health"
  VERIFIED="false"
  for _ in $(seq 1 42); do
    BODY="$(curl -fsS --max-time 12 "${LIVE_URL%/}/api/health" 2>/dev/null || true)"
    if printf '%s' "$BODY" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.exit(j?.version==="10.42.2"&&j?.build==="pending-delete-cancelled-import-unlock-hotfix"&&j?.bulkImportReady===true&&j?.schema?.contractVersion==="10.42.2"?0:1)}catch{process.exit(1)}});'; then
      VERIFIED="true"
      break
    fi
    sleep 10
  done
  if [ "$VERIFIED" != "true" ]; then
    echo
    echo "GitHub is updated, but live v10.42.2 verification is not ready."
    echo "Check Vercel Deployments, then verify the v10.42.2 hotfix SQL and existing worker configuration using the HTML wizard."
    exit 2
  fi
fi

echo
echo "DEPLOYMENT VERIFIED"
echo "Code version:             $EXPECTED_VERSION"
echo "Build marker:             $EXPECTED_BUILD"
echo "Repository:               $REPO_URL"
echo "Schema contract:          10.42.2"
echo "Fast direct core import:   included"
echo "Adaptive sender health:   included"
echo "Permanent Scouting XP:    included"
