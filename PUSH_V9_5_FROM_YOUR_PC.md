# Push Scout v9.5 from your PC

```bash
cd ~

rm -rf Scout-app-v95-push scout_app_v95_extract

git clone https://github.com/damolax/Scout-app.git Scout-app-v95-push

mkdir -p scout_app_v95_extract
unzip -q ~/Downloads/scout-app-v9-5-reminder-notifier.zip -d scout_app_v95_extract

cd Scout-app-v95-push

cp -R ~/scout_app_v95_extract/scout_app_v9_5_reminder_notifier/. .

rm -rf node_modules .next tsconfig.tsbuildinfo
rm -f .git/index.lock

git add .
git commit -m "Build v9.5 reminder notifier no cron"
git push origin main
```

Then redeploy Vercel without build cache.
