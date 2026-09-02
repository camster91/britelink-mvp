-- Explicit portable privileges. RLS remains the row-level authorization boundary.

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert,update on table public.lesson_activities to authenticated;
grant insert,update on table public.case_message_reads to authenticated;
grant usage,select on all sequences in schema public to authenticated;

-- New private tables are readable only through their RLS policies. Mutations stay RPC-only
-- unless a later migration explicitly grants a narrow table privilege.
alter default privileges in schema public grant select on tables to authenticated;
alter default privileges in schema public grant usage,select on sequences to authenticated;
