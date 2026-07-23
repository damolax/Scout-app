SCOUT v10.40.1 TEMPLATE CONTRACT FIX

Fixes the runtime schema checker to use the canonical public.templates.message column.
The previous checker incorrectly required public.templates.body, which is not part of Scout's real template model.
No new Supabase column is required for this fix.
Deploy this code, then run Setup Readiness again.
