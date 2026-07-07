# v8.10 Import + Ready Detection Clarity

This release fixes the confusing Ready Email Detection copy where the page said it loaded 100 contacts even though the action can process 5,000+ records.

## What changed

- Verify page now says it is showing 100 preview rows from the full matching set.
- Detect Next uses the number in the limit box, e.g. 5,000.
- Blank limit means detect all matching records up to the safety cap.
- Import copy now clearly explains routing:
  - email present -> Ready
  - no email -> Pending for Auto Scout
  - duplicates -> skipped/exportable
  - invalid rows -> downloadable

## Important inbox truth

Free detection cannot prove inbox existence. The app uses a preflight detector only: valid format, non-disposable domain, and useful domain/email structure. True no-inbox and bounce outcomes are classified after sending and do not count as real responses.
