Scout v10.42.1 hotfix

Changes:
- Core CSV leads use fast direct bulk import again; background worker is no longer required for the main insert.
- Existing v10.42 background jobs remain visible and controllable.
- Default maximum per run is 100 for new/default senders.
- Owner may set a lower Settings per-run maximum.
- Send Emails 'Max from this sender' overrides only that campaign's per-run request.
- Remaining rolling 24-hour allowance and sender health always win.
- Same Gmail pacing remains random 90-210 seconds.
- Rotation to a different Gmail remains random 3-6 seconds.
