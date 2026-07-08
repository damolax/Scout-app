# v8.20 Gmail OAuth Diagnostics

This release fixes the Gmail connection flow that previously returned to Settings but did not show the sender.

## Changes

- Forces Google consent again with Gmail send/read scopes.
- OAuth callback now saves the Gmail sender directly into Supabase.
- OAuth callback now confirms the sender was saved before redirecting back.
- OAuth status now checks Google env vars, Supabase URL, service role key, and gmail_accounts token columns.
- Settings no longer shows `[object Object]`; it displays the real configuration or database error.
- Settings tells the user when the Supabase migration is missing Gmail token columns.

## Required environment variables

- NEXT_PUBLIC_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- NEXT_PUBLIC_SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

## Required Google redirect URI

Use your live app domain:

https://scout-app-oyeola.vercel.app/api/gmail/oauth/callback

## Required scopes

- openid
- email
- profile
- https://www.googleapis.com/auth/userinfo.email
- https://www.googleapis.com/auth/userinfo.profile
- https://www.googleapis.com/auth/gmail.send
- https://www.googleapis.com/auth/gmail.readonly

## If sender still does not appear

Run the latest Supabase migration in SQL Editor. The app needs gmail_accounts.access_token, refresh_token, expires_at, raw, and related token columns.
