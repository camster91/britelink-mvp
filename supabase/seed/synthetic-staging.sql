-- Synthetic staging seed for BriteLink.
--
-- Issue #1 AC3: "Staging contains only documented synthetic households, learners,
-- cases, and staff identities."
--
-- This file is the documented set. It creates TWO households so the cross-household
-- isolation checks (D1 read isolation, D2 mutation denial) have a real counterparty,
-- and it prints the exact env block those checks need, so the operator does not
-- hand-assemble twenty UUIDs in a dashboard.
--
-- Coverage is driven by src/hosted-isolation.js, not by what seemed interesting. Its
-- PRIVATE_TABLES list is 25 tables and its D1 check needs both administrators to see an
-- OWN-household sentinel on every one of them, because an empty foreign result proves
-- nothing when the foreign table is empty too. Add a table to that list and this seed
-- needs a row for it on both sides; verify-synthetic-seed.sql sweeps the same 25.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN
-- ---------------------------------------------------------------------------
--
--   psql ... -v seed_confirm=yes \
--            -v admin_a=<uuid> -v guardian_a=<uuid> \
--            -v educator_a=<uuid> -v admin_b=<uuid> \
--            -f supabase/seed/synthetic-staging.sql
--
-- The four user UUIDs are NOT created here on purpose. On hosted Supabase, users
-- belong to Supabase Auth: create them through the dashboard or the admin API so
-- they get real identities and can mint JWTs. Inserting into auth.users directly
-- produces rows that cannot sign in. Pass the resulting UUIDs in.
--
-- For the throwaway migration-harness database only, pass -v create_auth_users=yes
-- and this will create matching auth.users rows so the foreign keys resolve.
--
-- ---------------------------------------------------------------------------
-- SAFETY
-- ---------------------------------------------------------------------------
--
--   * Refuses to run without seed_confirm=yes.
--   * Refuses to run if the seed households already exist (no partial re-seed).
--   * Never touches auth.users unless create_auth_users=yes.
--   * Never inserts into retention_execution_controls: migration 022 already
--     seeded its single row, and its zero-policy RLS is deliberate.
--   * Never sets request.jwt.claim.sub. With no JWT set, auth.uid() is NULL and
--     enforce_operation_rate_limit() returns 0 immediately, so the seven
--     BEFORE INSERT rate-limit triggers do not apply and the seed cannot trip
--     them. Setting a JWT here would make every insert need a matching
--     membership and would cap message seeding at 12 per 5 minutes.
--
-- All identifiers use the 5eed0000-0000-4000-8000-* namespace so a synthetic row
-- is recognisable on sight, and so nothing collides with the fixtures the
-- migration-harness assertion scripts create (which use ...000000a01 style).

\set ON_ERROR_STOP on

-- Guards. Two things make this look fussier than it should:
--   * a psql \if accepts only a boolean, never a comparison -- `\if :'x' <> 'yes'` is a parse
--     error, and worse, one that desynchronises the \if/\endif stack for the rest of the file;
--   * psql does not substitute :variables inside a dollar-quoted body, so the check cannot
--     live in a DO block.
-- So the value check is a second \if. \if runs the value through ParseVariableBool, which
-- accepts yes/on/1/true (and no/off/0/false), which is why plain `\if :seed_confirm` is enough.
-- And every refusal below RAISES rather than \quit-ing, because \quit exits 0 and a guard that
-- exits 0 is not a guard.
\if :{?seed_confirm}
\else
do $$ begin raise exception 'REFUSING: pass -v seed_confirm=yes to confirm this targets a synthetic environment'; end $$;
\endif

\if :seed_confirm
\else
do $$ begin raise exception 'REFUSING: seed_confirm was not a true value (use yes)'; end $$;
\endif

\if :{?admin_a}
\else
do $$ begin raise exception 'REFUSING: -v admin_a=<uuid> is required'; end $$;
\endif

\if :{?guardian_a}
\else
do $$ begin raise exception 'REFUSING: -v guardian_a=<uuid> is required'; end $$;
\endif

\if :{?educator_a}
\else
do $$ begin raise exception 'REFUSING: -v educator_a=<uuid> is required'; end $$;
\endif

