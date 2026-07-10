-- v8.27 uses existing businesses, email_candidates, import_batches, activity_logs, and email_research_jobs tables.
-- No new schema is required. This only reloads PostgREST schema cache after deployment.
select pg_notify('pgrst', 'reload schema');
