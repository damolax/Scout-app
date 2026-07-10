# Git Bash commands — Scout App v8.35

Use this when you do not want to connect GitHub inside ChatGPT.

## App repo

```bash
cd ~/Desktop

git clone https://github.com/damolax/Scout-app.git Scout-app-v835
cd Scout-app-v835

# Change this path to the folder where you extracted scout-app-v8-35-daily-scouting-signature-only.zip
SOURCE="/c/PATH/TO/scout_app_v835_daily_scouting_signature_only"

cp -R "$SOURCE"/. .
rm -rf node_modules .next .git/index.lock tsconfig.tsbuildinfo

npm install
npm run typecheck
npm run build

git add .
git commit -m "Build v8.35 daily scouting and signature-only identity"
git push origin main

vercel --prod
```

## Supabase SQL

Run these in Supabase SQL Editor, in this order:

```text
SUPABASE_FIX_NOTIFICATION_PROCESSED_COUNT.sql
supabase/migrations/202607100835_daily_scouting_history.sql
```

If v8.33 migration never failed for you, running the fix is still safe because it uses `if not exists`.

## Extension repo

I did not receive the extension error text/screenshot after your message. This is the safe push pattern:

```bash
cd ~/Desktop

git clone https://github.com/damolax/scout-extension.git scout-extension-v65
cd scout-extension-v65

# Change this path to the folder where you extracted the extension package
SOURCE="/c/PATH/TO/scout_extension_v65_package/chrome-extension"

cp -R "$SOURCE"/. .
rm -f .git/index.lock

git status
git add .
git commit -m "Build v6.5 autonomous dorking ingest"
git push origin main
```

If Git says `nothing to commit`, it means the extension repo already has the same files.
If Git says `rejected`, run:

```bash
git pull --rebase origin main
git push origin main
```

If Git says `src refspec main does not match any`, run:

```bash
git branch -M main
git push -u origin main
```
