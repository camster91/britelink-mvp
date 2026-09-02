-- Atomic, self-attributed, versioned guardian intake submission.
drop policy if exists consents_guardian_access on public.guardian_consents;
create policy consents_guardian_select on public.guardian_consents for select
  using (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]));

drop policy if exists profiles_guardian_write on public.learner_profiles;
-- No direct insert/update policy is recreated: validated intake writes are RPC-only.
create or replace function public.has_active_guardian_consent(target_household uuid,target_learner uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.guardian_consents consent where consent.household_id=target_household and consent.learner_id=target_learner and consent.withdrawn_at is null) $$;
revoke all on function public.has_active_guardian_consent(uuid,uuid) from public;
grant execute on function public.has_active_guardian_consent(uuid,uuid) to authenticated;

drop policy if exists profiles_member_select on public.learner_profiles;
create policy profiles_consent_limited_select on public.learner_profiles for select using (
  public.has_household_role(household_id,array['guardian','admin']::public.membership_role[])
  or (
    public.has_household_role(household_id,array['educator']::public.membership_role[])
    and public.has_active_guardian_consent(household_id,learner_id)
  )
);

create or replace function public.submit_guardian_intake(
  target_household uuid,
  target_learner uuid,
  notice_version text,
  consent_purposes text[],
  context jsonb
)
returns table(profile_id uuid, profile_version integer, profile_submitted_at timestamptz, consent_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  next_version integer;
  new_profile_id uuid;
  new_consent_id uuid;
  submitted_at timestamptz := now();
  allowed_keys text[] := array['subjects','priorAttainment','strengthsInterests','goals','learningSupports','language','weeklySchedule','caregiverAvailability','deviceAccess','resourceBudget','contentConstraints','accessibilityNeeds'];
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

  perform 1 from public.learners where id=target_learner for update;
  select coalesce(max(lp.version),0)+1 into next_version from public.learner_profiles lp where lp.learner_id=target_learner;
  insert into public.guardian_consents(household_id,learner_id,guardian_user_id,notice_version,purposes,consented_at)
    values(target_household,target_learner,auth.uid(),btrim(notice_version),consent_purposes,submitted_at) returning id into new_consent_id;
  insert into public.learner_profiles(household_id,learner_id,version,planning_context,submitted_at,created_by)
    values(target_household,target_learner,next_version,context,submitted_at,auth.uid()) returning id into new_profile_id;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
    values(target_household,auth.uid(),'intake.submitted','learner_profile',new_profile_id,jsonb_build_object('learner_id',target_learner,'version',next_version,'notice_version',btrim(notice_version),'purposes',consent_purposes));
  return query select new_profile_id,next_version,submitted_at,new_consent_id;
end $$;

revoke all on function public.submit_guardian_intake(uuid,uuid,text,text[],jsonb) from public;
grant execute on function public.submit_guardian_intake(uuid,uuid,text,text[],jsonb) to authenticated;

create or replace function public.withdraw_guardian_consent(target_household uuid,target_consent uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, auth
as $$
declare withdrawn timestamptz := now(); consent_learner uuid; held_cases integer;
begin
  if auth.uid() is null or not public.has_household_role(target_household,array['guardian']::public.membership_role[]) then raise exception 'guardian access required' using errcode='42501'; end if;
  update public.guardian_consents set withdrawn_at=withdrawn where id=target_consent and household_id=target_household and guardian_user_id=auth.uid() and withdrawn_at is null returning learner_id into consent_learner;
  if not found then raise exception 'active self-attributed consent not found' using errcode='42501'; end if;
  update public.service_cases set status='on_hold',updated_at=withdrawn where household_id=target_household and learner_id=consent_learner and status not in ('closed','cancelled','refunded','chargeback');
  get diagnostics held_cases = row_count;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'consent.withdrawn','guardian_consent',target_consent,jsonb_build_object('learner_id',consent_learner,'held_cases',held_cases));
  return withdrawn;
end $$;

revoke all on function public.withdraw_guardian_consent(uuid,uuid) from public;
grant execute on function public.withdraw_guardian_consent(uuid,uuid) to authenticated;
