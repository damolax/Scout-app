# Scout App v10.12 — Auto Scout Page Stability Fix

This build makes Auto Scout safer on tablets/phones and weak browsers.

## Changes
- Lower Auto Scout defaults so the page does not crash after clicking Start.
- Batch capped to 50 per run.
- Speed/concurrency capped to 8.
- Rounds capped to 8.
- Results list is shorter and lighter.
- Stats refresh errors are caught instead of breaking the whole page.
- Start button ignores double-clicks while running.

## Why
The prior Auto Scout page could overload mobile/tablet Chrome after starting, especially with large queue, high batch size, high concurrency, and many live results.
