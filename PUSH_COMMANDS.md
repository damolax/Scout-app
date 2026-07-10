# Push Scout App v8.31

```bash
git clone https://github.com/damolax/Scout-app.git scout-app-v8-31-push
cd scout-app-v8-31-push

# Copy the contents of this v8.31 package into the repo folder, then:
npm install
npm run typecheck
npm run build

git add .
git commit -m "Build v8.31 operations autopilot final"
git push origin main
vercel --prod
```

## Vercel env vars to add/check

```bash
RUN_ALL_WORKER_SECRET=use-a-long-random-secret
CRON_SECRET=use-the-same-long-random-secret
SCOUT_DEFAULT_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
```
