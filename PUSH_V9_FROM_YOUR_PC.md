# Push Scout App v9 from Git Bash

```bash
cd ~

rm -rf Scout-app-v9-push scout_app_v9_extract

git clone https://github.com/damolax/Scout-app.git Scout-app-v9-push

mkdir -p scout_app_v9_extract
unzip -q ~/Downloads/scout-app-v9-live-current-work.zip -d scout_app_v9_extract

cd Scout-app-v9-push

cp -R ~/scout_app_v9_extract/scout_app_v9_live_current_work/. .

rm -rf node_modules .next tsconfig.tsbuildinfo
rm -f .git/index.lock

git add .
git commit -m "Build v9 live current work"
git push origin main
```

Then redeploy Vercel without build cache.
