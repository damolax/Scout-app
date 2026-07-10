# Render Worker Setup for Scout

## 1. Deploy the app to Vercel first

The app must already be live on Vercel. Copy the app URL, for example:

```text
https://scout-app.vercel.app
```

## 2. Add the worker secret to Vercel

In Vercel → Project → Settings → Environment Variables, add:

```env
RUN_ALL_WORKER_SECRET=make-a-long-random-secret
```

Redeploy the app after adding it.

## 3. Create the Render worker

In Render:

1. New → Background Worker.
2. Connect the Scout app GitHub repo.
3. Build command:

```bash
npm install --no-audit --no-fund
```

4. Start command:

```bash
node scripts/render-worker.mjs
```

5. Add environment variables:

```env
SCOUT_APP_URL=https://YOUR-VERCEL-APP.vercel.app
SCOUT_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
RUN_ALL_WORKER_SECRET=the-same-secret-you-added-to-vercel
WORKER_INTERVAL_MINUTES=15
WORKER_REPLY_DAYS=90
WORKER_REPLY_LIMIT=500
WORKER_SCHEDULE_LIMIT=3
WORKER_AUTO_SCOUT_CYCLES=5
WORKER_AUTO_SCOUT_BATCH_SIZE=100
WORKER_AUTO_SCOUT_CONCURRENCY=12
WORKER_AUTO_SCOUT_ENQUEUE_LIMIT=2500
```

## 4. What this worker does

Every 15 minutes it runs:

```text
/api/workers/run-all
```

That keeps these moving without the user staying on the app:

- reply sync
- no-inbox / blocked sync
- notifications
- Auto Scout
- scheduled first messages
- scheduled follow-ups
- durable jobs

## 5. Test it manually

After Vercel is live and the secret is set, run this from Git Bash:

```bash
curl -X POST "https://YOUR-VERCEL-APP.vercel.app/api/workers/run-all?workspaceId=00000000-0000-4000-8000-000000000001&includeSeedTest=false" \
  -H "authorization: Bearer YOUR_RUN_ALL_WORKER_SECRET" \
  -H "content-type: application/json" \
  -d '{"includeSeedTest":false}'
```

If it returns JSON with `steps`, the worker can run.
