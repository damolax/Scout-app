# Exact steps to deploy Scout App v8 Cloud

## A. Supabase

1. Go to Supabase and create a project.
2. Open SQL Editor.
3. Paste and run `supabase/migrations/202607050001_scout_v8_cloud.sql`.
4. Go to Authentication → Providers → Email.
5. For now, disable email confirmation so users can login immediately.
6. Copy your Project URL, anon key, and service role key.

## B. Push to GitHub

From Downloads after unzipping:

```bash
cd ~/Downloads
rm -rf scout-app-v8-cloud-push
unzip scout-app-v8-cloud.zip -d scout-app-v8-cloud-unzipped

git clone https://github.com/damolax/Scout-app.git scout-app-v8-cloud-push
cd scout-app-v8-cloud-push

# Remove the old one-page app files from the cloned repo, then copy v8 in.
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r ../scout-app-v8-cloud-unzipped/scout-app-v8-cloud/* .

git status
git add .
git commit -m "Rebuild Scout App v8 cloud with Supabase login"
git push origin main
```

## C. Vercel environment variables

Add these in Vercel Project Settings → Environment Variables:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
NEXT_PUBLIC_BACKEND_URL=https://scout-email-finder.onrender.com
NEXT_PUBLIC_ADMIN_EMAIL=oyekunleolalekan3168@gmail.com
```

Redeploy after adding env vars.

## D. First login

1. Open the deployed app.
2. Create account with `oyekunleolalekan3168@gmail.com`.
3. The SQL trigger makes this account admin automatically.
4. Any other user who signs up is auto-approved as a member.

## E. Restore old scouted history

Open the v8 app in the same browser where old Scout App had the data.

Go to:

```txt
Data Safety → Download local v7 scouted history
Data Safety → Import local v7 history into cloud
```

## F. Extension remains separate

Do not force extension login. Keep using it for Google dorking/directory scouting and upload CSV into Scout App.
