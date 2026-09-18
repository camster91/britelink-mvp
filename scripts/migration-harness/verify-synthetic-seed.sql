-- Verifies the synthetic staging seed actually produces what it claims.
--
-- Run AFTER supabase/seed/synthetic-staging.sql. This is not an assert-*.sql file on purpose:
-- the harness globs assert-*.sql *before* applying the seed, and this file depends on the
-- seed already being present. The name is the signal for that ordering.
--
-- What this adds over "the SQL parsed without error":
--   1. every id the seed prints in its .env block resolves, in the right household -- the
--      block is only worth printing if a typo in it cannot survive;
--   2. the seeded deletion job is genuinely NOT due, so no executor run can ever consume
--      household B and take all 24 D2 mutation checks down with it;
--   3. the storage policies in supabase/storage-policies.sql admit the seeded pending upload
--      and refuse the counterparty's clean object -- previously those policies were applied
--      but never exercised against a real row.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Every id in the emitted env block resolves, in the correct household.
-- ---------------------------------------------------------------------------
do $$
declare missing text[] := '{}';
begin
  if not exists (select 1 from public.households where id='5eed0000-0000-4000-8000-0000000000a1') then missing:=missing||'HOUSEHOLD_A_ID'; end if;
  if not exists (select 1 from public.households where id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_ID'; end if;
  if not exists (select 1 from public.learners where id='5eed0000-0000-4000-8000-000000000b10' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_LEARNER_ID'; end if;
  if not exists (select 1 from public.service_cases where id='5eed0000-0000-4000-8000-000000000b20' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_CASE_ID'; end if;
  if not exists (select 1 from public.plans where id='5eed0000-0000-4000-8000-000000000b30' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_PLAN_ID'; end if;
  if not exists (select 1 from public.lessons where id='5eed0000-0000-4000-8000-000000000b50' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_LESSON_ID'; end if;
  if not exists (select 1 from public.lesson_activities where id='5eed0000-0000-4000-8000-000000000b51' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_ACTIVITY_ID'; end if;
  if not exists (select 1 from public.case_messages where id='5eed0000-0000-4000-8000-000000000b70' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_MESSAGE_ID'; end if;
  if not exists (select 1 from public.deliveries where id='5eed0000-0000-4000-8000-000000000ba0' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_DELIVERY_ID'; end if;
  if not exists (select 1 from public.revision_requests where id='5eed0000-0000-4000-8000-000000000bb0' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_REVISION_ID'; end if;
  if not exists (select 1 from public.case_attachments where id='5eed0000-0000-4000-8000-000000000b80' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_ATTACHMENT_ID'; end if;
  if not exists (select 1 from public.guardian_consents where id='5eed0000-0000-4000-8000-000000000b61' and household_id='5eed0000-0000-4000-8000-0000000000b1') then missing:=missing||'HOUSEHOLD_B_CONSENT_ID'; end if;
  if not exists (select 1 from public.case_attachments where object_path='5eed0000-0000-4000-8000-0000000000b1/5eed0000-0000-4000-8000-000000000b20/5eed0000-0000-4000-8000-000000000b80.pdf') then missing:=missing||'HOUSEHOLD_B_OBJECT_PATH'; end if;

  -- The four staff identities are passed in, so these also catch a caller who handed the seed
  -- a uuid that never landed in auth.users.
  if not exists (select 1 from public.memberships where user_id='5eed0000-0000-4000-8000-00000000ad01' and household_id='5eed0000-0000-4000-8000-0000000000a1' and role='admin') then missing:=missing||'ADMIN_A_USER_ID'; end if;
  if not exists (select 1 from public.memberships where user_id='5eed0000-0000-4000-8000-00000000ad02' and household_id='5eed0000-0000-4000-8000-0000000000a1' and role='guardian') then missing:=missing||'GUARDIAN_A_USER_ID'; end if;
  if not exists (select 1 from public.memberships where user_id='5eed0000-0000-4000-8000-00000000ad03' and household_id='5eed0000-0000-4000-8000-0000000000a1' and role='educator') then missing:=missing||'EDUCATOR_A_USER_ID'; end if;

  if array_length(missing,1) > 0 then
    raise exception 'ASSERT FAILED: env block names % id(s) that do not resolve: %', array_length(missing,1), array_to_string(missing,', ');
  end if;
  raise notice 'ok 1: all 16 ids in the emitted env block resolve in their intended household';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The seeded deletion job can never be selected by the executor.
-- ---------------------------------------------------------------------------
do $$
declare due int; job public.deletion_jobs%rowtype;
begin
  select * into job from public.deletion_jobs where id='5eed0000-0000-4000-8000-000000000be0';
  if not found then raise exception 'ASSERT FAILED: the seeded deletion job is missing'; end if;
  if job.status<>'scheduled' then raise exception 'ASSERT FAILED: expected status scheduled, got %', job.status; end if;
  if job.eligible_at <= now() then
    raise exception 'ASSERT FAILED: the seeded job is DUE (eligible_at %). admin_execute_due_deletion_jobs() has no household scope, so the next executor run anywhere would physically delete household B, the isolation counterparty. Move eligible_at into the future.', job.eligible_at;
  end if;

  -- Assert the executor's own predicate, not just the timestamp: this is the exact WHERE
  -- clause from 022, minus the gate check. It must select zero of the seed's rows even in a
  -- database where the executor is enabled.
  select count(*) into due from public.deletion_jobs
   where status='scheduled' and not legal_hold and eligible_at<=now()
     and household_id in ('5eed0000-0000-4000-8000-0000000000a1','5eed0000-0000-4000-8000-0000000000b1');
  if due<>0 then raise exception 'ASSERT FAILED: % seeded job(s) satisfy the executor predicate', due; end if;
  raise notice 'ok 2: the seeded deletion job is not due; no executor run can consume household B';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Storage policies, exercised against real rows.
-- ---------------------------------------------------------------------------
-- The shim (supabase-shim.sql) creates storage.objects but grants authenticated nothing on it,
-- because it only needed the table to exist for the policies to be declared. Real Supabase's
-- storage service grants these. Without them the checks below would fail as permission errors
-- rather than exercising a policy, which would be a vacuous pass dressed as a strict one.
grant select, insert on storage.objects to authenticated;

-- On real Supabase the operator creates this bucket in the dashboard with a 10 MB limit and a
-- MIME allow-list; storage-policies.sql's header says so. The harness has no dashboard, so the
-- bucket is created here or the policies have nothing to apply to.
insert into storage.buckets(id,name,public) values('case-attachments','case-attachments',false)
on conflict (id) do nothing;

-- The counterparty's clean object, written the way the scan pipeline would (service role, so
-- no upload policy applies). It must EXIST for the denial check below to mean anything.
insert into storage.objects(id,bucket_id,name,owner) values
  ('5eed0000-0000-4000-8000-0000000000c1','case-attachments',
   '5eed0000-0000-4000-8000-0000000000b1/5eed0000-0000-4000-8000-000000000b20/5eed0000-0000-4000-8000-000000000b80.pdf', null)
on conflict (id) do nothing;

do $$
declare visible int; allowed boolean:=false;
begin
  -- guardian_a is a member of household A only.
  perform set_config('request.jwt.claim.sub','5eed0000-0000-4000-8000-00000000ad02',true);
  set local role authenticated;

  -- Positive control first: the seeded pending_upload must satisfy case_attachment_owner_upload.
  -- If this were skipped, the denial below could pass for the wrong reason.
  begin
    insert into storage.objects(bucket_id,name,owner)
    values('case-attachments',
           '5eed0000-0000-4000-8000-0000000000a1/5eed0000-0000-4000-8000-000000000a20/5eed0000-0000-4000-8000-000000000a80.pdf',
           '5eed0000-0000-4000-8000-00000000ad02'::uuid);
    allowed:=true;
  exception when others then
    raise exception 'ASSERT FAILED: the upload policy refused the seeded pending_upload path (%: %)', sqlstate, sqlerrm;
  end;
  if not allowed then raise exception 'ASSERT FAILED: upload was neither allowed nor refused'; end if;

  -- Negative: the counterparty's clean object exists, and must still be invisible.
  select count(*) into visible from storage.objects
   where bucket_id='case-attachments'
     and name='5eed0000-0000-4000-8000-0000000000b1/5eed0000-0000-4000-8000-000000000b20/5eed0000-0000-4000-8000-000000000b80.pdf';
  if visible<>0 then raise exception 'ASSERT FAILED: household A can see % of household B''s objects', visible; end if;

  reset role;
  raise notice 'ok 3: the upload policy admits the seeded path, and household B''s object stays invisible';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Row-level isolation over the seeded rows, as a real member rather than as superuser.
-- ---------------------------------------------------------------------------
-- Superuser and table owner bypass RLS (there is no FORCE ROW LEVEL SECURITY anywhere in the
-- migrations), so reading these tables as postgres would prove nothing at all.
do $$
declare n int; leaks text[] := '{}';
begin
  perform set_config('request.jwt.claim.sub','5eed0000-0000-4000-8000-00000000ad02',true);
  set local role authenticated;

  select count(*) into n from public.households;
  if n<>1 then leaks:=leaks||format('households=%s',n); end if;
  select count(*) into n from public.learners;
  if n<>1 then leaks:=leaks||format('learners=%s',n); end if;
  select count(*) into n from public.service_cases;
  if n<>1 then leaks:=leaks||format('service_cases=%s',n); end if;
  select count(*) into n from public.case_messages;
  if n<>1 then leaks:=leaks||format('case_messages=%s',n); end if;
  select count(*) into n from public.lesson_activities;
  if n<>1 then leaks:=leaks||format('lesson_activities=%s',n); end if;
  select count(*) into n from public.plans;
  if n<>1 then leaks:=leaks||format('plans=%s',n); end if;

  reset role;

  if array_length(leaks,1) > 0 then
    raise exception 'ASSERT FAILED: guardian A of household A does not see exactly one row per table: %', array_to_string(leaks,', ');
  end if;
  raise notice 'ok 4: guardian A sees exactly their own household''s row in each of 6 tables';
end $$;

do $$ begin raise notice 'PASS: synthetic staging seed verified'; end $$;
