# Scout v10.6 — Clean Navigation + Control Fix

This build focuses on reducing confusion and fixing control issues.

## Changes

- Sidebar can now open and close.
- Notifications can be deleted one by one.
- All notifications can be deleted at once.
- Stopped/old saved sends can be deleted.
- Stopped sends are hidden from Live Work.
- Stop now marks a saved send as stopped instead of leaving it as scheduled.
- Auto Scout page is simplified.
- Auto Scout labels are now: Trusted, Review, Blocked, No email.
- Long technical text moved out of the main page.
- Bad/fake email values can be removed in one click.
- Verify page has Delete All Invalid.
- Redetect no longer breaks if email_research_jobs.raw is missing; SQL patch adds the column too.

## SQL
Run `SUPABASE_V10_6_CLEANUP_FIX.sql` once.
