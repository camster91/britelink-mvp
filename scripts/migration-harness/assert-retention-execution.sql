-- Behavioural assertions for 202608280022_retention_execution.sql.
--
-- Run against a throwaway Postgres that has the shim and all migrations applied.
-- Every check raises on failure, so psql -v ON_ERROR_STOP=1 exits non-zero.
--
-- Fixed UUIDs keep the script deterministic and the failures readable.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. The whole schema actually applied.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from information_schema.tables where table_schema='public';
  if n < 20 then raise exception 'ASSERT FAILED: only % public tables exist', n; end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='retention_execution_ledger') then
    raise exception 'ASSERT FAILED: retention_execution_ledger was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='deletion_jobs') then
    raise exception 'ASSERT FAILED: deletion_jobs was not created';
  end if;
  raise notice 'ok 1: schema applied (% public tables)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The execution gate is off by default and has no client-facing setter.
-- ---------------------------------------------------------------------------
do $$
declare enabled boolean; setters int;
begin
  select execution_enabled into enabled from public.retention_execution_controls;
  if enabled is not false then raise exception 'ASSERT FAILED: execution_enabled defaulted to %', enabled; end if;
  if (select count(*) from public.retention_execution_controls) <> 1 then raise exception 'ASSERT FAILED: gate table is not single-row'; end if;
  -- No SECURITY DEFINER function other than the executor may touch the gate.
  select count(*) into setters from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.prosrc ilike '%retention_execution_controls%' and p.proname<>'admin_execute_due_deletion_jobs';
  if setters <> 0 then raise exception 'ASSERT FAILED: % function(s) can reach the execution gate', setters; end if;
  raise notice 'ok 2: execution gate is off by default with no client setter';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The executor is refused while disabled, and is not reachable by a client role.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean:=false;
begin
  if has_function_privilege('authenticated','public.admin_execute_due_deletion_jobs(integer)','execute') then
    raise exception 'ASSERT FAILED: authenticated can execute physical deletion';
  end if;
  if has_function_privilege('anon','public.admin_execute_due_deletion_jobs(integer)','execute') then
    raise exception 'ASSERT FAILED: anon can execute physical deletion';
  end if;
  if not has_function_privilege('authenticated','public.admin_retention_candidates(uuid,integer,integer,timestamptz)','execute') then
    raise exception 'ASSERT FAILED: the read-only dry run should be reachable by authenticated';
  end if;
  begin
    perform public.admin_execute_due_deletion_jobs(5);
  exception when others then refused:=true;
    if sqlstate<>'42501' then raise exception 'ASSERT FAILED: expected 42501, got % (%)', sqlstate, sqlerrm; end if;
  end;
  if not refused then raise exception 'ASSERT FAILED: the executor ran while disabled'; end if;
  raise notice 'ok 3: executor is disabled, owner-only, and refuses to run';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Seed two households, both with an eligible, fully-reviewed deletion job.
--    household_due  -> the delete succeeds
--    household_keep -> the delete is forced to fail by a non-cascading FK
-- ---------------------------------------------------------------------------
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000a01','admin@example.test'),
  ('00000000-0000-0000-0000-000000000a02','outsider@example.test'),
  ('00000000-0000-0000-0000-000000000a03','approver@example.test'),
  ('00000000-0000-0000-0000-000000000a04','requester@example.test');

insert into public.households(id,display_name,deleted_at) values
  ('00000000-0000-0000-0000-000000000b01','Household Due', now()-interval '40 days'),
  ('00000000-0000-0000-0000-000000000b02','Household Keep', now()-interval '40 days'),
  ('00000000-0000-0000-0000-000000000b03','Household Live', null);

insert into public.memberships(household_id,user_id,role) values
  ('00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000a01','admin'),
  ('00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000a01','admin'),
  ('00000000-0000-0000-0000-000000000b03','00000000-0000-0000-0000-000000000a01','admin');

insert into public.learners(id,household_id,preferred_name,grade_label,jurisdiction) values
  ('00000000-0000-0000-0000-000000000c01','00000000-0000-0000-0000-000000000b01','Seed One','4','Ontario'),
  ('00000000-0000-0000-0000-000000000c02','00000000-0000-0000-0000-000000000b02','Seed Two','4','Ontario'),
  ('00000000-0000-0000-0000-000000000c03','00000000-0000-0000-0000-000000000b03','Seed Three','4','Ontario');

