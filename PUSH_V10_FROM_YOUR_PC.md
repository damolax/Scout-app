# Push Scout v10

```bash
cd ~

rm -rf Scout-app-v10-push scout_app_v10_extract

git clone https://github.com/damolax/Scout-app.git Scout-app-v10-push

mkdir -p scout_app_v10_extract
unzip -q ~/Downloads/scout-app-v10-stable-fast-simple.zip -d scout_app_v10_extract

cd Scout-app-v10-push

cp -R ~/scout_app_v10_extract/scout_app_v10_stable_fast_simple/. .

rm -rf node_modules .next tsconfig.tsbuildinfo
rm -f .git/index.lock

git add .
git commit -m "Build v10 stable simple fast"
git push origin main
```

Then redeploy Vercel without build cache.
```
