# Setup for Eunice — v8.26

After pushing v8.26 and deploying on Vercel, run this migration in Supabase:

```bash
cd ~/Downloads/scout-app-v8-cloud-push
cat supabase/migrations/202607090826_scheduled_worker_seed_solid.sql | clip.exe
```

Then paste in Supabase SQL Editor and run.

Expected result: `pg_notify`.

## How to test seed inbox now

1. Go to Settings.
2. Connect at least 2 Gmail accounts.
3. Tick **Use as seed receiver** on one account.
4. The checkbox auto-saves.
5. Click **Run seed inbox test now**.

## How to test scheduled sending

1. Go to Message.
2. Select template/category/senders and counts.
3. Create a schedule with a time that is due soon.
4. Click **Run Scheduled Worker Now**.
5. Confirm it sends and updates the schedule status.

The Vercel cron also calls `/api/message/run-schedules` automatically when deployed.
