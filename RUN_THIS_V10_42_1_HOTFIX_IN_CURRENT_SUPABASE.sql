-- Scout v10.42.1 fast-import and sender-run default hotfix
-- Safe to run in the current Supabase project after v10.42.0.

alter table if exists public.gmail_accounts
  alter column default_run_limit set default 100;

-- Correct only the v10.42-generated 250 default or missing values.
-- Owner-selected lower/custom values are preserved.
update public.gmail_accounts
set default_run_limit = 100,
    updated_at = now()
where default_run_limit is null
   or default_run_limit = 250;

insert into public.scout_schema_versions(version, applied_at, notes)
values ('10.42.1', now(), 'Fast direct core import, default max per run 100, same-Gmail 90-210s and different-Gmail 3-6s pacing preserved')
on conflict (version) do update
set applied_at = excluded.applied_at,
    notes = excluded.notes;

notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

select
  'READY'::text as scout_v10421_status,
  (select count(*) from public.gmail_accounts where default_run_limit = 100) as senders_at_default_100,
  exists(select 1 from public.scout_schema_versions where version='10.42.1') as version_recorded,
  '90-210 seconds'::text as same_gmail_delay,
  '3-6 seconds'::text as different_gmail_delay;
