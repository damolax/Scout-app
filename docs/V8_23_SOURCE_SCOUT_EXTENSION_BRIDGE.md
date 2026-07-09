# Scout App v8.23 — Source Scout + Extension Bridge

This version adds a visible **Source Scout** section for the discovery layer before Auto Scout.

## Definitions

- **Direct email extraction**: finds emails already visible in Google/Bing snippets, directory pages, pasted HTML/text, or extension captures. These emails can go directly to Ready because the email was present in the source.
- **Website discovery**: finds official websites from search/directory results when no email is visible yet.
- **Auto Scout**: takes website-only businesses and checks the actual website pages such as homepage, contact, about, team, impressum, privacy, and footer pages to find real source-seen emails.

## Flow

1. Enter niche/location.
2. Open generated Google/Bing dorks.
3. Paste search result text, directory page text/HTML, website list, or email list.
4. Source Scout extracts direct emails and websites.
5. Direct emails can be imported as Ready.
6. Website-only leads are queued into Auto Scout.
7. Auto Scout does the deep website search.

## Extension bridge

The extension still posts businesses to `/api/extension/ingest` using the workspace API key. v8.23 makes this easier to find from the Source Scout tab.

## Render backend

Auto Scout still uses `NEXT_PUBLIC_BACKEND_URL` when configured, for example the Render backend. The app also has an internal deep website finder fallback, so website-only leads can still be checked through the app route.
