# Scout v10.5 — Sender Limit Protection + Template Attachments

## Sender limit protection
- If Gmail says a sender reached its limit, Scout pauses that sender immediately.
- The paused sender is removed from the active sending rotation.
- The same lead is retried with the next available sender instead of being lost.
- Sender caps now also respect the number sent in the last 24 hours.
- A sender that already reached its daily limit will not be selected for Send Now.

## Template attachments
- Templates can now include attachments.
- Supported attachments: PDF, images, TXT, CSV, DOCX, XLSX, PPTX.
- Use Templates → open/create template → Attach file to this template.
- Attachments are sent with messages using that template.
- Recommended: keep files small and only attach when needed.

## Required SQL
Run `SUPABASE_V10_5_LIMIT_ATTACHMENTS.sql` once in Supabase SQL Editor.
