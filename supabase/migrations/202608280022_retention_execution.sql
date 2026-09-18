-- Retention evaluation (read-only) and the reviewed deletion executor.
--
-- Closes two concrete gaps:
--   1. src/service-domain.js:245 retentionCandidates() had no database equivalent,
--      so retention could only ever be evaluated in memory.
--   2. public.deletion_jobs already carried status/started_at/completed_at/failure_code
--      (202608280012) but nothing ever wrote them. There was no executor.
--
-- DESIGN CONSTRAINT found while implementing this: every household-scoped table --
-- including audit_events AND deletion_jobs itself -- cascades from households(id).
-- Deleting a household row therefore destroys the audit trail that has to record the
-- deletion, and destroys the deletion_jobs row whose status we were asked to set.
-- Execution is therefore recorded in retention_execution_ledger, which deliberately
-- has NO foreign key to households so that it survives the delete it documents.
--
-- Cascade completeness was verified rather than assumed: all 25 household-scoped FKs
-- say on delete cascade, and the six intra-household references that do not (plan_weeks
-- .plan_id, revision_requests.completed_plan_id, service_cases.order_id, resources
-- .substitute_resource_id, learner_profiles.learner_id, guardian_consents.learner_id)
-- all sit on tables that are themselves household-scoped and cascade directly. Postgres
-- runs the NO ACTION check at end of statement, by which point those referencing rows
-- are already gone, so a household delete completes rather than failing.
--
-- A future table that is NOT household-scoped but holds a non-cascading reference into
-- one would break that, and the delete would raise instead of partially applying -- a
-- single DELETE is atomic, so the executor's failure path records the whole job as
-- failed rather than leaving a half-deleted household.
--
-- The executor ships DISABLED. retention_execution_controls has RLS enabled with no
-- policies and no setter function, so execution_enabled cannot be flipped by any client
-- role -- only by direct database access, which is the separately approved step
-- (GOAL_COMPLETION_PLAN.md:51: physical deletion stays off until approvals exist).

