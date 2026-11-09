-- 065: deleting a family also deletes its sign-in accounts (owner decision 2026-10-21).
--
-- WHY
--   A family's deletion request removed every household row, but the guardian's sign-in account
--   (auth.users: their email) stayed, along with the sign-in service's log entries about them.
--   Cameron decided that the email goes too, so nothing about the family is left.
--
-- WHAT CHANGES
--   1. erase_guardian_accounts(): deletes the given guardians' sign-in accounts, except anyone who
--      still belongs to another family or is on the staff team (a staff account keeps the plans
--      and messages it wrote). It also removes the sign-in service's log entries about them. The
--      sign-in service's own tables (sessions, identities) follow the account by its cascade.
--   2. admin_execute_due_deletion_jobs() calls it right after deleting the household, in the same
--      step: if the account cannot be erased, the job fails and nothing is deleted.
--   3. retention_execution_ledger.accounts_erased records how many accounts each job removed.
--
-- RERUNNABLE: add column if not exists, create or replace.

-- The functions below run as the account applying this file. Stop here, with nothing changed, if
-- it cannot delete sign-in accounts: otherwise every deletion job would fail later instead.
do $check$
begin
  if not has_table_privilege('auth.users', 'delete') then
    raise exception '065: % cannot delete from auth.users; apply this migration as an account that can', current_user;
  end if;
end $check$;

-- 3 ----------------------------------------------------------------------------------------------
alter table public.retention_execution_ledger add column if not exists accounts_erased integer;

-- 1 ----------------------------------------------------------------------------------------------
create or replace function public.erase_guardian_accounts(guardians uuid[])
returns integer
language plpgsql security definer set search_path = public, auth
as $function$
declare
  leaving uuid[];
  leaving_text text[];
  erased integer;
begin
  select coalesce(array_agg(u.id), '{}') into leaving
    from auth.users u
   where u.id = any(coalesce(guardians, '{}'))
     and not exists (select 1 from public.memberships m where m.user_id = u.id)
     and not exists (select 1 from public.staff_team t where t.user_id = u.id);

  if to_regclass('auth.audit_log_entries') is not null then
    leaving_text := array(select x::text from unnest(leaving) x);
    execute 'delete from auth.audit_log_entries where payload->>''actor_id'' = any($1)' using leaving_text;
  end if;
  delete from auth.users u where u.id = any(leaving);
  get diagnostics erased = row_count;
  return erased;
end $function$;
revoke all on function public.erase_guardian_accounts(uuid[]) from public, anon, authenticated;

-- 2 ----------------------------------------------------------------------------------------------
create or replace function public.admin_execute_due_deletion_jobs(max_jobs integer default 5)
returns table(
  deletion_job_id uuid,
  target_household uuid,
  job_status text,
  failure_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  control public.retention_execution_controls%rowtype;
  job_row record;
  executed timestamptz;
  guardians uuid[];
  erased integer;
begin
  if max_jobs not between 1 and 100 then raise exception 'max_jobs is invalid'; end if;

  -- Execution gate: physical deletion ships DISABLED and no client role can flip it.
  -- retention_execution_controls has RLS with no policies, so only direct database
  -- access (a separately approved step) can enable execution. Do not remove this.
  select * into control from public.retention_execution_controls where id;
  if not found or control.execution_enabled is not true then
    raise exception 'physical deletion execution is disabled' using errcode='42501';
  end if;

  for job_row in
    select dj.id, dj.household_id, dj.privacy_request_id, dj.eligible_at,
           dj.approved_by, dj.identity_verified, dj.co_guardian_reviewed
    from public.deletion_jobs dj
    where dj.status = 'scheduled'
      and not dj.legal_hold
      and dj.eligible_at <= now()
    order by dj.eligible_at
    limit max_jobs
    for update skip locked
  loop
    if job_row.identity_verified is not true or job_row.co_guardian_reviewed is not true then
      update public.deletion_jobs
         set status = 'failed', completed_at = now(), failure_code = 'safeguards_missing'
       where id = job_row.id;
      insert into public.retention_execution_ledger(deletion_job_id, household_ref, privacy_request_ref, outcome, failure_code, scheduled_eligible_at, approved_by, executed_by)
      values (job_row.id, job_row.household_id, job_row.privacy_request_id, 'failed', 'safeguards_missing', job_row.eligible_at, job_row.approved_by, auth.uid())
      on conflict on constraint retention_execution_ledger_job_unique do nothing;
      deletion_job_id := job_row.id;
      target_household := job_row.household_id;
      job_status := 'failed';
      failure_code := 'safeguards_missing';
      return next;
      continue;
    end if;

    update public.deletion_jobs
       set status = 'running', started_at = now(), completed_at = null, failure_code = null
     where id = job_row.id;

    begin
      -- Record the binaries that must be physically removed before the metadata
      -- rows cascade away. The service job drains this queue.
      insert into public.attachment_object_deletions(target_job, household_ref, object_path)
      select job_row.id, job_row.household_id, ca.object_path
      from public.case_attachments ca
      where ca.household_id = job_row.household_id
      on conflict (target_job, object_path) do nothing;

      -- 065: the family's guardians, read before the memberships cascade away.
      select coalesce(array_agg(m.user_id), '{}') into guardians
        from public.memberships m
       where m.household_id = job_row.household_id and m.role = 'guardian';

      -- Cascade reaches every household-scoped table.
      delete from public.households where id = job_row.household_id;

      -- 065: then each guardian's sign-in account (their email), unless they still belong to
      -- another family or are on the staff team. If this fails, the whole job fails and nothing
      -- is deleted, so it can be fixed and run again.
      erased := public.erase_guardian_accounts(guardians);
      executed := now();

      insert into public.retention_execution_ledger(deletion_job_id, household_ref, privacy_request_ref, outcome, scheduled_eligible_at, executed_at, approved_by, executed_by, accounts_erased)
      values (job_row.id, job_row.household_id, job_row.privacy_request_id, 'completed', job_row.eligible_at, executed, job_row.approved_by, auth.uid(), erased)
      on conflict on constraint retention_execution_ledger_job_unique do nothing;

      deletion_job_id := job_row.id;
      target_household := job_row.household_id;
      job_status := 'completed';
      failure_code := null;
      return next;
    exception when others then
      update public.deletion_jobs
         set status = 'failed', completed_at = now(),
             failure_code = left('failed: ' || coalesce(nullif(btrim(sqlerrm), ''), 'unknown'), 80)
       where id = job_row.id;
      insert into public.retention_execution_ledger(deletion_job_id, household_ref, privacy_request_ref, outcome, failure_code, scheduled_eligible_at, approved_by, executed_by)
      values (job_row.id, job_row.household_id, job_row.privacy_request_id, 'failed', left('failed: ' || coalesce(nullif(btrim(sqlerrm), ''), 'unknown'), 80), job_row.eligible_at, job_row.approved_by, auth.uid())
      on conflict on constraint retention_execution_ledger_job_unique do nothing;
      deletion_job_id := job_row.id;
      target_household := job_row.household_id;
      job_status := 'failed';
      failure_code := left('failed: ' || coalesce(nullif(btrim(sqlerrm), ''), 'unknown'), 80);
      return next;
    end;
  end loop;
end $$;
revoke all on function public.admin_execute_due_deletion_jobs(integer) from public;
revoke all on function public.admin_execute_due_deletion_jobs(integer) from authenticated;
revoke all on function public.admin_execute_due_deletion_jobs(integer) from anon;
grant execute on function public.admin_execute_due_deletion_jobs(integer) to service_role;
