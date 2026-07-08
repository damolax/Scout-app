# v8.19 Gmail OAuth + Native Send

## Fixed

- Gmail connection moved into a native OAuth callback instead of returning a code to the Settings page.
- Connected Gmail accounts are saved directly into `gmail_accounts` through the server-side route.
- Settings now shows whether OAuth env vars are configured.
- Google consent is forced with `prompt=consent select_account`, `access_type=offline`, and the Gmail send/read scopes.
- Message now sends through `/api/gmail/send`, a native Node route, instead of requiring the old backend send endpoint.

## Required Vercel env vars

```txt
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Optional:

```txt
GOOGLE_CLIENT_ID=...
```

## Google Cloud redirect URI

Add this to the OAuth Client:

```txt
https://YOUR_DOMAIN/api/gmail/oauth/callback
```

For the current production domain:

```txt
https://scout-app-oyeola.vercel.app/api/gmail/oauth/callback
```

## Flow

1. Settings → Connect Gmail.
2. Google asks for Gmail send/read permissions.
3. Google redirects to `/api/gmail/oauth/callback`.
4. Scout exchanges the code, reads the Gmail profile, and saves the sender.
5. Message uses the saved sender to send batches.