\if :{?admin_b}
\else
do $$ begin raise exception 'REFUSING: -v admin_b=<uuid> is required'; end $$;
\endif

begin;

-- Harness convenience only. See the header: do not use this on hosted Supabase.
\if :{?create_auth_users}
insert into auth.users (id, email) values
  (:'admin_a'::uuid,    'seed-admin-a@britelink.invalid'),
  (:'guardian_a'::uuid, 'seed-guardian-a@britelink.invalid'),
  (:'educator_a'::uuid, 'seed-educator-a@britelink.invalid'),
  (:'admin_b'::uuid,    'seed-admin-b@britelink.invalid')
on conflict (id) do nothing;
\endif

-- Refuse a partial re-seed. A second run would either collide on a unique
-- constraint halfway through, or silently double the object graph.
do $$
begin
  if exists (
    select 1 from public.households
    where id in ('5eed0000-0000-4000-8000-0000000000a1'::uuid,
                 '5eed0000-0000-4000-8000-0000000000b1'::uuid)
  ) then
    raise exception 'seed households already exist; this database is already seeded';
  end if;
end $$;

-- ---------------------------------------------------------------- households
-- Names are prefixed "SYNTHETIC" so they can never be mistaken for real families
-- in a screenshot, a support ticket, or a query result.
insert into public.households (id, display_name) values
  ('5eed0000-0000-4000-8000-0000000000a1', 'SYNTHETIC Household A (isolation subject)'),
  ('5eed0000-0000-4000-8000-0000000000b1', 'SYNTHETIC Household B (isolation counterparty)');

insert into public.memberships (household_id, user_id, role) values
  ('5eed0000-0000-4000-8000-0000000000a1', :'admin_a'::uuid,    'admin'),
  ('5eed0000-0000-4000-8000-0000000000a1', :'guardian_a'::uuid, 'guardian'),
  ('5eed0000-0000-4000-8000-0000000000a1', :'educator_a'::uuid, 'educator'),
  ('5eed0000-0000-4000-8000-0000000000b1', :'admin_b'::uuid,    'admin');

-- ------------------------------------------------------------------ learners
insert into public.learners (id, household_id, preferred_name, grade_label, jurisdiction) values
  ('5eed0000-0000-4000-8000-000000000a10', '5eed0000-0000-4000-8000-0000000000a1', 'SYNTHETIC Learner A', '4', 'Ontario'),
  ('5eed0000-0000-4000-8000-000000000b10', '5eed0000-0000-4000-8000-0000000000b1', 'SYNTHETIC Learner B', '5', 'Ontario');

insert into public.guardian_consents
  (id, household_id, learner_id, guardian_user_id, notice_version, purposes) values
  ('5eed0000-0000-4000-8000-000000000a61', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a10', :'guardian_a'::uuid,
   'synthetic-not-a-real-notice-v0', array['service_delivery','safeguarding']),
  ('5eed0000-0000-4000-8000-000000000b61', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b10', :'admin_b'::uuid,
   'synthetic-not-a-real-notice-v0', array['service_delivery']);

insert into public.learner_profiles
  (id, household_id, learner_id, version, planning_context, submitted_at, created_by) values
  ('5eed0000-0000-4000-8000-000000000a62', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a10', 1,
   '{"note":"synthetic planning context","strengths":["synthetic"]}'::jsonb, now(), :'guardian_a'::uuid),
  ('5eed0000-0000-4000-8000-000000000b62', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b10', 1,
   '{"note":"synthetic planning context"}'::jsonb, now(), :'admin_b'::uuid);

-- --------------------------------------------------------- orders and cases
insert into public.orders
  (id, household_id, external_checkout_id, package_code, payment_status, currency, amount_cents, paid_at) values
  ('5eed0000-0000-4000-8000-000000000a21', '5eed0000-0000-4000-8000-0000000000a1',
   'seed-checkout-a-0001', 'essentials', 'paid', 'CAD', 0, now()),
  ('5eed0000-0000-4000-8000-000000000b21', '5eed0000-0000-4000-8000-0000000000b1',
   'seed-checkout-b-0001', 'essentials', 'paid', 'CAD', 0, now());

