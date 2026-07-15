#!/usr/bin/env bash

set -Eeuo pipefail

LOG_FILE="$HOME/Downloads/scout-v10-34-deployment.log"
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
  read -r -p "Press Enter to close this deployment script..."
}

trap 'on_error "$LINENO"' ERR
trap on_exit EXIT

cd "$HOME/Downloads"

ZIP_FILE="$(find . -maxdepth 1 -type f -iname 'scout-app-v10-34-sender-speed-signature*.zip' -print | head -n 1)"
if [ -z "$ZIP_FILE" ]; then
  echo "ERROR: scout-app-v10-34-sender-speed-signature.zip was not found in Downloads."
  exit 1
fi

echo "Using package: $ZIP_FILE"

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
  echo "ERROR: GitHub is not reachable. Switch network or use a phone hotspot, then run this script again."
  exit 1
fi

rm -rf scout-v10-34-package scout-v10-34-deploy
mkdir -p scout-v10-34-package

if command -v unzip >/dev/null 2>&1; then
  unzip -q "$ZIP_FILE" -d scout-v10-34-package
else
  powershell.exe -NoProfile -Command \
    "Expand-Archive -LiteralPath '$(cygpath -w "$ZIP_FILE")' -DestinationPath '$(cygpath -w scout-v10-34-package)' -Force"
fi

PACKAGE_JSON="$(find scout-v10-34-package -type f -name package.json -not -path '*/node_modules/*' -print | head -n 1)"
if [ -z "$PACKAGE_JSON" ]; then
  echo "ERROR: package.json was not found in the ZIP."
  exit 1
fi

SOURCE_DIR="$(dirname "$PACKAGE_JSON")"
if [ ! -d "$SOURCE_DIR/app" ] || [ ! -f "$SOURCE_DIR/V10_34_VALIDATION_REPORT.md" ]; then
  echo "ERROR: The complete validated v10.34 package was not found."
  exit 1
fi

if ! grep -q '"version": "10.34.0"' "$SOURCE_DIR/package.json"; then
  echo "ERROR: The ZIP is not Scout v10.34.0."
  exit 1
fi

git clone https://github.com/damolax/Scout-app.git scout-v10-34-deploy
cd scout-v10-34-deploy

git checkout main
git pull --ff-only origin main

BACKUP_BRANCH="backup-before-v10-34-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
git push origin "$BACKUP_BRANCH"
echo "Safety backup created: $BACKUP_BRANCH"

git rm -r --ignore-unmatch . >/dev/null
cp -R "../$SOURCE_DIR/." .
rm -rf node_modules .next
rm -f tsconfig.tsbuildinfo

git add -A
git diff --cached --check

if git diff --cached --quiet; then
  echo "No code changes were detected. Nothing was pushed."
  exit 0
fi

git diff --cached --stat
git commit -m "Speed up parallel sender lanes and fix duplicate signatures"
git push origin main

echo
echo "SUCCESS: Scout v10.34 pushed to GitHub."
echo "Backup branch: $BACKUP_BRANCH"
echo "No SQL is required. Open Vercel and wait for the new deployment to become Ready."
