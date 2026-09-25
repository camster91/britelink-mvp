-- 042: close the client grants Supabase hands out by default.
--
-- WHY
--   Supabase's init script (supabase/postgres, migrations/db/init-scripts/
--   00000000000000-initial-schema.sql, shipped in the 15.8.1.060 image the self-hosted stack runs)
--   sets, for every object later created in public:
--
--     alter default privileges in schema public grant all on tables    to ... anon, authenticated, service_role;
--     alter default privileges in schema public grant all on functions to ... anon, authenticated, service_role;
--     alter default privileges in schema public grant all on sequences to ... anon, authenticated, service_role;
--
--   The migrations were written against plain Postgres semantics: they "revoke all ... from public"
--   and then grant narrowly. That does not touch a grant made directly to anon or authenticated, so
--   on a real project every function and table in public stayed reachable by both. PostgREST
--   exposes every executable function as /rest/v1/rpc/<name>. In particular, with only the public
--   anon key:
--     * admin_list_pending_scan_attachments (023) listed pending attachments -- household ids,
--       object paths, sha256 -- across every household;
--     * admin_reconcile_attachment_objects (023) replaced any household's observed object set,
--       corrupting the attachment integrity signals.
--   Both are scanner-only and have no caller check by design; they are meant for service_role.
--   Migration 014's "narrow" write grants to authenticated were equally moot: authenticated
--   already held insert/update/delete on every table, leaving RLS as the only boundary.
--
-- WHAT CHANGES
--   * anon: no privileges on any table, sequence, or function in public. The app never calls the
--     API signed out (041 removed the last anon RPC), and nothing public is served from here.
--   * authenticated: SELECT on tables (RLS-filtered, as 014 intended), and only the write grants
--     014 allowlists (tests/migration-invariants.test.mjs pins that list). Execute is revoked on
--     the service-only and internal functions; the client RPCs keep the explicit grants their own
--     migrations made, and the RLS helper functions stay executable because policies call them
--     with the caller's privileges.
--   * The defaults themselves are revoked for objects created from here on, so a future migration
--     has to grant a client role deliberately, exactly as the existing ones already do.
--   service_role is untouched and keeps what the scanner and payment adapter need.

-- anon: nothing.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- authenticated: back to 014's model. SELECT stays; writes only where allowlisted.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant insert, update on table public.lesson_activities to authenticated;
grant insert, update on table public.case_message_reads to authenticated;

-- Service-only and internal functions: never a client RPC.
revoke all on function public.admin_list_pending_scan_attachments(integer) from authenticated;
revoke all on function public.admin_reconcile_attachment_objects(uuid, text[]) from authenticated;
revoke all on function public.enforce_operation_rate_limit(uuid, text, integer, integer) from authenticated;
revoke all on function public.enforce_insert_rate_limit() from authenticated;
revoke all on function public.export_guardian_household_authorized(uuid) from authenticated;
revoke all on function public.request_guardian_household_deletion_authorized(uuid, text) from authenticated;
grant execute on function public.admin_list_pending_scan_attachments(integer) to service_role;
grant execute on function public.admin_reconcile_attachment_objects(uuid, text[]) to service_role;

-- Future objects: no implicit client grants. (Applies to objects created by the role running
-- this migration, which is the role that runs every migration.)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public grant select on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
