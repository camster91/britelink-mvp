-- 034: wire the missing link -- a submitted intake advances the case.
--
-- WHY THIS EXISTS
--   Nothing in the schema ever set a case to 'submitted'. The lifecycle trace showed:
--
--       paid -> intake_pending   OK
--       paid -> submitted        invalid case transition
--       paid -> triage           invalid case transition
--       staff_accept_usable_intake -> 'case does not have a submitted intake'
--
--   and both searches came back empty:
--
--       position('submitted' in pg_get_functiondef(oid)) > 0        -> no rows
--       position('intake_received_at' in pg_get_functiondef(oid))>0 -> no rows
--
--   `service_cases.intake_received_at` is declared and written by nothing. A guardian could
--   complete the whole intake form and the case would sit at `paid` forever, blocking
--   acceptance, assignment, authoring and delivery.
--
-- WHY THIS IS AN IN-PLACE REPLACEMENT, NOT A NEW SHAPE
--   The live function returns four columns and the SPA reads that shape directly
--   (src/supabase-repository.js submitGuardianIntake). Adding output columns would either fail
--   with "cannot change return type of existing function" or force a DROP that breaks the app.
--   The defect is not the return value -- the function already saves profiles and consents
--   correctly. What is missing is one UPDATE. So the signature and the return are preserved
--   exactly, and only the missing write is added.
--
-- THE POLICY DECISION, RECORDED
--   Submitting the intake advances the case to `submitted`. The guard in
--   staff_accept_usable_intake asks for a SUBMITTED INTAKE, not for a staff action, so
--   submission is what the workflow itself expects to perform the transition. Staff review is
--   what `staff_accept_usable_intake` is for; it remains the gate before work begins.
--
-- WHAT THIS DOES NOT DO
--   It does not relax any transition rule -- `intake_pending -> submitted` was already in the
--   allowed table. It does not touch payment handling, RLS, or any other function.

-- Replace the body only. CREATE OR REPLACE with an IDENTICAL return type is allowed, which is
-- why the four output columns are reproduced verbatim.
create or replace function public.submit_guardian_intake(
  target_household uuid,
  target_learner uuid,
  notice_version text,
  consent_purposes text[],
  context jsonb
)
returns table(
  profile_id uuid,
  profile_version integer,
  profile_submitted_at timestamp with time zone,
  consent_id uuid
)
language plpgsql security definer set search_path = public
as $function$
declare
  next_version integer;
  submitted_at timestamptz := now();
  new_profile_id uuid;
  new_consent_id uuid;
  open_case public.service_cases%rowtype;
begin
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
    raise exception 'guardian access required';
  end if;
  if not exists (
    select 1 from public.learners where id = target_learner and household_id = target_household
  ) then
    raise exception 'learner not found in household';
  end if;
  if notice_version is null or btrim(notice_version) = '' then
    raise exception 'approved notice version is required';
  end if;
  if consent_purposes is null or array_length(consent_purposes, 1) is null then
    raise exception 'consent purpose is invalid';
  end if;
  if not (consent_purposes <@ array['personalized_learning_plan']::text[]) then
    raise exception 'consent purpose is invalid';
  end if;

  perform 1 from public.learners where id = target_learner for update;
  select coalesce(max(lp.version), 0) + 1 into next_version
    from public.learner_profiles lp where lp.learner_id = target_learner;

  insert into public.guardian_consents(
    household_id, learner_id, guardian_user_id, notice_version, purposes, consented_at)
  values (target_household, target_learner, auth.uid(), btrim(notice_version),
          consent_purposes, submitted_at)
  returning id into new_consent_id;

  insert into public.learner_profiles(
    household_id, learner_id, version, planning_context, submitted_at, created_by)
  values (target_household, target_learner, next_version, context, submitted_at, auth.uid())
  returning id into new_profile_id;

  insert into public.audit_events(
    household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'intake.submitted', 'learner_profile', new_profile_id,
          jsonb_build_object('learner_id', target_learner, 'version', next_version,
                             'notice_version', btrim(notice_version), 'purposes', consent_purposes));

  -- THE ADDED PART. Find this learner's open case and advance it, stamping the timestamp that
  -- was declared for exactly this purpose and never written. Restricted to the statuses where
  -- an arriving intake is meaningful, so a resubmitted form cannot drag a case that is already
  -- in drafting or later back to `submitted`.
  select * into open_case
    from public.service_cases
   where household_id = target_household
     and learner_id = target_learner
     and status in ('paid', 'intake_pending', 'clarification')
   order by created_at desc
   limit 1
   for update;

  if found then
    update public.service_cases
       set status = 'submitted',
           intake_received_at = submitted_at,
           updated_at = submitted_at
     where id = open_case.id;

    insert into public.audit_events(
      household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
    values (target_household, auth.uid(), 'case.intake_submitted', 'service_case', open_case.id,
            jsonb_build_object('learner_id', target_learner, 'version', next_version));
  end if;

  return query select new_profile_id, next_version, submitted_at, new_consent_id;
end $function$;

comment on function public.submit_guardian_intake(uuid, uuid, text, text[], jsonb) is
  'Records a guardian intake and advances the learner''s open case to submitted. Until migration 034 nothing in the schema set a case to submitted, so the workflow could never leave paid.';