insert into public.service_cases
  (id, household_id, learner_id, package_code, status, order_id, intake_received_at, assigned_educator_id) values
  ('5eed0000-0000-4000-8000-000000000a20', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a10', 'essentials', 'assigned',
   '5eed0000-0000-4000-8000-000000000a21', now(), :'educator_a'::uuid),
  ('5eed0000-0000-4000-8000-000000000b20', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b10', 'essentials', 'assigned',
   '5eed0000-0000-4000-8000-000000000b21', now(), null);

-- ------------------------------------------------- operational sentinels
-- src/hosted-isolation.js lists 25 PRIVATE_TABLES and its D1 check requires BOTH administrators
-- to see an *own-household* sentinel on EVERY one of them. The reason is in
-- docs/HOSTED_STAGING_VERIFICATION.md: an empty foreign result proves nothing when the foreign
-- table has no data either. So every table needs a row on both sides -- a fixture that covers
-- only the surfaces that felt interesting leaves the rest permanently unprovable, and the check
-- fails outright with "no visible own-household sentinel".
--
-- educator_capacities for household B is held by admin_b: the env contract in .env.example has
-- no EDUCATOR_B_USER_ID, and the table's select policy admits an educator *or* an admin of the
-- household, so an admin holding a capacity row satisfies the check without inventing a fifth
-- required uuid for the operator to supply.
insert into public.educator_capacities (household_id, educator_user_id, max_active_cases) values
  ('5eed0000-0000-4000-8000-0000000000a1', :'educator_a'::uuid, 5),
  ('5eed0000-0000-4000-8000-0000000000b1', :'admin_b'::uuid, 5);

-- payment_events: provider_event_key is globally unique, so A and B cannot share one.
insert into public.payment_events
  (id, household_id, case_id, order_id, provider_event_key, external_checkout_id,
   payment_status, package_code, currency, amount_cents, occurred_at) values
  ('5eed0000-0000-4000-8000-000000000aa1', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a20', '5eed0000-0000-4000-8000-000000000a21',
   'seed-provider-event-a-0001', 'seed-checkout-a-0001', 'paid', 'essentials', 'CAD', 0, now()),
  ('5eed0000-0000-4000-8000-000000000ba1', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b20', '5eed0000-0000-4000-8000-000000000b21',
   'seed-provider-event-b-0001', 'seed-checkout-b-0001', 'paid', 'essentials', 'CAD', 0, now());

-- case_message_reads lives further down, next to case_messages: it has a foreign key to the
-- message, so it cannot be written before the message exists.

-- operation_rate_windows: composite primary key on all four columns. attempt_count must be > 0.
insert into public.operation_rate_windows
  (household_id, actor_user_id, action_key, window_started_at, attempt_count, last_attempt_at) values
  ('5eed0000-0000-4000-8000-0000000000a1', :'guardian_a'::uuid, 'seed.synthetic', date_trunc('hour', now()), 1, now()),
  ('5eed0000-0000-4000-8000-0000000000b1', :'admin_b'::uuid,    'seed.synthetic', date_trunc('hour', now()), 1, now());

-- operational_events: id is generated always as identity, so it is not supplied. event_code
-- must match ^[a-z0-9][a-z0-9._-]{2,79}$.
insert into public.operational_events
  (household_id, actor_user_id, component, severity, event_code, occurred_at) values
  ('5eed0000-0000-4000-8000-0000000000a1', :'admin_a'::uuid, 'seed', 'info', 'seed.synthetic', now()),
  ('5eed0000-0000-4000-8000-0000000000b1', :'admin_b'::uuid, 'seed', 'info', 'seed.synthetic', now());

-- -------------------------------------------------------------------- plans
insert into public.plans
  (id, household_id, case_id, learner_id, version, status, authored_by, reviewed_by, published_at) values
  ('5eed0000-0000-4000-8000-000000000a30', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a20', '5eed0000-0000-4000-8000-000000000a10', 1, 'published',
   :'educator_a'::uuid, :'admin_a'::uuid, now()),
  ('5eed0000-0000-4000-8000-000000000b30', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b20', '5eed0000-0000-4000-8000-000000000b10', 1, 'published',
   :'admin_b'::uuid, :'admin_b'::uuid, now());

