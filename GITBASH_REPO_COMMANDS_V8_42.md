# App push
cd ~
rm -rf Scout-app-v842-push scout_app_v842_extract
git clone https://github.com/damolax/Scout-app.git Scout-app-v842-push
mkdir -p scout_app_v842_extract
unzip -q ~/Downloads/scout-app-v8-42-repair-cleanup.zip -d scout_app_v842_extract
cd Scout-app-v842-push
cp -R ~/scout_app_v842_extract/scout_app_v842_repair_cleanup/. .
rm -rf node_modules .next tsconfig.tsbuildinfo
rm -f .git/index.lock
git add .
git commit -m "Build v8.42 repair cleanup"
git push origin main

# Then redeploy in Vercel without build cache.
# Run SUPABASE_V8_42_REPAIR.sql in Supabase.
