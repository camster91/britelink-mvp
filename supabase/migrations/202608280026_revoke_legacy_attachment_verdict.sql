-- 202608280026_revoke_legacy_attachment_verdict.sql
-- Security review HIGH-3: the legacy browser-callable RPC
-- admin_review_message_attachment was still granted to `authenticated` after
-- the scanner-only RPC admin_record_attachment_scan (migration 023) was added.
-- A household admin could therefore mark an arbitrary pending_scan upload as
-- `clean` without a trusted malware scan, defeating the quarantine boundary and
-- contradicting docs/ATTACHMENT_OPERATIONS.md.
--
-- The scanner adapter calls admin_record_attachment_scan with a service
-- credential. The legacy verdict path is removed from client roles.
--
-- Read-only review artifact: this file has NOT been applied to any database.

revoke all on function public.admin_review_message_attachment(
  uuid, uuid, text, text, text
) from public;

revoke all on function public.admin_review_message_attachment(
  uuid, uuid, text, text, text
) from authenticated;

-- Production was found to grant anon EXECUTE here as well. An anonymous caller
-- must never be able to mark a quarantined upload clean.
revoke all on function public.admin_review_message_attachment(
  uuid, uuid, text, text, text
) from anon;

-- The newer scanner RPC was also found granted to anon/authenticated in
-- production, which defeats the scanner-only quarantine boundary in exactly the
-- same way. Revoke it from every end-user role here.
revoke all on function public.admin_record_attachment_scan(
  uuid, uuid, text, text, text, text
) from anon;
revoke all on function public.admin_record_attachment_scan(
  uuid, uuid, text, text, text, text
) from authenticated;

-- Service credential only. Kept (not dropped) so an existing service adapter that
-- still calls it keeps working; it simply cannot be reached from a browser session.
grant execute on function public.admin_review_message_attachment(
  uuid, uuid, text, text, text
) to service_role;

-- Regression assertion: neither attachment-verdict RPC may be executable by
-- end-user roles.
do $$
declare offender text;
begin
  select string_agg(distinct routine_name || ':' || grantee, ', ')
  into offender
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('admin_review_message_attachment', 'admin_record_attachment_scan')
    and privilege_type = 'EXECUTE'
    and grantee in ('authenticated', 'anon', 'PUBLIC');

  if offender is not null then
    raise exception 'attachment verdict RPC still executable by end-user roles: %', offender;
  end if;
end $$;
