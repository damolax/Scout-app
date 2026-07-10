# Git Bash commands — Scout v8.36 full push

These commands do not connect GitHub inside ChatGPT. Run them on your own PC.

## App repo

Put `scout-app-v8-36-audience-categories-admin-setup.zip` in your Downloads folder, then run in Git Bash:

```bash
cd ~
rm -rf Scout-app-v836-push scout_app_v836_extract
git clone https://github.com/damolax/Scout-app.git Scout-app-v836-push
mkdir -p scout_app_v836_extract
unzip -q ~/Downloads/scout-app-v8-36-audience-categories-admin-setup.zip -d scout_app_v836_extract
cd Scout-app-v836-push
cp -R ~/scout_app_v836_extract/scout_app_v836_audience_categories_admin_setup/. .
rm -rf node_modules .next tsconfig.tsbuildinfo
rm -f .git/index.lock
npm install
npm run typecheck
npm run build
git add .
git commit -m "Build v8.36 audience categories and admin setup"
git branch -M main
git push -u origin main
vercel --prod
```

If Git says rejected:

```bash
git pull --rebase origin main
git push -u origin main
```

## Supabase SQL order

If notification migration failed before, run this first:

```sql
alter table if exists public.message_schedules add column if not exists target_count int not null default 0;
alter table if exists public.message_schedules add column if not exists processed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists sent_count int not null default 0;
alter table if exists public.message_schedules add column if not exists failed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists skipped_count int not null default 0;
alter table if exists public.message_schedules add column if not exists updated_at timestamptz not null default now();
```

Then run these from the app package, in order if not already run:

```text
supabase/migrations/202607100833_notifications_durable_jobs.sql
supabase/migrations/202607100834_email_signatures_identity.sql
supabase/migrations/202607100835_daily_scouting_history.sql
supabase/migrations/202607100836_audience_categories_admin_setup.sql
```

## Extension repo

Your previous error happened because `~/Desktop` does not exist and `SOURCE=/c/PATH/TO/...` was only a placeholder. Use this instead. Put `scout-extension-v6-6-audience-categories.zip` in Downloads, then run:

```bash
cd ~
rm -rf scout-extension-v66-push scout_extension_v66_extract
git clone https://github.com/damolax/scout-extension.git scout-extension-v66-push
mkdir -p scout_extension_v66_extract
unzip -q ~/Downloads/scout-extension-v6-6-audience-categories.zip -d scout_extension_v66_extract
cd scout-extension-v66-push
cp -R ~/scout_extension_v66_extract/scout_extension_v66_audience_categories/chrome-extension/. .
rm -f .git/index.lock
git add .
git commit -m "Build v6.6 audience categories for Scout ingest"
git branch -M main
git push -u origin main
```

If Git says rejected:

```bash
git pull --rebase origin main
git push -u origin main
```

If Git says nothing to commit, the files are already identical.
