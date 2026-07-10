# Deploy Scout App v8.34 from your PC

This package does not need GitHub connected inside ChatGPT. Run these from Git Bash on your own PC.

## App repo

```bash
cd ~/Desktop

git clone https://github.com/damolax/Scout-app.git Scout-app-v834
cd Scout-app-v834

# Change this path to where you extracted scout-app-v8-34-email-signatures-identity.zip
SOURCE="/c/PATH/TO/scout_app_v834_signature_identity"
cp -R "$SOURCE"/. .
rm -rf node_modules .next .git tsconfig.tsbuildinfo

npm install
npm run typecheck
npm run build

git add .
git commit -m "Build v8.34 email signatures and sender identity"
git push origin main

vercel --prod
```

## Supabase migration

After deploying, open Supabase SQL Editor and run:

```sql
supabase/migrations/202607100834_email_signatures_identity.sql
```

## Gmail reconnect note

Existing connected Gmail accounts can use Scout-local signatures immediately after the migration.

To use **Save + sync signature to Gmail**, reconnect the Gmail accounts from Settings after deploying v8.34 so Google can grant the Gmail settings permission.