insert into public.plan_weeks (id, household_id, plan_id, week_number, theme) values
  ('5eed0000-0000-4000-8000-000000000a40', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a30', 1, 'Synthetic week A'),
  ('5eed0000-0000-4000-8000-000000000b40', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b30', 1, 'Synthetic week B');

insert into public.plan_days (id, household_id, week_id, day_number, planned_date) values
  ('5eed0000-0000-4000-8000-000000000a41', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a40', 1, current_date),
  ('5eed0000-0000-4000-8000-000000000b41', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b40', 1, current_date);

-- lessons.instructions is NOT NULL with no default, so it must be supplied.
insert into public.lessons
  (id, household_id, day_id, position, subject, title, objective, instructions, adult_help_minutes) values
  ('5eed0000-0000-4000-8000-000000000a50', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a41', 1, 'Mathematics', 'Synthetic lesson A',
   'Synthetic objective A', '[{"step":1,"text":"synthetic instruction"}]'::jsonb, 15),
  ('5eed0000-0000-4000-8000-000000000b50', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b41', 1, 'Mathematics', 'Synthetic lesson B',
   'Synthetic objective B', '[{"step":1,"text":"synthetic instruction"}]'::jsonb, 15);

insert into public.lesson_activities
  (id, household_id, learner_id, lesson_id, status, updated_by) values
  ('5eed0000-0000-4000-8000-000000000a51', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a10', '5eed0000-0000-4000-8000-000000000a50',
   'not_started', :'guardian_a'::uuid),
  ('5eed0000-0000-4000-8000-000000000b51', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b10', '5eed0000-0000-4000-8000-000000000b50',
   'not_started', :'admin_b'::uuid);

-- resources: access_type='paid' would require estimated_cost_cents, so keep free.
insert into public.resources
  (id, household_id, plan_id, lesson_id, title, url, requirement, access_type, account_required, ads_present) values
  ('5eed0000-0000-4000-8000-000000000a60', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a30', '5eed0000-0000-4000-8000-000000000a50',
   'Synthetic resource A', 'https://example.invalid/resource-a', 'required', 'free', false, false),
  ('5eed0000-0000-4000-8000-000000000b60', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b30', '5eed0000-0000-4000-8000-000000000b50',
   'Synthetic resource B', 'https://example.invalid/resource-b', 'required', 'free', false, false);

insert into public.plan_reviews
  (id, household_id, plan_id, reviewer_user_id,
   curriculum_checked, safeguarding_checked, accessibility_checked, resource_rights_checked, approved_at) values
  ('5eed0000-0000-4000-8000-000000000a90', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a30', :'admin_a'::uuid, true, true, true, true, now()),
  ('5eed0000-0000-4000-8000-000000000b90', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b30', :'admin_b'::uuid, true, true, true, true, now());

-- ----------------------------------------------------------------- messages
insert into public.case_messages (id, household_id, case_id, sender_user_id, kind, body) values
  ('5eed0000-0000-4000-8000-000000000a70', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a20', :'guardian_a'::uuid, 'general', 'Synthetic message A'),
  ('5eed0000-0000-4000-8000-000000000b70', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b20', :'admin_b'::uuid, 'general', 'Synthetic message B');

-- case_message_reads: primary key is (message_id, user_id), not (household_id, message_id), so
-- each read hangs off its own household's message and its own household's user. One row per
-- household, because it is one of the 25 PRIVATE_TABLES the D1 sentinel sweep covers.
insert into public.case_message_reads (household_id, message_id, user_id, read_at) values
  ('5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000a70', :'guardian_a'::uuid, now()),
  ('5eed0000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000b70', :'admin_b'::uuid, now());

-- -------------------------------------------------------------- attachments
-- object_path must be 20-500 chars and its FIRST path segment must equal the
-- household uuid: storage-policies.sql matches (storage.foldername(name))[1]
-- against the household id. A path that does not start with the household id
-- silently fails the storage policy later, so the shape here is load-bearing.
--
-- status='clean' requires scanned_at, scan_provider AND scan_result_code to be
-- non-null together (013's table-level check); 'pending_upload' requires
-- scanned_at to be null.
insert into public.case_attachments
  (id, household_id, case_id, message_id, uploaded_by, object_path, file_name,
   mime_type, size_bytes, sha256, status, uploaded_at, scanned_at, scan_provider, scan_result_code) values
  ('5eed0000-0000-4000-8000-000000000a80', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a20', '5eed0000-0000-4000-8000-000000000a70', :'guardian_a'::uuid,
   '5eed0000-0000-4000-8000-0000000000a1/5eed0000-0000-4000-8000-000000000a20/5eed0000-0000-4000-8000-000000000a80.pdf',
   'synthetic-a.pdf', 'application/pdf', 2048, encode(digest('synthetic A bytes','sha256'),'hex'),
   'pending_upload', now(), null, null, null),
  ('5eed0000-0000-4000-8000-000000000b80', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b20', '5eed0000-0000-4000-8000-000000000b70', :'admin_b'::uuid,
   '5eed0000-0000-4000-8000-0000000000b1/5eed0000-0000-4000-8000-000000000b20/5eed0000-0000-4000-8000-000000000b80.pdf',
   'synthetic-b.pdf', 'application/pdf', 4096, encode(digest('synthetic B bytes','sha256'),'hex'),
   'clean', now(), now(), 'synthetic-scanner', 'ok');

-- ------------------------------------------------------ delivery / revision
insert into public.deliveries
  (id, household_id, case_id, plan_id, plan_version, channel, status, attempt_count, sent_at) values
  ('5eed0000-0000-4000-8000-000000000aa0', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a20', '5eed0000-0000-4000-8000-000000000a30', 1,
   'secure_portal', 'sent', 1, now()),
  ('5eed0000-0000-4000-8000-000000000ba0', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b20', '5eed0000-0000-4000-8000-000000000b30', 1,
   'secure_portal', 'sent', 1, now());

insert into public.revision_requests
  (id, household_id, case_id, requested_by, reason, entitlement_index, status) values
  ('5eed0000-0000-4000-8000-000000000ab0', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000a20', :'guardian_a'::uuid, 'Synthetic revision request A', 1, 'requested'),
  ('5eed0000-0000-4000-8000-000000000bb0', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000b20', :'admin_b'::uuid, 'Synthetic revision request B', 1, 'requested');

-- ------------------------------------------------- retention fixtures (both households)
-- One pending deletion request and one scheduled job per household, so the retention dry run
-- (#6) has real rows to reason about on both sides instead of empty tables. Household A needs
-- its own because deletion_jobs and privacy_requests are two of the 25 PRIVATE_TABLES the D1
-- check sweeps, and a table with no own-household row cannot prove anything.
--
-- BOTH JOBS ARE DELIBERATELY NOT DUE, and that is a safety property, not an oversight.
-- admin_execute_due_deletion_jobs() has NO household scope: it takes every row where
-- status='scheduled' and not legal_hold and eligible_at<=now(). A due job here would therefore
-- be destroyed by the next executor run anywhere on this database -- and the thing destroyed
-- would be an isolation household that the D2 mutation checks depend on. That failure would
-- surface as two dozen unrelated-looking check failures, not as "the seed ate its own fixture".
-- eligible_at is set 90 days out so the executor can never select either row, while the dry run
-- still sees well-formed jobs.
--
-- Nothing here executes a deletion. The executor is additionally gated on
-- retention_execution_controls.execution_enabled, which 022 leaves false, and enabling it is
-- gated on GOAL_COMPLETION_PLAN.md:51.
insert into public.privacy_requests (id, household_id, requested_by, kind, status, reason) values
  ('5eed0000-0000-4000-8000-000000000ad0', '5eed0000-0000-4000-8000-0000000000a1',
   :'guardian_a'::uuid, 'deletion', 'pending', 'SYNTHETIC retention fixture; not a real request'),
  ('5eed0000-0000-4000-8000-000000000bd0', '5eed0000-0000-4000-8000-0000000000b1',
   :'admin_b'::uuid, 'deletion', 'pending', 'SYNTHETIC retention fixture; not a real request');

-- status='scheduled' additionally requires identity_verified and
-- co_guardian_reviewed to be true and legal_hold to be false (012).
insert into public.deletion_jobs
  (id, household_id, privacy_request_id, status, eligible_at, approved_by, approval_basis,
   identity_verified, co_guardian_reviewed, legal_hold) values
  ('5eed0000-0000-4000-8000-000000000ae0', '5eed0000-0000-4000-8000-0000000000a1',
   '5eed0000-0000-4000-8000-000000000ad0', 'scheduled', now() + interval '90 days', :'admin_a'::uuid,
   'SYNTHETIC seed fixture; approved basis is placeholder text', true, true, false),
  ('5eed0000-0000-4000-8000-000000000be0', '5eed0000-0000-4000-8000-0000000000b1',
   '5eed0000-0000-4000-8000-000000000bd0', 'scheduled', now() + interval '90 days', :'admin_b'::uuid,
   'SYNTHETIC seed fixture; approved basis is placeholder text', true, true, false);

-- audit_events.id is generated always as identity: do not supply it.
insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id) values
  ('5eed0000-0000-4000-8000-0000000000a1', :'admin_a'::uuid, 'seed.synthetic_created', 'household', '5eed0000-0000-4000-8000-0000000000a1'),
  ('5eed0000-0000-4000-8000-0000000000b1', :'admin_b'::uuid, 'seed.synthetic_created', 'household', '5eed0000-0000-4000-8000-0000000000b1');

commit;

-- ---------------------------------------------------------------------------
-- Emit the env block the isolation checks consume.
-- ---------------------------------------------------------------------------
\echo ''
\echo '============================================================'
\echo 'Seeded. Paste into .env.local (never commit it):'
\echo '============================================================'
\echo 'BRITELINK_TEST_ENVIRONMENT=staging'
\echo 'BRITELINK_TEST_HOUSEHOLD_A_ID=5eed0000-0000-4000-8000-0000000000a1'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_ID=5eed0000-0000-4000-8000-0000000000b1'
-- No space between the quoted label and :var. \echo separates its arguments with one, so
-- 'LABEL=' :var emits "LABEL= <value>" -- a leading space in a pasted user id, which would
-- fail somewhere far from here. Verified against psql 16: 'LABEL=':var emits "LABEL=<value>".
\echo 'BRITELINK_TEST_ADMIN_A_USER_ID=':admin_a
\echo 'BRITELINK_TEST_GUARDIAN_A_USER_ID=':guardian_a
\echo 'BRITELINK_TEST_EDUCATOR_A_USER_ID=':educator_a
\echo ''
\echo 'BRITELINK_TEST_HOUSEHOLD_B_LEARNER_ID=5eed0000-0000-4000-8000-000000000b10'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_CASE_ID=5eed0000-0000-4000-8000-000000000b20'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_PLAN_ID=5eed0000-0000-4000-8000-000000000b30'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_LESSON_ID=5eed0000-0000-4000-8000-000000000b50'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_ACTIVITY_ID=5eed0000-0000-4000-8000-000000000b51'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_MESSAGE_ID=5eed0000-0000-4000-8000-000000000b70'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_DELIVERY_ID=5eed0000-0000-4000-8000-000000000ba0'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_REVISION_ID=5eed0000-0000-4000-8000-000000000bb0'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_ATTACHMENT_ID=5eed0000-0000-4000-8000-000000000b80'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_CONSENT_ID=5eed0000-0000-4000-8000-000000000b61'
\echo 'BRITELINK_TEST_HOUSEHOLD_B_OBJECT_PATH=5eed0000-0000-4000-8000-0000000000b1/5eed0000-0000-4000-8000-000000000b20/5eed0000-0000-4000-8000-000000000b80.pdf'
\echo 'BRITELINK_TEST_ATTACHMENT_BUCKET=case-attachments'
\echo ''
\echo 'Still required by hand: the four JWTs. Mint one per user from Supabase'
\echo 'Auth - a seed cannot fabricate a signed token, and it must not try.'
