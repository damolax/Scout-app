# Push Scout v8.41 fast

```bash
cd ~
rm -rf Scout-app-v841-push scout_app_v841_extract

git clone https://github.com/damolax/Scout-app.git Scout-app-v841-push
mkdir -p scout_app_v841_extract
unzip -q ~/Downloads/scout-app-v8-41-outreach-repair.zip -d scout_app_v841_extract
cd Scout-app-v841-push
cp -R ~/scout_app_v841_extract/scout_app_v841_outreach_repair/. .
rm -rf node_modules .next tsconfig.tsbuildinfo
rm -f .git/index.lock

git add .
git commit -m "Build v8.41 outreach repair"
git push origin main
```

Then redeploy in Vercel without build cache.