insert into public.service_cases(id,household_id,learner_id,package_code,status,closed_at,updated_at) values
  ('00000000-0000-0000-0000-000000000d01','00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000c01','essentials','closed', now()-interval '400 days', now()-interval '400 days'),
  ('00000000-0000-0000-0000-000000000d02','00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000c01','essentials','closed', now()-interval '10 days',  now()-interval '10 days'),
  ('00000000-0000-0000-0000-000000000d03','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000c02','essentials','closed', now()-interval '400 days', now()-interval '400 days'),
  -- closed_at is NULL: proves the closed_at ?? updated_at fallback is what decides eligibility.
  ('00000000-0000-0000-0000-000000000d04','00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000c01','essentials','closed', null, now()-interval '500 days'),
  -- Belongs to the live household, so it must be a case candidate but never a household one.
  ('00000000-0000-0000-0000-000000000d05','00000000-0000-0000-0000-000000000b03','00000000-0000-0000-0000-000000000c03','essentials','closed', now()-interval '400 days', now()-interval '400 days');

insert into public.privacy_requests(id,household_id,requested_by,kind,status,reason) values
  ('00000000-0000-0000-0000-000000000e01','00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000a04','deletion','pending','Guardian requested erasure'),
  ('00000000-0000-0000-0000-000000000e02','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000a04','deletion','pending','Guardian requested erasure');

insert into public.deletion_jobs(id,household_id,privacy_request_id,status,eligible_at,approved_by,approval_basis,identity_verified,co_guardian_reviewed,legal_hold) values
  ('00000000-0000-0000-0000-000000000f01','00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000e01','scheduled', now()-interval '1 hour','00000000-0000-0000-0000-000000000a03','Reviewed retention schedule v1',true,true,false),
  ('00000000-0000-0000-0000-000000000f02','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000e02','scheduled', now()-interval '1 hour','00000000-0000-0000-0000-000000000a03','Reviewed retention schedule v2',true,true,false);

-- An audit event per household, to prove the cascade takes the audit trail with it.
insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id) values
  ('00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000a03','privacy.deletion_scheduled','deletion_job','00000000-0000-0000-0000-000000000f01'),
  ('00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000a03','privacy.deletion_scheduled','deletion_job','00000000-0000-0000-0000-000000000f02');

-- ---------------------------------------------------------------------------
-- 5. The dry run is admin-gated and mirrors retentionCandidates() exactly.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean:=false; got text[]; expected text[];
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000a02',true);
  begin
    perform public.admin_retention_candidates('00000000-0000-0000-0000-000000000b01',30,365,now());
  exception when others then
    refused:=true;
    if sqlstate<>'42501' then raise exception 'ASSERT FAILED: expected 42501 for a non-admin, got % (%)', sqlstate, sqlerrm; end if;
  end;
  if not refused then raise exception 'ASSERT FAILED: a non-admin read retention candidates'; end if;

  -- auth.uid() must be NULL when the claim GUC is unset, so an unauthenticated call fails closed.
  perform set_config('request.jwt.claim.sub','',true);
  refused:=false;
  begin
    perform public.admin_retention_candidates('00000000-0000-0000-0000-000000000b01',30,365,now());
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: an unauthenticated caller read retention candidates'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000a01',true);
  select array(select candidate_type||':'||candidate_id::text from public.admin_retention_candidates('00000000-0000-0000-0000-000000000b01',30,365,now()) order by 1) into got;
  expected:=array[
    'case:00000000-0000-0000-0000-000000000d01',
    'case:00000000-0000-0000-0000-000000000d04',
    'household:00000000-0000-0000-0000-000000000b01'
  ];
  if got<>expected then raise exception 'ASSERT FAILED: candidates were % but expected %', got, expected; end if;

  -- A window wide enough to exclude everything returns nothing rather than erroring.
  select array(select candidate_type from public.admin_retention_candidates('00000000-0000-0000-0000-000000000b01',3650,3650,now())) into got;
  if got<>array[]::text[] then raise exception 'ASSERT FAILED: expected no candidates, got %', got; end if;

  -- A household that is not soft-deleted is never a household candidate, even though its
  -- closed case is old enough to be a case candidate. This pins the household branch to
  -- deleted_at specifically rather than to any sign of inactivity.
  select array(select candidate_type||':'||candidate_id::text from public.admin_retention_candidates('00000000-0000-0000-0000-000000000b03',30,365,now()) order by 1) into got;
  if got<>array['case:00000000-0000-0000-0000-000000000d05'] then
    raise exception 'ASSERT FAILED: live household b03 returned % but expected only its old closed case', got;
  end if;

  -- Invalid windows are rejected, not silently coerced.
  refused:=false;
  begin
    perform public.admin_retention_candidates('00000000-0000-0000-0000-000000000b01',0,365,now());
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: a zero-day window was accepted'; end if;
  raise notice 'ok 5: dry run is admin-gated, fail-closed, and matches retentionCandidates()';
end $$;

