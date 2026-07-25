-- OPTIONAL performance index for Scout imports.
-- Do not run while Scout is importing. Use an external Postgres client with the Session pooler if the table is large.
set statement_timeout = '0';
create index if not exists businesses_import_batch_key_idx
  on public.businesses(import_batch_id, normalized_key)
  where import_batch_id is not null;
