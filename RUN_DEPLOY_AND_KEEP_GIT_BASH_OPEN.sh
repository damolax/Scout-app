#!/usr/bin/env bash

# Windows-friendly launcher for Scout v10.42.
# It preserves the full deployer's safety checks, writes a log, and waits for
# Enter before closing when launched in a separate Git Bash window.

set +e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/DEPLOY_V10_42_0_FULL_GIT_BASH.sh"
LIVE_URL="${SCOUT_LIVE_URL:-https://scout-app-oyeola.vercel.app}"
LOG_FILE="$HOME/Downloads/scout-v10-42-deploy-$(date +%Y%m%d-%H%M%S).log"

printf '\nScout v10.42 deployment launcher\n'
printf 'Source: %s\n' "$ROOT_DIR"
printf 'Log:    %s\n\n' "$LOG_FILE"

if [ ! -f "$DEPLOY_SCRIPT" ]; then
  printf 'ERROR: Deployment script was not found:\n%s\n' "$DEPLOY_SCRIPT" | tee -a "$LOG_FILE"
  STATUS=90
else
  SCOUT_LIVE_URL="$LIVE_URL" bash "$DEPLOY_SCRIPT" 2>&1 | tee "$LOG_FILE"
  STATUS=${PIPESTATUS[0]}
fi

printf '\n============================================================\n'
if [ "$STATUS" -eq 0 ]; then
  printf 'SUCCESS: GitHub push and live Vercel verification completed.\n'
elif grep -Fq 'GITHUB PUSH VERIFIED' "$LOG_FILE" 2>/dev/null; then
  printf 'PARTIAL SUCCESS: GitHub main was updated and verified,\n'
  printf 'but the live Vercel health endpoint was not ready in time.\n'
else
  printf 'STOPPED: GitHub main was not updated by this attempt.\n'
  printf 'Deployment returned status %s.\n' "$STATUS"
  printf 'Search the log for "Failed command:" to find the exact cause.\n'
fi
printf 'Log saved at: %s\n' "$LOG_FILE"
printf '============================================================\n\n'

printf 'The deployment process has finished. Git Bash will remain open.\n'
read -r -p 'Press Enter to return to the Git Bash prompt... '

# Return to an existing shell without closing it. When launched by double-click,
# the prompt above keeps the window visible long enough to read the result.
exit "$STATUS"
