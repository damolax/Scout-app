# Push Scout App v8.38

Put `scout-app-v8-38-simple-stable-restart.zip` in your Downloads folder, then run:

```bash
cd ~

rm -rf Scout-app-v838-push scout_app_v838_extract

git clone https://github.com/damolax/Scout-app.git Scout-app-v838-push

mkdir -p scout_app_v838_extract
unzip -q ~/Downloads/scout-app-v8-38-simple-stable-restart.zip -d scout_app_v838_extract

cd Scout-app-v838-push

cp -R ~/scout_app_v838_extract/scout_app_v838_simple_stable/. .

rm -rf node_modules .next tsconfig.tsbuildinfo
rm -f .git/index.lock

npm install
npm run typecheck
npm run build

git add .
git commit -m "Build v8.38 simple stable restart"
git branch -M main
git push -u origin main

vercel --prod
```

If Vercel asks to link a project, choose the existing `scout-app` project.

After deploy, open:

```text
https://scout-app-oyeola.vercel.app/api/health
```

Then setup cron-job.org to call:

```text
https://scout-app-oyeola.vercel.app/api/workers/run-all?workspaceId=00000000-0000-4000-8000-000000000001&includeSeedTest=false&token=YOUR_RUN_ALL_WORKER_SECRET
```
