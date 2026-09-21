-- 202608280025_payment_rpc_service_only.sql
-- Security review HIGH-2: admin_ingest_payment_event was executable by any
-- authenticated household admin. That let a browser-authenticated admin
-- fabricate a payment event (including a `paid` state) for a case in their own
-- household, bypassing the signed-provider-webhook trust boundary documented in
-- docs/PAYMENT_OPERATIONS.md.
--
-- The function keeps its integrity checks, but it may only be called by a
-- service identity after the webhook endpoint has verified the provider
-- signature. End-user roles lose EXECUTE.
--
-- Read-only review artifact: this file has NOT been applied to any database.

revoke all on function public.admin_ingest_payment_event(
  uuid, uuid, text, text, text, text, text, integer, timestamptz
) from public;

revoke all on function public.admin_ingest_payment_event(
  uuid, uuid, text, text, text, text, text, integer, timestamptz
) from authenticated;

-- Production was found to grant anon EXECUTE on this function as well. An
-- anonymous caller must never be able to fabricate a paid event, so the
-- revocation covers anon explicitly rather than assuming it was never granted.
revoke all on function public.admin_ingest_payment_event(
  uuid, uuid, text, text, text, text, text, integer, timestamptz
) from anon;

-- Service role / database owner only. Deliberately no grant to `authenticated`
-- or `anon`. The verified webhook endpoint calls this with a service credential.
grant execute on function public.admin_ingest_payment_event(
  uuid, uuid, text, text, text, text, text, integer, timestamptz
) to service_role;

-- Regression assertion: the function must not be reachable by end-user roles.
do $$
declare offender text;
begin
  select string_agg(distinct grantee, ', ')
  into offender
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name = 'admin_ingest_payment_event'
    and privilege_type = 'EXECUTE'
    and grantee in ('authenticated', 'anon', 'PUBLIC');

  if offender is not null then
    raise exception 'admin_ingest_payment_event still executable by: %', offender;
  end if;
end $$;
