# Deploy Scout App v8.33 From Your PC

This build adds persistent notifications and durable jobs. It does not require ChatGPT to connect to GitHub.

## Git Bash

```bash
cd ~/Desktop

git clone https://github.com/damolax/Scout-app.git Scout-app-v833
cd Scout-app-v833

SOURCE="/c/PATH/TO/scout_app_v833_final"
cp -R "$SOURCE"/. .
rm -rf node_modules .next .git tsconfig.tsbuildinfo

npm install
npm run typecheck
npm run build

git add .
git commit -m "Build v8.33 notifications and durable jobs"
git push origin main

vercel --prod
```

## Supabase migration

Run this file in Supabase SQL Editor:

```text
supabase/migrations/202607100833_notifications_durable_jobs.sql
```

## Important app checks

- Open `/notifications` after running Gmail sync.
- Open `/operations` to run Full Autopilot.
- Open `/message`; a started send now creates a durable schedule.
- Open `/auto-scout`; Start Durable Auto Scout uses server worker queue.
