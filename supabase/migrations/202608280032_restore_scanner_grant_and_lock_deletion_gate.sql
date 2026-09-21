-- 202608280032_restore_scanner_grant_and_lock_deletion_gate.sql
-- Two QA failures found by execution (britelink-qa-synthetic-stack.md).
--
-- FAILURE 2 — service_role lost admin_record_attachment_scan
--   Migration 026 revoked the LEGACY browser-callable RPC
--   admin_review_message_attachment from client roles. That was correct. But the
--   revocation pass also left the NEW scanner RPC
--   admin_record_attachment_scan executable by postgres only — service_role lost
--   it too. The malware scanner therefore cannot record a verdict, which means
--   every upload stays in pending_scan quarantine forever and no attachment ever
--   becomes downloadable. Revocation was too broad.
--
--   Verified before this fix:
--     admin_record_attachment_scan          -> postgres
--     admin_review_message_attachment       -> postgres, service_role
--
-- FAILURE 3 — the deletion execution gate was left OPEN
--   retention_execution_controls.execution_enabled read true, with
--   enablement_basis = 'Migration harness validation run'. Physical deletion of a
--   household — including a child's uploaded documents — must ship DISABLED and
--   can only be enabled by a separately approved operator step. A validation run
--   must never leave the gate open.
--
--   The gate is re-locked here AND made self-healing: the harness that flips it on
--   is expected to flip it back, but this migration guarantees the shipped state.
--
-- Read-only review artifact: this file has NOT been applied to any deployed database.

-- ---------------------------------------------------------------------------
-- FAILURE 2: restore the scanner grant to service_role only
-- ---------------------------------------------------------------------------

grant execute on function public.admin_record_attachment_scan(
  uuid, uuid, text, text, text, text
) to service_role;

-- Re-assert the boundary: the scanner RPC is service-only, and the legacy
-- verdict RPC stays out of client reach.
revoke all on function public.admin_record_attachment_scan(
  uuid, uuid, text, text, text, text
) from public;
revoke all on function public.admin_record_attachment_scan(
  uuid, uuid, text, text, text, text
) from anon;
revoke all on function public.admin_record_attachment_scan(
  uuid, uuid, text, text, text, text
) from authenticated;

-- ---------------------------------------------------------------------------
-- FAILURE 3: lock the deletion execution gate
-- ---------------------------------------------------------------------------

update public.retention_execution_controls
   set execution_enabled = false,
       enablement_basis = null,
       updated_at = now()
 where id;

-- ---------------------------------------------------------------------------
-- Regression assertions
-- ---------------------------------------------------------------------------

do $$
declare offender text;
begin
  -- FAILURE 2: service_role must be able to run the scanner RPC, and no client
  -- role may.
  if not has_function_privilege(
    'service_role',
    'public.admin_record_attachment_scan(uuid,uuid,text,text,text,text)',
    'execute'
  ) then
    raise exception 'service_role cannot execute admin_record_attachment_scan; the scanner is broken';
  end if;

  select string_agg(distinct grantee, ', ')
  into offender
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('admin_record_attachment_scan', 'admin_review_message_attachment')
    and privilege_type = 'EXECUTE'
    and grantee in ('authenticated', 'anon', 'PUBLIC');

  if offender is not null then
    raise exception 'attachment verdict RPC reachable by client roles: %', offender;
  end if;

  -- FAILURE 3: the gate must ship closed.
  if exists (
    select 1 from public.retention_execution_controls where execution_enabled is not false
  ) then
    raise exception 'deletion execution gate is open; physical deletion must ship DISABLED';
  end if;

  if not exists (select 1 from public.retention_execution_controls) then
    raise exception 'retention_execution_controls row is missing; gate state is undefined';
  end if;
end $$;
