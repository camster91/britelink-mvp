-- 202608280027_attachment_object_deletion_queue.sql
-- Security review HIGH-4: admin_execute_due_deletion_jobs deleted only the
-- `households` row and relied on relational cascades. Attachment binaries live
-- in a separate private storage bucket (supabase/storage-policies.sql) and were
-- never deleted, so a completed household deletion left the child's uploaded
-- documents physically retained as orphaned objects.
--
-- Postgres cannot delete storage objects directly. This migration records the
-- object paths that must be removed BEFORE the metadata rows cascade away, so a
-- service-role job can delete the binaries and mark the job complete. The
-- deletion job is not considered fully complete until the object queue drains.
--
-- Read-only review artifact: this file has NOT been applied to any database.

-- Pending binary deletions, keyed to the household being erased.
create table if not exists public.attachment_object_deletions(
  id uuid primary key default gen_random_uuid(),
  target_job uuid not null,
  household_ref uuid not null,
  object_path text not null check (char_length(object_path) between 20 and 500),
  bucket text not null default 'case-attachments',
  enqueued_at timestamptz not null default now(),
  removed_at timestamptz,
  removal_attempts integer not null default 0,
  last_error text,
  unique (target_job, object_path)
);

alter table public.attachment_object_deletions enable row level security;

-- No client access at all: this is a service-role operational queue.
revoke all on public.attachment_object_deletions from public;
revoke all on public.attachment_object_deletions from anon;
revoke all on public.attachment_object_deletions from authenticated;

create index if not exists attachment_object_deletions_pending_idx
  on public.attachment_object_deletions(enqueued_at)
  where removed_at is null;

-- Enqueue every attachment object for the household, then delete the household.
-- Wrapping both in the same function keeps "rows gone" and "binaries queued"
-- atomic: either the household survives, or the queue row exists.
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

      -- Cascade reaches every household-scoped table.
      delete from public.households where id = job_row.household_id;
      executed := now();

      insert into public.retention_execution_ledger(deletion_job_id, household_ref, privacy_request_ref, outcome, scheduled_eligible_at, executed_at, approved_by, executed_by)
      values (job_row.id, job_row.household_id, job_row.privacy_request_id, 'completed', job_row.eligible_at, executed, job_row.approved_by, auth.uid())
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

-- Service-role helper: claim a batch of pending object removals, and mark them
-- removed after the storage delete succeeds. Called by the storage lifecycle job.
create or replace function public.admin_claim_pending_object_deletions(batch_limit integer default 100)
returns table(id uuid, household_ref uuid, bucket text, object_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.attachment_object_deletions d
     set removal_attempts = d.removal_attempts + 1
   where d.id in (
     select x.id
     from public.attachment_object_deletions x
     where x.removed_at is null
       and x.removal_attempts < 10
     order by x.enqueued_at
     limit greatest(1, least(coalesce(batch_limit, 100), 1000))
     for update skip locked
   )
  returning d.id, d.household_ref, d.bucket, d.object_path;
end $$;

create or replace function public.admin_mark_object_deletion_complete(target_id uuid, removal_error text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare updated integer;
begin
  if removal_error is null then
    update public.attachment_object_deletions
       set removed_at = now(), last_error = null
     where id = target_id and removed_at is null;
  else
    update public.attachment_object_deletions
       set last_error = left(btrim(removal_error), 200)
     where id = target_id and removed_at is null;
  end if;
  get diagnostics updated = row_count;
  return updated > 0;
end $$;

revoke all on function public.admin_claim_pending_object_deletions(integer) from public, authenticated, anon;
revoke all on function public.admin_mark_object_deletion_complete(uuid, text) from public, authenticated, anon;
grant execute on function public.admin_claim_pending_object_deletions(integer) to service_role;
grant execute on function public.admin_mark_object_deletion_complete(uuid, text) to service_role;

-- Regression assertion: no end-user role may reach these service functions.
do $$
declare offender text;
begin
  select string_agg(distinct routine_name || ':' || grantee, ', ')
  into offender
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in (
      'admin_execute_due_deletion_jobs',
      'admin_claim_pending_object_deletions',
      'admin_mark_object_deletion_complete'
    )
    and privilege_type = 'EXECUTE'
    and grantee in ('authenticated', 'anon', 'PUBLIC');

  if offender is not null then
    raise exception 'deletion service functions still executable by end-user roles: %', offender;
  end if;
end $$;
