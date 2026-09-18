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
declare due int; jobs int; bad text[] := '{}'; j public.deletion_jobs%rowtype;
begin
  -- Both households carry a fixture, so both must be safe. Checking only one would leave the
  -- other as the single row that eats a household.
  for j in select * from public.deletion_jobs where id in
             ('5eed0000-0000-4000-8000-000000000ae0','5eed0000-0000-4000-8000-000000000be0')
  loop
    if j.status<>'scheduled' then
      bad := bad || format('%s has status %s', j.household_id, j.status);
    elsif j.eligible_at <= now() then
      bad := bad || format('%s is DUE at %s', j.household_id, j.eligible_at);
    end if;
  end loop;

  select count(*) into jobs from public.deletion_jobs
   where id in ('5eed0000-0000-4000-8000-000000000ae0','5eed0000-0000-4000-8000-000000000be0');
  if jobs<>2 then raise exception 'ASSERT FAILED: expected 2 seeded deletion jobs, found %', jobs; end if;

  if array_length(bad,1) > 0 then
    raise exception 'ASSERT FAILED: a seeded job is not safe: %. admin_execute_due_deletion_jobs() has no household scope, so the next executor run anywhere would physically delete an isolation household and take the D2 mutation checks with it.', array_to_string(bad,'; ');
  end if;

  -- Assert the executor's own predicate, not just the timestamps: this is the exact WHERE
  -- clause from 022, minus the gate check. It must select zero of the seed's rows even in a
  -- database where the executor is enabled.
  select count(*) into due from public.deletion_jobs
   where status='scheduled' and not legal_hold and eligible_at<=now()
     and household_id in ('5eed0000-0000-4000-8000-0000000000a1','5eed0000-0000-4000-8000-0000000000b1');
  if due<>0 then raise exception 'ASSERT FAILED: % seeded job(s) satisfy the executor predicate', due; end if;
  raise notice 'ok 2: both seeded deletion jobs are not due; no executor run can consume either household';
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
-- 4. The D1 sentinel invariant, swept over exactly the tables the verifier sweeps.
-- ---------------------------------------------------------------------------
-- src/hosted-isolation.js declares PRIVATE_TABLES and its D1 check requires BOTH administrators
-- to see an own-household sentinel on EVERY one of them, because an empty foreign result proves
-- nothing when the foreign table has no data either. This mirrors that requirement here so a gap
-- in the seed fails in the harness rather than on staging after the projects are provisioned.
--
-- Superuser and table owner bypass RLS (there is no FORCE ROW LEVEL SECURITY anywhere in the
-- migrations), so reading these tables as postgres would prove nothing at all. Hence set role.
do $$
declare
  tables text[] := array[
    'memberships','learners','guardian_consents','learner_profiles','service_cases','plans',
    'plan_weeks','plan_days','lessons','lesson_activities','audit_events','orders',
    'payment_events','operation_rate_windows','operational_events','deletion_jobs',
    'educator_capacities','case_messages','case_message_reads','case_attachments','plan_reviews',
    'resources','deliveries','revision_requests','privacy_requests'];
  actors uuid[] := array['5eed0000-0000-4000-8000-00000000ad01'::uuid,
                         '5eed0000-0000-4000-8000-00000000ad04'::uuid];
  homes  uuid[] := array['5eed0000-0000-4000-8000-0000000000a1'::uuid,
                         '5eed0000-0000-4000-8000-0000000000b1'::uuid];
  t text; i int; own int; leak int; problems text[] := '{}';
begin
  if array_length(tables,1) <> 25 then
    raise exception 'ASSERT FAILED: this list must mirror PRIVATE_TABLES (25), found %', array_length(tables,1);
  end if;

  for i in 1..array_length(actors,1) loop
    perform set_config('request.jwt.claim.sub', actors[i]::text, true);
    set local role authenticated;
    foreach t in array tables loop
      execute format('select count(*) from public.%I where household_id=$1', t) into own using homes[i];
      execute format('select count(*) from public.%I where household_id=$1', t) into leak
        using homes[case when i=1 then 2 else 1 end];
      if own < 1 then
        problems := problems || format('%s: admin %s sees no own-household sentinel', t, i);
      end if;
      if leak <> 0 then
        problems := problems || format('%s: admin %s sees %s foreign row(s)', t, i, leak);
      end if;
    end loop;
    reset role;
  end loop;

  if array_length(problems,1) > 0 then
    raise exception 'ASSERT FAILED: % sentinel problem(s): %', array_length(problems,1), array_to_string(problems, '; ');
  end if;
  raise notice 'ok 4: both admins see an own-household sentinel on all 25 private tables and zero foreign rows';
end $$;

do $$ begin raise notice 'PASS: synthetic staging seed verified'; end $$;