-- Execution gate. Single row, defaulted off.
create table public.retention_execution_controls(
  id boolean primary key default true check(id),
  execution_enabled boolean not null default false,
  enablement_basis text check(enablement_basis is null or char_length(enablement_basis) between 10 and 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check(not execution_enabled or enablement_basis is not null)
);
insert into public.retention_execution_controls(id,execution_enabled) values(true,false) on conflict(id) do nothing;
alter table public.retention_execution_controls enable row level security;
-- Intentionally no policies: 202608280014 grants authenticated select on tables created
-- after it, so a select grant will exist on this table -- RLS with no policy is what
-- actually denies every row. Do not add a policy here to "fix" a permission error.

-- Append-only execution record. Survives the household it documents.
create table public.retention_execution_ledger(
  id bigint generated always as identity primary key,
  deletion_job_id uuid not null,
  household_ref uuid not null,
  privacy_request_ref uuid not null,
  outcome text not null check(outcome in ('completed','failed')),
  failure_code text check(failure_code is null or char_length(failure_code) between 2 and 80),
  scheduled_eligible_at timestamptz not null,
  executed_at timestamptz not null default now(),
  -- approved_by is carried over from the job: the human who authorized the deletion.
  approved_by uuid references auth.users(id) on delete set null,
  -- executed_by is whoever ran the executor (the service role), which is not the approver.
  executed_by uuid references auth.users(id) on delete set null,
  -- household_ref is an opaque uuid kept for reconciliation and idempotency. It is not
  -- personal data and carries no FK, so nothing cascades it away.
  -- This constraint is named explicitly because the executor's OUT parameter is also
  -- called deletion_job_id, which makes a bare `on conflict (deletion_job_id)` ambiguous
  -- at runtime -- plpgsql cannot tell the column from the variable. Naming the constraint
  -- keeps the returned column name honest instead of renaming the API to dodge the parser.
  constraint retention_execution_ledger_job_unique unique(deletion_job_id),
  check((outcome='completed' and failure_code is null) or (outcome='failed' and failure_code is not null))
);
create index retention_execution_ledger_executed_idx on public.retention_execution_ledger(executed_at desc);
alter table public.retention_execution_ledger enable row level security;
-- Intentionally no policies: after execution the household has no members left who
-- could be authorized to read it. Operator access is direct database access.

-- Read-only retention dry run. Mirrors src/service-domain.js retentionCandidates()
-- exactly, including the closed_at ?? updated_at fallback for cases.
create or replace function public.admin_retention_candidates(
  target_household uuid,
  deleted_household_days integer default 30,
  closed_case_days integer default 365,
  as_of timestamptz default now()
) returns table(candidate_type text,candidate_id uuid,eligible_since timestamptz)
language plpgsql security definer set search_path=public
as $$
declare evaluated timestamptz:=coalesce(as_of,now());
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then
    raise exception 'admin access required' using errcode='42501';
  end if;
  if deleted_household_days not between 1 and 3650 or closed_case_days not between 1 and 3650 then
    raise exception 'retention windows are invalid';
  end if;
  return query
    select 'household'::text,h.id,h.deleted_at
      from public.households h
     where h.id=target_household
       and h.deleted_at is not null
       and evaluated-h.deleted_at>=make_interval(days=>deleted_household_days)
    union all
    select 'case'::text,c.id,coalesce(c.closed_at,c.updated_at)
      from public.service_cases c
     where c.household_id=target_household
       and c.status='closed'
       and coalesce(c.closed_at,c.updated_at) is not null
       and evaluated-coalesce(c.closed_at,c.updated_at)>=make_interval(days=>closed_case_days);
end $$;

-- Least-privilege deletion executor. Runs as a scheduled job under the database owner
-- (or the Supabase service role), never as an authenticated end user: a household admin
-- must not be able to trigger household-wide physical deletion from the client.
create or replace function public.admin_execute_due_deletion_jobs(max_jobs integer default 5)
returns table(deletion_job_id uuid,target_household uuid,job_status text,failure_code text)
language plpgsql security definer set search_path=public
as $$
declare
  control public.retention_execution_controls%rowtype;
  job_row public.deletion_jobs%rowtype;
  executed timestamptz;
begin
  if max_jobs not between 1 and 100 then raise exception 'max_jobs is invalid'; end if;

  select * into control from public.retention_execution_controls where id;
  if not found or control.execution_enabled is not true then
    raise exception 'physical deletion execution is disabled' using errcode='42501';
  end if;

  -- status='scheduled' already excludes cancelled jobs; not legal_hold excludes holds;
  -- FOR UPDATE SKIP LOCKED keeps concurrent runners from double-processing a job.
  for job_row in
    select * from public.deletion_jobs
     where status='scheduled' and not legal_hold and eligible_at<=now()
     order by eligible_at
     limit max_jobs
     for update skip locked
  loop
    -- Re-assert the safeguards at execution time. The scheduling-time checks in
    -- 202608280012 are not sufficient: the household can be altered in between.
    if job_row.identity_verified is not true or job_row.co_guardian_reviewed is not true then
      update public.deletion_jobs set status='failed',completed_at=now(),failure_code='safeguards_missing' where id=job_row.id;
      insert into public.retention_execution_ledger(deletion_job_id,household_ref,privacy_request_ref,outcome,failure_code,scheduled_eligible_at,approved_by,executed_by)
      values(job_row.id,job_row.household_id,job_row.privacy_request_id,'failed','safeguards_missing',job_row.eligible_at,job_row.approved_by,auth.uid())
      on conflict on constraint retention_execution_ledger_job_unique do nothing;
      deletion_job_id:=job_row.id;target_household:=job_row.household_id;job_status:='failed';failure_code:='safeguards_missing';
      return next;
      continue;
    end if;

    update public.deletion_jobs set status='running',started_at=now(),completed_at=null,failure_code=null where id=job_row.id;

    begin
      -- Cascade reaches every household-scoped table: memberships, learners, profiles,
      -- consents, cases, plans, lessons, messages, attachments, audit events, and this
      -- deletion_jobs row. The ledger written below is the surviving record.
      delete from public.households where id=job_row.household_id;
      executed:=now();
      insert into public.retention_execution_ledger(deletion_job_id,household_ref,privacy_request_ref,outcome,scheduled_eligible_at,executed_at,approved_by,executed_by)
      values(job_row.id,job_row.household_id,job_row.privacy_request_id,'completed',job_row.eligible_at,executed,job_row.approved_by,auth.uid())
      on conflict on constraint retention_execution_ledger_job_unique do nothing;
      deletion_job_id:=job_row.id;target_household:=job_row.household_id;job_status:='completed';failure_code:=null;
      return next;
    exception when others then
      -- Failure keeps the household intact, so the job row survives and carries the code.
      update public.deletion_jobs set status='failed',completed_at=now(),failure_code=left('failed: '||coalesce(nullif(btrim(sqlerrm),''),'unknown'),80) where id=job_row.id;
      insert into public.retention_execution_ledger(deletion_job_id,household_ref,privacy_request_ref,outcome,failure_code,scheduled_eligible_at,approved_by,executed_by)
      values(job_row.id,job_row.household_id,job_row.privacy_request_id,'failed',left('failed: '||coalesce(nullif(btrim(sqlerrm),''),'unknown'),80),job_row.eligible_at,job_row.approved_by,auth.uid())
      on conflict on constraint retention_execution_ledger_job_unique do nothing;
      deletion_job_id:=job_row.id;target_household:=job_row.household_id;job_status:='failed';failure_code:=left('failed: '||coalesce(nullif(btrim(sqlerrm),''),'unknown'),80);
      return next;
    end;
  end loop;
end $$;

revoke all on function public.admin_retention_candidates(uuid,integer,integer,timestamptz) from public;
grant execute on function public.admin_retention_candidates(uuid,integer,integer,timestamptz) to authenticated;

-- Deliberately NOT granted to authenticated: only the database owner / service role
-- that runs the scheduled job may execute physical deletion.
revoke all on function public.admin_execute_due_deletion_jobs(integer) from public;
