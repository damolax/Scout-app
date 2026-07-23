#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
REPO_URL="https://github.com/damolax/Scout-app.git"
BRANCH="main"
WORK_DIR="${HOME}/scout-v10-41-deploy"
EXPECTED_VERSION="10.41.0"
LIVE_URL="${SCOUT_LIVE_URL:-https://scout-app-oyeola.vercel.app}"

fail(){ echo; echo "ERROR: $*" >&2; exit 1; }
on_error(){
  local exit_code="$1"
  local line_number="$2"
  local failed_command="$3"
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
[ -f "$SOURCE_DIR/RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql" ] || fail "Current Supabase upgrade SQL is missing."

ACTUAL_VERSION="$(cd "$SOURCE_DIR" && node -p "require('./package.json').version")"
[ "$ACTUAL_VERSION" = "$EXPECTED_VERSION" ] || fail "Expected Scout $EXPECTED_VERSION but package.json says $ACTUAL_VERSION."
grep -Fq "$REPO_URL" "$SOURCE_DIR/DEPLOY_V10_41_0_FULL_GIT_BASH.sh" || fail "Deployment target verification failed."

echo "Target repository: $REPO_URL"
echo "Target branch:     $BRANCH"
echo "Source version:    $ACTUAL_VERSION"
echo

rm -rf "$WORK_DIR"
git clone "$REPO_URL" "$WORK_DIR"
cd "$WORK_DIR"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

BACKUP_BRANCH="backup-before-v10-41-bulk-import-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
git push origin "$BACKUP_BRANCH"

find "$WORK_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$SOURCE_DIR"/. "$WORK_DIR"/
rm -rf node_modules .next tsconfig.tsbuildinfo

# The local package and production build must pass before GitHub is changed.
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
  git commit -m "Accelerate large CSV imports with resumable bulk lanes"
  git push origin "$BRANCH"
fi

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git ls-remote origin "refs/heads/$BRANCH" | awk '{print $1}')"
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || fail "GitHub main does not match the validated local commit."

echo
echo "GITHUB PUSH VERIFIED"
echo "Commit: $LOCAL_SHA"
echo "Backup: $BACKUP_BRANCH"

# Vercel should deploy the connected main branch. Poll the live health route when curl is available.
if command -v curl >/dev/null && [ -n "$LIVE_URL" ]; then
  echo
  echo "Checking live Vercel release readiness at: ${LIVE_URL%/}/api/health"
  VERIFIED="false"
  for _ in $(seq 1 36); do
    BODY="$(curl -fsS --max-time 12 "${LIVE_URL%/}/api/health" 2>/dev/null || true)"
    if printf '%s' "$BODY" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{try{const j=JSON.parse(s); process.exit(j?.version==="10.41.0" && j?.build==="high-speed-resumable-bulk-import" && j?.bulkImportReady===true && j?.schema?.contractVersion==="10.40.0" && j?.ready===true ? 0 : 1)}catch{process.exit(1)}});'; then
      VERIFIED="true"
      break
    fi
    sleep 10
  done
  if [ "$VERIFIED" != "true" ]; then
    echo
    echo "GitHub is updated, but live verification is not ready yet."
    echo "Open Vercel Deployments and inspect the newest deployment, then open Settings > Setup Readiness."
    echo "The usual causes are: Vercel is still building, database/06_HIGH_SPEED_BULK_IMPORT.sql was not run, the v10.40 base SQL is incomplete, or environment variables are incomplete."
    exit 2
  fi
fi

echo
echo "DEPLOYMENT VERIFIED"
echo "Code version:              $EXPECTED_VERSION"
echo "GitHub repository:         $REPO_URL"
echo "Supabase base contract:    10.40.0"
echo "Bulk import contract:     10.41.0"
echo "Scout schema readiness, replies, signatures, stale-job confirmation, and high-speed bulk import are ready for controlled live acceptance tests."
