#!/usr/bin/env bash

set -Eeuo pipefail

LOG_FILE="$HOME/Downloads/scout-v10-35-deployment.log"
exec > >(tee "$LOG_FILE") 2>&1
failed=0

on_error() {
  failed=1
  echo
  echo "================================================"
  echo "DEPLOYMENT FAILED"
  echo "================================================"
  echo "Failed command: $BASH_COMMAND"
  echo "Script line: $1"
  echo "Log: $LOG_FILE"
}

on_exit() {
  code=$?
  echo
  if [ "$failed" -eq 0 ] && [ "$code" -eq 0 ]; then
    echo "================================================"
    echo "DEPLOYMENT SCRIPT FINISHED"
    echo "================================================"
  else
    echo "The deployment was not completed. Nothing after the failed command was pushed."
  fi
  echo
  read -r -p "Press Enter to close this deployment script..." || true
}

trap 'on_error "$LINENO"' ERR
trap on_exit EXIT

cd "$HOME/Downloads"

ZIP_FILE="$(find . -maxdepth 1 -type f -iname 'scout-app-v10-35-safe-sending-google-verification*.zip' -print | head -n 1)"
if [ -z "$ZIP_FILE" ]; then
  echo "ERROR: Scout v10.35 ZIP was not found in Downloads."
  exit 1
fi

echo "Using package: $ZIP_FILE"
echo
cat <<'NOTICE'
Before continuing:
1. Back up the current Supabase project/deployment.
2. Run RUN_THIS_SQL_FIRST_V10_35.sql successfully in Supabase.
3. Set the v10.35 Vercel environment variables from EXACT_ROLLOUT_STEPS_V10_35.txt.
NOTICE
read -r -p "Type SQL DONE to confirm those steps are complete: " CONFIRM
if [ "$CONFIRM" != "SQL DONE" ]; then
  echo "Stopped safely. Complete the database and environment steps first."
  exit 1
fi

CONNECTED=0
for ATTEMPT in 1 2 3 4 5; do
  echo "Testing GitHub connection ($ATTEMPT/5)..."
  if git ls-remote https://github.com/damolax/Scout-app.git HEAD >/dev/null 2>&1; then
    CONNECTED=1
    break
  fi
  sleep 10
done
if [ "$CONNECTED" -ne 1 ]; then
  echo "ERROR: GitHub is not reachable. Change network and run the script again."
  exit 1
fi

rm -rf scout-v10-35-package scout-v10-35-deploy
mkdir -p scout-v10-35-package
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$ZIP_FILE" -d scout-v10-35-package
else
  powershell.exe -NoProfile -Command \
    "Expand-Archive -LiteralPath '$(cygpath -w "$ZIP_FILE")' -DestinationPath '$(cygpath -w scout-v10-35-package)' -Force"
fi

PACKAGE_JSON="$(find scout-v10-35-package -type f -name package.json -not -path '*/node_modules/*' -print | head -n 1)"
if [ -z "$PACKAGE_JSON" ]; then
  echo "ERROR: package.json was not found in the ZIP."
  exit 1
fi
SOURCE_DIR="$(dirname "$PACKAGE_JSON")"
for REQUIRED in app lib RUN_THIS_SQL_FIRST_V10_35.sql V10_35_VALIDATION_REPORT.md scripts/validate-v10-35.mjs; do
  if [ ! -e "$SOURCE_DIR/$REQUIRED" ]; then
    echo "ERROR: Missing required package item: $REQUIRED"
    exit 1
  fi
done
if ! grep -q '"version": "10.35.0"' "$SOURCE_DIR/package.json"; then
  echo "ERROR: The ZIP is not Scout v10.35.0."
  exit 1
fi

git clone https://github.com/damolax/Scout-app.git scout-v10-35-deploy
cd scout-v10-35-deploy
git checkout main
git pull --ff-only origin main

BACKUP_BRANCH="backup-before-v10-35-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
git push origin "$BACKUP_BRANCH"
echo "Safety backup created: $BACKUP_BRANCH"

git rm -r --ignore-unmatch . >/dev/null
cp -R "../$SOURCE_DIR/." .
rm -rf node_modules .next
rm -f tsconfig.tsbuildinfo
find . -name '*.bak' -type f -delete

npm ci
npm run validate:v10.35
npm run typecheck

CI=1 NEXT_TELEMETRY_DISABLED=1 \
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.example.signature \
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.service.signature \
NEXT_PUBLIC_ADMIN_EMAIL=oyekunleolalekan3168@gmail.com \
NEXT_PUBLIC_APP_URL=https://scout.example.com \
NEXT_PUBLIC_GOOGLE_CLIENT_ID=test-client.apps.googleusercontent.com \
GOOGLE_CLIENT_ID=test-client.apps.googleusercontent.com \
GOOGLE_CLIENT_SECRET=test-secret \
GMAIL_SEND_ENABLED=true \
GMAIL_REPLY_SYNC_ENABLED=false \
GMAIL_NATIVE_SIGNATURE_SYNC_ENABLED=false \
DELIVERABILITY_CENTER_ENABLED=true \
SENDER_HEALTH_ENFORCEMENT_ENABLED=true \
PLACEMENT_TESTS_ENABLED=true \
TEAM_PAGINATION_ENABLED=true \
ACCOUNT_DELETION_ENABLED=true \
NEXT_PUBLIC_SCOUT_BRAND_NAME='Scout by We Are Creative Builders' \
NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com \
SCOUT_MAX_ACTIVE_SENDER_LANES=8 \
npm run build

rm -rf node_modules .next
rm -f tsconfig.tsbuildinfo

git add -A
git diff --cached --check
if git diff --cached --quiet; then
  echo "No code changes were detected. Nothing was pushed."
  exit 0
fi

git diff --cached --stat
git commit -m "Release Scout v10.35 safe sending and Google verification"
git push origin main

echo
echo "SUCCESS: Scout v10.35 was pushed to GitHub."
echo "Backup branch: $BACKUP_BRANCH"
echo "Open Vercel, wait for Ready, then run the controlled test in EXACT_ROLLOUT_STEPS_V10_35.txt."