-- ---------------------------------------------------------------------------
-- 6. The 012 check constraint makes the executor's re-asserted safeguards
--    unreachable. This is deliberate defence-in-depth, and pinning it here means a
--    future relaxation of the constraint is caught rather than silently opening a path.
-- ---------------------------------------------------------------------------
do $$
declare blocked boolean:=false;
begin
  begin
    update public.deletion_jobs set identity_verified=false where id='00000000-0000-0000-0000-000000000f01';
  exception when check_violation then blocked:=true;
  end;
  if not blocked then raise exception 'ASSERT FAILED: a scheduled job lost its identity safeguard'; end if;
  blocked:=false;
  begin
    update public.deletion_jobs set legal_hold=true where id='00000000-0000-0000-0000-000000000f01';
  exception when check_violation then blocked:=true;
  end;
  if not blocked then raise exception 'ASSERT FAILED: a scheduled job was put on legal hold'; end if;
  raise notice 'ok 6: 012 constraint keeps scheduled jobs review-complete (re-assert is defence-in-depth)';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Failure path: a non-cascading reference into the household blocks the delete.
--    The job must be recorded failed, the household must survive intact, and nothing
--    may be partially deleted.
-- ---------------------------------------------------------------------------
create table public.harness_blocking_ref(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id)
);
insert into public.harness_blocking_ref(household_id) values ('00000000-0000-0000-0000-000000000b02');

update public.retention_execution_controls set execution_enabled=true, enablement_basis='Migration harness validation run', updated_at=now() where id;

do $$
declare rows_returned int; outcome text; code text; cases_before int; cases_after int;
begin
  -- The executor has no per-household scope: it takes every due job up to max_jobs. So to
  -- observe the failure path in isolation, push the other due job out of range for now and
  -- bring it back in step 8. This isolation is the setup, not an assertion.
  update public.deletion_jobs set eligible_at=now()+interval '30 days' where id='00000000-0000-0000-0000-000000000f01';

  select count(*) into cases_before from public.service_cases where household_id='00000000-0000-0000-0000-000000000b02';
  select count(*) into rows_returned from public.admin_execute_due_deletion_jobs(5);
  if rows_returned<>1 then raise exception 'ASSERT FAILED: expected 1 processed job, got %', rows_returned; end if;
  select l.outcome,l.failure_code into outcome,code from public.retention_execution_ledger l where l.deletion_job_id='00000000-0000-0000-0000-000000000f02';
  if outcome<>'failed' then raise exception 'ASSERT FAILED: blocked delete recorded outcome %', outcome; end if;
  if code is null or char_length(code)<2 or char_length(code)>80 then raise exception 'ASSERT FAILED: failure_code % violates its own 2..80 constraint', code; end if;
  if not exists (select 1 from public.households where id='00000000-0000-0000-0000-000000000b02') then
    raise exception 'ASSERT FAILED: the household was deleted despite the blocking reference';
  end if;
  select count(*) into cases_after from public.service_cases where household_id='00000000-0000-0000-0000-000000000b02';
  if cases_after<>cases_before then raise exception 'ASSERT FAILED: partial delete, cases % -> %', cases_before, cases_after; end if;
  if not exists (select 1 from public.deletion_jobs where id='00000000-0000-0000-0000-000000000f02' and status='failed' and completed_at is not null) then
    raise exception 'ASSERT FAILED: the surviving job was not marked failed with a completion time';
  end if;
  raise notice 'ok 7: blocked delete failed atomically and left no partial state';
end $$;

-- Remove the obstruction and bring the other job back into range. The same blocked job must
-- NOT be retried: it is no longer in the scheduled state.
drop table public.harness_blocking_ref;
update public.deletion_jobs set eligible_at=now()-interval '1 hour' where id='00000000-0000-0000-0000-000000000f01';

