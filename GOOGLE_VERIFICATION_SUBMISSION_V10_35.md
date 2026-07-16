# Google verification submission — Scout v10.35

## Identity

Use one consistent identity everywhere:

- App name: **Scout by We Are Creative Builders**
- Production homepage: `https://scout.YOUR_DOMAIN/`
- Privacy: `https://scout.YOUR_DOMAIN/privacy`
- Terms: `https://scout.YOUR_DOMAIN/terms`
- Data deletion: `https://scout.YOUR_DOMAIN/data-deletion`
- Google data use: `https://scout.YOUR_DOMAIN/google-data-use`
- Support email: a real monitored address on your domain
- Redirect URI: `https://scout.YOUR_DOMAIN/api/gmail/oauth/callback`

Verify ownership of the authorized domain in Google Search Console with an account that owns or edits the production Google Cloud project.

## First-stage scope

Declare only:

```text
openid
email
profile
https://www.googleapis.com/auth/gmail.send
```

Do not declare `gmail.readonly` or `gmail.settings.basic` for this first submission. Scout keeps those features disabled during review.

## Suggested `gmail.send` justification

> Scout is an outreach workspace. After a signed-in user explicitly connects a Gmail account, Scout uses the Gmail send permission only when that user explicitly starts a Send Now job, creates a scheduled job, or sends a manual message from Scout. Scout constructs the user-selected message, applies the user's Scout signature once, sends it from the selected connected account, and stores limited sending metadata needed to show progress, enforce sender limits, prevent duplicates, and provide sent-history records. This release does not request permission to read the user's Gmail inbox or change Gmail's native settings. A narrower Gmail scope cannot send a message from the connected Gmail account.

## Demo video sequence

Record in English and upload as Unlisted:

1. Show the browser address bar and the public production homepage.
2. Open Privacy, Terms, Data Deletion, and Google Data Use.
3. Sign in to Scout.
4. Open Settings and click **Connect Gmail for sending**.
5. Show the full Google consent screen, app name, and browser address bar.
6. Grant access and return to Scout.
7. Show the connected sender without exposing secrets or tokens.
8. Save a Scout signature.
9. Send one controlled message to a test inbox you own.
10. Show the Sent record and confirm that the message contains one signature.
11. Show how to disconnect Gmail.
12. Show the Scout account-deletion control.

## Submission checks

- Production app is deployed, not a preview deployment.
- OAuth publishing status is Production.
- Homepage is public while signed out.
- Homepage clearly explains Scout and links to Privacy.
- Privacy accurately describes Google data access, storage, deletion, and Limited Use.
- Support and developer-contact inboxes are monitored.
- OAuth Data Access contains only scopes requested by the deployed code.
- The video demonstrates every requested sensitive scope.
- The app name, logo, domain, policy pages, support email, and video all match.

Google's official current instructions are available at:

- https://support.google.com/cloud/answer/13461325
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- https://developers.google.com/workspace/gmail/api/auth/scopes

Verification timing is controlled by Google. A complete and consistent submission improves the chance of a smooth review but does not guarantee approval or a specific review time.
