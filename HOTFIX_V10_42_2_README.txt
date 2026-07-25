Scout v10.42.2 fixes:
1. Creates the missing delete_pending_no_email_businesses RPC in current Supabase projects.
2. Adds a browser-side compatibility fallback if PostgREST has not refreshed the RPC yet.
3. Cancelling an old background import clears the active legacy-job state immediately.
4. A refreshed page clearly says that the CSV must be selected again because browsers cannot retain local file access.
5. Delete/repair/export failures are labelled Action needs attention, not Import stopped.
