# Git Bash Commands - Scout App v8.33 + Extension v6.5

These commands do not connect GitHub inside ChatGPT. Run them on your own PC in Git Bash.

## 1) Deploy Scout App repo

Replace the local path below with the folder where you unzip `scout-app-v8-33-final-notifications-durable-jobs.zip`.

```bash
# Pick a work folder
cd ~/Desktop

# Clone your app repo
git clone https://github.com/damolax/Scout-app.git Scout-app-v833
cd Scout-app-v833

# Copy the generated app files into this repo.
# Git Bash on Windows can use robocopy through cmd.exe.
cmd.exe /c 'robocopy "C:\\PATH\\TO\\scout_app_v833_final" "%CD%" /E /XD node_modules .next .git /XF tsconfig.tsbuildinfo'

# Install and validate
npm install
npm run typecheck
npm run build

# Commit and push
git add .
git commit -m "Build v8.33 notifications and durable jobs"
git push origin main

# Deploy to Vercel
vercel --prod
```

## 2) Apply the new Supabase migration

Open Supabase -> SQL Editor and run this file from the app repo:

```text
supabase/migrations/202607100833_notifications_durable_jobs.sql
```

This adds:
- `app_notifications`
- notification indexes and policies
- durable job heartbeat/resume columns
- `get_active_scout_jobs()` helper

## 3) Deploy Scout Extension repo

Replace the local path below with the folder where you unzip `scout-extension-v6-5-notifications-compatible.zip`.

```bash
cd ~/Desktop

git clone https://github.com/damolax/scout-extension.git scout-extension-v65
cd scout-extension-v65

# Copy extension files into the repo root.
# If your repo keeps files inside chrome-extension/, copy that folder instead.
cmd.exe /c 'robocopy "C:\\PATH\\TO\\scout_extension_v65_package\\chrome-extension" "%CD%" /E /XD .git /XF *.bak'

# Commit and push
git add .
git commit -m "Build v6.5 autonomous dorking ingest"
git push origin main
```

## 4) Load the extension in Chrome/Edge

1. Open `chrome://extensions/` or `edge://extensions/`.
2. Turn on Developer Mode.
3. Click Load unpacked.
4. Select the extension folder.
5. Open the extension popup.
6. Add your Scout App URL and workspace key.
7. Use Google/Bing dorking and Capture/Import.

## 5) Confirm replies and notifications

After sending messages:

```bash
# Run full worker manually from your deployed app URL if needed
curl -X POST "https://YOUR-VERCEL-APP.vercel.app/api/workers/run-all" \
  -H "content-type: application/json" \
  -H "x-run-all-worker-secret: YOUR_CRON_SECRET" \
  -d '{"workspaceId":"00000000-0000-4000-8000-000000000001","includeReplies":true,"includeBounces":true,"includeSchedules":true,"includeAutoScout":true}'
```

Then open:
- `/replies` for the reply records
- `/notifications` for the persistent notification list
- `/operations` for worker/job status
