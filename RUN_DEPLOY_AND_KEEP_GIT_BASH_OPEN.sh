#!/usr/bin/env bash
set +e
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/DEPLOY_V10_42_6_FULL_GIT_BASH.sh"
LIVE_URL="${SCOUT_LIVE_URL:-https://scout-app-oyeola.vercel.app}"
LOG_FILE="$HOME/Downloads/scout-v10-42-6-deploy-$(date +%Y%m%d-%H%M%S).log"

printf '
Scout v10.42.6 deployment launcher
'
printf 'Source: %s
' "$ROOT_DIR"
printf 'Log:    %s

' "$LOG_FILE"

if [ ! -f "$DEPLOY_SCRIPT" ]; then
  printf 'ERROR: Deployment script was not found:
%s
' "$DEPLOY_SCRIPT" | tee -a "$LOG_FILE"
  STATUS=90
else
  SCOUT_LIVE_URL="$LIVE_URL" bash "$DEPLOY_SCRIPT" 2>&1 | tee "$LOG_FILE"
  STATUS=${PIPESTATUS[0]}
fi

printf '
============================================================
'
if [ "$STATUS" -eq 0 ]; then
  printf 'SUCCESS: GitHub push and live Vercel verification completed.
'
elif grep -Fq 'GITHUB PUSH VERIFIED' "$LOG_FILE" 2>/dev/null; then
  printf 'PARTIAL SUCCESS: GitHub main was updated and verified,
'
  printf 'but the live Vercel health endpoint was not ready in time.
'
else
  printf 'STOPPED: GitHub main was not updated by this attempt.
'
  printf 'Deployment returned status %s.
' "$STATUS"
  printf 'Search the log for "Failed command:" to find the exact cause.
'
fi
printf 'Log saved at: %s
' "$LOG_FILE"
printf '============================================================

'
read -r -p 'Press Enter to return to the Git Bash prompt... '
exit "$STATUS"
