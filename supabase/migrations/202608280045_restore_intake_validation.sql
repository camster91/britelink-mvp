-- 045: restore intake validation that 034 dropped, and ask how much structure a family wants (#46).
--
-- WHY
--   034 replaced submit_guardian_intake to advance the case on submission, and in doing so rebuilt
--   the function from a shorter body. Everything 004 enforced on the planning context was lost:
--   the allowed-keys list, required fields, the subject list, device and budget options, and every
--   length limit -- plus the soft-deleted learner check and the 42501/22023 error codes. Since 034
--   the RPC stored any JSON a caller sent as a child's profile: reproduced with
--   {"diagnosis": ..., "iep": ..., "blob": 100 kB} and accepted. The product's rule is that intake
--   never collects health, diagnosis or IEP data; the form enforces that in the browser only, so
--   the database was the real boundary and it was open.
--
-- WHAT CHANGES
--   034's function, with 004's checks restored verbatim in place of 034's weaker ones, and one new
--   optional key: planningStructure = plan_every_day | weekly_goals | capture_after. Guardians
--   only, as in 004 (034 had widened this to admins; an admin records intake through the guardian
--   they support). Signature and return type are unchanged, so no client breaks.

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
  allowed_keys text[] := array['subjects','priorAttainment','strengthsInterests','goals','learningSupports','language','weeklySchedule','caregiverAvailability','deviceAccess','resourceBudget','contentConstraints','accessibilityNeeds','planningStructure'];
begin
  if auth.uid() is null or not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then raise exception 'guardian access required' using errcode='42501'; end if;
  if not exists(select 1 from public.learners l where l.id=target_learner and l.household_id=target_household and l.deleted_at is null) then raise exception 'learner not found in household' using errcode='42501'; end if;
  if notice_version is null or char_length(btrim(notice_version)) not between 1 and 80 then raise exception 'approved notice version is required' using errcode='22023'; end if;
  if consent_purposes is null or consent_purposes <> array['personalized_learning_plan']::text[] then raise exception 'consent purpose is invalid' using errcode='22023'; end if;
  if context is null or jsonb_typeof(context) <> 'object' then raise exception 'planning context must be an object' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(context) key where not (key = any(allowed_keys))) then raise exception 'planning context contains unsupported fields' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(context->'subjects','[]'::jsonb)) < 1 or jsonb_array_length(coalesce(context->'subjects','[]'::jsonb)) > 8 then raise exception 'choose between 1 and 8 subjects' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(context->'subjects') subject where subject not in ('Language','Math','Science','Social studies','French','Arts','Health and physical education')) then raise exception 'subject is invalid' using errcode='22023'; end if;
  if char_length(btrim(coalesce(context->>'priorAttainment',''))) not between 1 and 1000 then raise exception 'prior attainment is required' using errcode='22023'; end if;
  if char_length(btrim(coalesce(context->>'strengthsInterests',''))) not between 1 and 1000 then raise exception 'strengths and interests are required' using errcode='22023'; end if;
  if char_length(btrim(coalesce(context->>'goals',''))) not between 1 and 1000 then raise exception 'goals are required' using errcode='22023'; end if;
  if char_length(btrim(coalesce(context->>'learningSupports',''))) > 1000 or char_length(btrim(coalesce(context->>'language',''))) not between 1 and 120 then raise exception 'learning support or language field is invalid' using errcode='22023'; end if;
  if char_length(btrim(coalesce(context->>'weeklySchedule',''))) not between 1 and 500 or char_length(btrim(coalesce(context->>'caregiverAvailability',''))) not between 1 and 500 then raise exception 'schedule context is required' using errcode='22023'; end if;
  if coalesce(context->>'deviceAccess','') not in ('computer_printer','computer_no_printer','tablet','limited') or coalesce(context->>'resourceBudget','') not in ('free_only','up_to_25','up_to_50','discuss') then raise exception 'access or budget option is invalid' using errcode='22023'; end if;
  if char_length(btrim(coalesce(context->>'contentConstraints',''))) > 1000 or char_length(btrim(coalesce(context->>'accessibilityNeeds',''))) > 1000 then raise exception 'constraint field is too long' using errcode='22023'; end if;
  -- 045 (#46): how much structure the family wants. Optional so an older client still submits;
  -- the current form always sends it.
  if context ? 'planningStructure' and coalesce(context->>'planningStructure','') not in ('plan_every_day','weekly_goals','capture_after') then raise exception 'planning structure is invalid' using errcode='22023'; end if;

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
  'Validates and records a guardian intake (004 rules, restored in 045, plus planningStructure) and advances the learner''s open case to submitted (034).';
