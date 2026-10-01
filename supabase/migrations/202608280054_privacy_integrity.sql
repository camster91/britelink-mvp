-- 054: privacy fixes from the third correctness review (2026-10-01).
--
-- 1. The household export no longer includes plans the family was never given.
--    export_guardian_household_authorized (050) selected every plan, week, day, lesson, resource and
--    schedule in the household, including educators' draft and internal-review plans that RLS (024)
--    hides from guardians. The export now carries only plans that were published to the family
--    (status published, or archived after being superseded) and the rows that belong to them.
--
-- 2. Withdrawing consent withdraws all of that guardian's consent for the learner.
--    Every intake version records a consent row, and withdraw_guardian_consent (004) withdrew only
--    the one row the client passed, so an older active row kept educator access open
--    (has_active_guardian_consent is true while any row is active).
--
-- 3. A case paused by a consent withdrawal cannot be resumed without consent.
--    staff_transition_case lets staff move on_hold back to triage/assigned/drafting/internal_review;
--    a trigger now refuses those moves when the learner has no active guardian consent.

-- 1 ---------------------------------------------------------------------------------------------
create or replace function public.export_guardian_household_authorized(target_household uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $function$
declare payload jsonb := public.export_guardian_household_core(target_household);
begin
  payload := jsonb_set(payload, '{manifest,included}', (payload #> '{manifest,included}')
    || '["planSchedules","learningCaptures","weeklyNotes","sharedActivities","calendarFeeds"]'::jsonb);
  -- Only plans the family was given: published, or archived after a newer version replaced them.
  payload := payload
    || jsonb_build_object('plans', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.created_at)
           from (select id, case_id, learner_id, version, status, published_at, created_at
                   from public.plans
                  where household_id = target_household and status in ('published', 'archived')) x), '[]'::jsonb))
    || jsonb_build_object('planWeeks', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.plan_id, x.week_number)
           from (select w.id, w.plan_id, w.week_number, w.theme
                   from public.plan_weeks w join public.plans p on p.id = w.plan_id
                  where w.household_id = target_household and p.status in ('published', 'archived')) x), '[]'::jsonb))
    || jsonb_build_object('planDays', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.week_id, x.day_number)
           from (select d.id, d.week_id, d.day_number, d.planned_date
                   from public.plan_days d join public.plan_weeks w on w.id = d.week_id join public.plans p on p.id = w.plan_id
                  where d.household_id = target_household and p.status in ('published', 'archived')) x), '[]'::jsonb))
    || jsonb_build_object('lessons', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.day_id, x.position)
           from (select l.id, l.day_id, l.position, l.subject, l.title, l.objective, l.instructions, l.materials,
                        l.accommodations, l.adult_help_minutes, l.estimated_minutes, l.help_level, l.needs_screen
                   from public.lessons l join public.plan_days d on d.id = l.day_id
                        join public.plan_weeks w on w.id = d.week_id join public.plans p on p.id = w.plan_id
                  where l.household_id = target_household and p.status in ('published', 'archived')) x), '[]'::jsonb))
    || jsonb_build_object('resources', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.plan_id, x.lesson_id, x.id)
           from (select r.id, r.plan_id, r.lesson_id, r.title, r.url, r.requirement, r.access_type, r.estimated_cost_cents,
                        r.region, r.edition, r.account_required, r.ads_present, r.privacy_reviewed_at, r.rights_reviewed_at,
                        r.link_checked_at, r.attribution, r.substitute_resource_id
                   from public.resources r join public.plans p on p.id = r.plan_id
                  where r.household_id = target_household and p.status in ('published', 'archived')) x), '[]'::jsonb));
  return payload
    || jsonb_build_object('planSchedules', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.plan_id)
           from (select s.plan_id, s.start_date, s.school_days, s.days_off, s.calendar_set, s.paused_subjects, s.updated_at
                   from public.plan_schedules s join public.plans p on p.id = s.plan_id
                  where s.household_id = target_household and p.status in ('published', 'archived')) x), '[]'::jsonb))
    || jsonb_build_object('learningCaptures', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.captured_on, x.created_at)
           from (select id, learner_id, captured_on, kind, subjects, note, created_at, removed_at
                   from public.learning_captures where household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('weeklyNotes', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.week_start, x.learner_id)
           from (select id, learner_id, week_start, note, created_at, updated_at
                   from public.weekly_notes where household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('sharedActivities', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.created_at)
           from (select a.id, a.title, a.description, a.subjects, a.scheduled_for, a.created_at, a.removed_at,
                        coalesce((select jsonb_agg(jsonb_build_object('learnerId', l.learner_id, 'outcome', l.outcome,
                                    'scheduledFor', l.scheduled_for, 'completedAt', l.completed_at) order by l.learner_id)
                                    from public.shared_activity_learners l where l.activity_id = a.id), '[]'::jsonb) as learners
                   from public.shared_activities a where a.household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('calendarFeeds', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.created_at)
           from (select id, learner_id, include_titles, created_at, revoked_at
                   from public.calendar_feeds where household_id = target_household) x), '[]'::jsonb));
end $function$;
revoke all on function public.export_guardian_household_authorized(uuid) from public, anon, authenticated;

-- 2 ---------------------------------------------------------------------------------------------
create or replace function public.withdraw_guardian_consent(target_household uuid, target_consent uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, auth
as $$
declare withdrawn timestamptz := now(); consent_learner uuid; held_cases integer; withdrawn_rows integer;
begin
  if auth.uid() is null or not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  select learner_id into consent_learner from public.guardian_consents
   where id = target_consent and household_id = target_household and guardian_user_id = auth.uid() and withdrawn_at is null;
  if not found then raise exception 'active self-attributed consent not found' using errcode = '42501'; end if;
  -- Every active consent this guardian gave for this learner, not only the newest intake version's.
  update public.guardian_consents set withdrawn_at = withdrawn
   where household_id = target_household and learner_id = consent_learner
     and guardian_user_id = auth.uid() and withdrawn_at is null;
  get diagnostics withdrawn_rows = row_count;
  update public.service_cases set status = 'on_hold', updated_at = withdrawn
   where household_id = target_household and learner_id = consent_learner
     and status not in ('closed', 'cancelled', 'refunded', 'chargeback');
  get diagnostics held_cases = row_count;
  insert into public.audit_events(household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'consent.withdrawn', 'guardian_consent', target_consent,
          jsonb_build_object('learner_id', consent_learner, 'held_cases', held_cases, 'withdrawn_consents', withdrawn_rows));
  return withdrawn;
end $$;
revoke all on function public.withdraw_guardian_consent(uuid, uuid) from public;
grant execute on function public.withdraw_guardian_consent(uuid, uuid) to authenticated;

-- 3 ---------------------------------------------------------------------------------------------
create or replace function public.enforce_consent_to_resume()
returns trigger
language plpgsql set search_path = public
as $function$
begin
  if old.status = 'on_hold' and new.status in ('triage', 'assigned', 'drafting', 'internal_review')
     and not public.has_active_guardian_consent(new.household_id, new.learner_id) then
    raise exception 'this learner has no active guardian consent; the case stays on hold';
  end if;
  return new;
end $function$;
revoke all on function public.enforce_consent_to_resume() from public, anon, authenticated;

drop trigger if exists service_cases_require_consent_to_resume on public.service_cases;
create trigger service_cases_require_consent_to_resume
  before update of status on public.service_cases
  for each row execute function public.enforce_consent_to_resume();
