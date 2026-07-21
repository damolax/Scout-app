#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-$HOME/Downloads/SCOUT_GOOGLE_VERIFICATION_V10_38_9_REPLIES_SIMPLIFIED}"
DEPLOY_DIR="$HOME/Downloads/scout-v10-38-9-deploy"
REPO_URL="https://github.com/damolax/Scout-app.git"
BACKUP_BRANCH="backup-before-v10-38-9-$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo "ERROR: package.json was not found in: $SOURCE_DIR"
  echo "Extract SCOUT_GOOGLE_VERIFICATION_V10_38_9_REPLIES_SIMPLIFIED.zip into Downloads, then run this script again."
  exit 1
fi

rm -rf "$DEPLOY_DIR"
git clone "$REPO_URL" "$DEPLOY_DIR"
cd "$DEPLOY_DIR"
git checkout main
git pull --ff-only origin main

git branch "$BACKUP_BRANCH"
git push origin "$BACKUP_BRANCH"

find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$SOURCE_DIR"/. "$DEPLOY_DIR"/
rm -rf .next node_modules tsconfig.tsbuildinfo

npm ci
npm run build

git add -A
if git diff --cached --quiet; then
  echo "No code changes were found. Nothing was pushed."
  exit 0
fi

git commit -m "Deploy Scout v10.38.9 simplified replies page"
git push origin main

echo
echo "DEPLOYMENT PUSH COMPLETE"
echo "Backup branch: $BACKUP_BRANCH"
echo "Vercel will deploy the updated main branch automatically."