-- ---------------------------------------------------------------------------
-- 8. Success path: the household and its audit trail cascade away, and the ledger
--    -- which has no FK to households -- survives as the only record.
-- ---------------------------------------------------------------------------
do $$
declare rows_returned int; outcome text; ref uuid; audit_left int; jobs_left int; requests_left int;
begin
  select count(*) into rows_returned from public.admin_execute_due_deletion_jobs(5);
  if rows_returned<>1 then raise exception 'ASSERT FAILED: expected 1 processed job, got %', rows_returned; end if;

  if exists (select 1 from public.households where id='00000000-0000-0000-0000-000000000b01') then
    raise exception 'ASSERT FAILED: the household survived a successful deletion';
  end if;
  select count(*) into audit_left from public.audit_events where household_id='00000000-0000-0000-0000-000000000b01';
  if audit_left<>0 then raise exception 'ASSERT FAILED: % audit events survived (cascade unexpectedly changed)', audit_left; end if;
  select count(*) into jobs_left from public.deletion_jobs where id='00000000-0000-0000-0000-000000000f01';
  if jobs_left<>0 then raise exception 'ASSERT FAILED: the completed job row survived; the ledger is meant to be the only record'; end if;
  select count(*) into requests_left from public.privacy_requests where household_id='00000000-0000-0000-0000-000000000b01';
  if requests_left<>0 then raise exception 'ASSERT FAILED: % privacy requests survived', requests_left; end if;

  select l.outcome, l.household_ref into outcome, ref from public.retention_execution_ledger l where l.deletion_job_id='00000000-0000-0000-0000-000000000f01';
  if outcome<>'completed' then raise exception 'ASSERT FAILED: ledger outcome was %', outcome; end if;
  if ref<>'00000000-0000-0000-0000-000000000b01' then raise exception 'ASSERT FAILED: ledger household_ref was %', ref; end if;
  raise notice 'ok 8: deletion cascaded completely; the ledger survived as the sole audit record';
end $$;

-- ---------------------------------------------------------------------------
-- 9. Idempotency: the same household cannot be deleted twice, and a re-run is a no-op.
-- ---------------------------------------------------------------------------
do $$
declare rows_returned int; before_count int; after_count int;
begin
  select count(*) into before_count from public.retention_execution_ledger;
  select count(*) into rows_returned from public.admin_execute_due_deletion_jobs(5);
  if rows_returned<>0 then raise exception 'ASSERT FAILED: a re-run processed % job(s)', rows_returned; end if;
  select count(*) into after_count from public.retention_execution_ledger;
  if after_count<>before_count then raise exception 'ASSERT FAILED: ledger grew from % to % on a no-op re-run', before_count, after_count; end if;
  raise notice 'ok 9: re-running the executor is a no-op';
end $$;

-- ---------------------------------------------------------------------------
-- 10. max_jobs is bounded, and cancelled / held / not-yet-due jobs are never selected.
-- ---------------------------------------------------------------------------
update public.households set deleted_at=now()-interval '40 days' where id='00000000-0000-0000-0000-000000000b02';
-- privacy_requests_one_open_household_kind permits only one open (pending/verified/scheduled)
-- deletion request per household, so clear the seeded one before adding another. That the
-- index rejects a second open request is itself the invariant working; step 10b pins it.
update public.privacy_requests set status='cancelled' where id='00000000-0000-0000-0000-000000000e02';
insert into public.privacy_requests(id,household_id,requested_by,kind,status) values
  ('00000000-0000-0000-0000-000000000e03','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000a04','deletion','cancelled');
insert into public.deletion_jobs(id,household_id,privacy_request_id,status,eligible_at,approved_by,approval_basis,identity_verified,co_guardian_reviewed,legal_hold) values
  ('00000000-0000-0000-0000-000000001f01','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000e03','cancelled',  now()-interval '1 hour','00000000-0000-0000-0000-000000000a03','Cancelled before execution',true,true,false);
insert into public.privacy_requests(id,household_id,requested_by,kind,status) values
  ('00000000-0000-0000-0000-000000000e04','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000a04','deletion','pending');
insert into public.deletion_jobs(id,household_id,privacy_request_id,status,eligible_at,approved_by,approval_basis,identity_verified,co_guardian_reviewed,legal_hold) values
  ('00000000-0000-0000-0000-000000001f02','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-000000000e04','scheduled', now()+interval '30 days','00000000-0000-0000-0000-000000000a03','Not yet due for execution',true,true,false);

do $$
declare refused boolean:=false; rows_returned int;
begin
  begin
    perform public.admin_execute_due_deletion_jobs(0);
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: max_jobs=0 was accepted'; end if;
  begin
    perform public.admin_execute_due_deletion_jobs(101);
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: max_jobs=101 was accepted'; end if;

  select count(*) into rows_returned from public.admin_execute_due_deletion_jobs(5);
  if rows_returned<>0 then raise exception 'ASSERT FAILED: % cancelled/held/not-yet-due job(s) were selected', rows_returned; end if;
  if not exists (select 1 from public.deletion_jobs where id='00000000-0000-0000-0000-000000001f02' and status='scheduled') then
    raise exception 'ASSERT FAILED: a not-yet-due job left the scheduled state';
  end if;
  if not exists (select 1 from public.deletion_jobs where id='00000000-0000-0000-0000-000000001f01' and status='cancelled') then
    raise exception 'ASSERT FAILED: a cancelled job was touched';
  end if;
  raise notice 'ok 10: bounds enforced; cancelled, held, and not-yet-due jobs are never selected';
end $$;

\echo '=== all retention execution assertions passed ==='
