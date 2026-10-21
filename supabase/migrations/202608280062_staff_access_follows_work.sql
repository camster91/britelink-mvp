-- 062: staff access follows the work (review follow-up to 061).
--
-- WHY
--   061 made an educator a member of a family only when an admin assigns them its case. Two gaps
--   were left:
--   - Reassigning a case never took the previous educator out of the family. They kept reading
--     its plans, messages and learning notes (every staff read is membership-based), so one
--     stolen educator login still exposed every family that educator had ever been given.
--   - Admins are members of every family (owner decision 2026-10-15), and nine parent actions
--     and the lesson-progress policies accepted the admin role as if it were a guardian. One
--     stolen admin login could add learners, change a family's schedule, record or delete
--     learning notes, mark lessons done, and create a calendar link to a child's schedule in
--     every family. Admins could also read a child's intake details after the parent withdrew
--     consent, which educators cannot. No staff screen uses any of these: admins work in the
--     staff workspace.
--
-- WHAT CHANGES
--   1. release_unassigned_educators(): removes from a family every staff-team educator who no
--      longer holds an open case there. staff_assign_case calls it, so reassigning a case takes
--      the previous educator out (their calendar links go too, by 061's trigger). An absence
--      (staff_record_educator_absence) does not remove anyone: it may be temporary.
--      Educators who are not on the staff team (pre-060 memberships) are left alone, as in 061.
--   2. The nine parent actions accept only the guardian role. Their bodies are otherwise
--      unchanged copies of their latest definitions (038, 046, 047, 049, 050).
--   3. Lesson progress (activities insert/update) and the unused direct learner writes accept
--      only guardians. Admins read intake details only with active consent, like educators.
--      Admins keep what their work needs: consents, orders, privacy requests and calendar-link
--      metadata stay readable.
--
-- RERUNNABLE: create or replace and drop policy if exists only. No data is changed.

-- 1 ----------------------------------------------------------------------------------------------
create or replace function public.release_unassigned_educators(target_household uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare released integer;
begin
  delete from public.memberships m
   using public.staff_team t
   where m.household_id = target_household
     and t.user_id = m.user_id and t.role = 'educator' and m.role = 'educator'
     and not exists (
       select 1 from public.service_cases c
        where c.household_id = target_household
          and (c.assigned_educator_id = m.user_id or c.assigned_reviewer_id = m.user_id)
          and c.status not in ('closed', 'cancelled', 'refunded', 'chargeback')
     );
  get diagnostics released = row_count;
  return released;
end $$;
revoke all on function public.release_unassigned_educators(uuid) from public, anon, authenticated;

-- 061's staff_assign_case, plus the release above. Everything else is unchanged.
create or replace function public.staff_assign_case(
  target_household uuid,
  target_case uuid,
  target_educator uuid
)
returns table(
  case_id uuid,
  educator_user_id uuid,
  current_status public.case_status,
  updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $function$
declare
  service_case public.service_cases%rowtype;
  capacity_limit integer;
  active_count integer;
begin
  if not public.has_household_role(target_household, array['admin']::public.membership_role[]) then
    raise exception 'admin access required';
  end if;
  -- 061: join a staff-team educator to this family now, unless they already belong to it in
  -- another role (a staff member who is this family's guardian cannot be its educator).
  if exists (select 1 from public.staff_team t where t.user_id = target_educator and t.role = 'educator')
     and not exists (select 1 from public.memberships m where m.household_id = target_household and m.user_id = target_educator) then
    perform public.share_household_with_staff(target_household, target_educator);
  end if;
  if not exists (
    select 1 from public.memberships
     where household_id = target_household and user_id = target_educator and role = 'educator'
  ) then
    raise exception 'assignee must be an educator in this household';
  end if;

  select * into service_case
    from public.service_cases
   where id = target_case and household_id = target_household
   for update;
  if not found then
    raise exception 'case not found';
  end if;
  if service_case.status not in ('triage','assigned','on_hold') then
    raise exception 'case is not assignable';
  end if;

  select ec.max_active_cases into capacity_limit
    from public.educator_capacities ec
   where ec.household_id = target_household
     and ec.educator_user_id = target_educator
   for update;
  if capacity_limit is null then
    raise exception 'educator capacity is not configured';
  end if;

  select count(*) into active_count
    from public.service_cases sc
   where sc.household_id = target_household
     and sc.assigned_educator_id = target_educator
     and sc.status in ('assigned','drafting','internal_review')
     and sc.id <> target_case;
  if active_count >= capacity_limit then
    raise exception 'educator has reached active case capacity';
  end if;

  update public.service_cases
     set assigned_educator_id = target_educator,
         status = 'assigned',
         updated_at = now()
   where id = target_case;

  -- 062: whoever held this case before (and holds no other open case here) leaves the family.
  perform public.release_unassigned_educators(target_household);

  insert into public.audit_events(
    household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'case.assigned', 'service_case', target_case,
          jsonb_build_object('educatorUserId', target_educator));

  return query select target_case, target_educator, 'assigned'::public.case_status, now();
end $function$;
revoke all on function public.staff_assign_case(uuid, uuid, uuid) from public, anon;
grant execute on function public.staff_assign_case(uuid, uuid, uuid) to authenticated;

-- 2 ----------------------------------------------------------------------------------------------
-- guardian_add_learner (from 202608280038_guardian_add_learner.sql)
create or replace function public.guardian_add_learner(
  target_household uuid,
  learner_name text,
  learner_grade text,
  learner_jurisdiction text default 'Ontario',
  start_package text default 'annual'
)
returns table(learner_id uuid, case_id uuid, created_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare
  clean_name text := btrim(learner_name);
  clean_grade text := btrim(learner_grade);
  clean_jurisdiction text := btrim(learner_jurisdiction);
  new_learner uuid;
  new_case uuid;
begin
  if not public.has_household_role(target_household,
                                   array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required';
  end if;
  if clean_name = '' or char_length(clean_name) > 120 then
    raise exception 'learner name is required and must be at most 120 characters';
  end if;
  if clean_grade = '' or char_length(clean_grade) > 60 then
    raise exception 'grade or level is required and must be at most 60 characters';
  end if;
  if clean_jurisdiction = '' then
    raise exception 'jurisdiction is required';
  end if;
  if start_package not in ('essentials','complete','annual') then
    raise exception 'package code is invalid';
  end if;

  insert into public.learners (household_id, preferred_name, grade_label, jurisdiction)
  values (target_household, clean_name, clean_grade, clean_jurisdiction)
  returning id into new_learner;

  -- The case the workflow needs. Beta opens it directly, matching the signup path.
  insert into public.service_cases (household_id, learner_id, package_code, status)
  values (target_household, new_learner, start_package, 'paid')
  returning id into new_case;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type,
                                   subject_id, metadata)
  values (target_household, auth.uid(), 'learner.added', 'learner', new_learner,
          jsonb_build_object('caseId', new_case, 'grade', clean_grade));

  return query select new_learner, new_case, now();
end $function$;

-- set_paused_subjects (from 202608280047_paused_subjects.sql)
create or replace function public.set_paused_subjects(
  target_household uuid,
  target_plan uuid,
  subjects text[]
)
returns text[]
language plpgsql security definer set search_path = public
as $function$
declare
  clean text[];
  unknown text;
begin
  if not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.plans p
     where p.id = target_plan and p.household_id = target_household and p.status = 'published'
  ) then
    raise exception 'plan not found';
  end if;

  select coalesce(array_agg(distinct btrim(s) order by btrim(s)), array[]::text[]) into clean
    from unnest(coalesce(subjects, array[]::text[])) as s where btrim(s) <> '';
  select s into unknown from unnest(clean) as s
   where not exists (
     select 1 from public.lessons l
       join public.plan_days d on d.id = l.day_id
       join public.plan_weeks w on w.id = d.week_id
      where w.plan_id = target_plan and l.subject = s)
   limit 1;
  if unknown is not null then
    raise exception 'subject is not in this plan' using errcode = '22023';
  end if;

  insert into public.plan_schedules as s (plan_id, household_id, start_date, calendar_set, paused_subjects, updated_by, updated_at)
  values (target_plan, target_household, null, false, clean, auth.uid(), now())
  on conflict on constraint plan_schedules_pkey do update
    set paused_subjects = excluded.paused_subjects, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    where s.household_id = target_household;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'plan.subjects_paused', 'plan', target_plan, jsonb_build_object('paused', to_jsonb(clean)));

  return clean;
end $function$;

-- set_plan_schedule (from 202608280047_paused_subjects.sql)
create or replace function public.set_plan_schedule(
  target_household uuid,
  target_plan uuid,
  schedule_start date,
  schedule_school_days smallint[],
  schedule_days_off date[]
)
returns table(plan_id uuid, start_date date, school_days smallint[], days_off date[], updated_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare
  clean_days smallint[];
  clean_off date[];
begin
  if not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.plans p
     where p.id = target_plan and p.household_id = target_household and p.status = 'published'
  ) then
    raise exception 'plan not found';
  end if;

  select coalesce(array_agg(distinct d order by d), array[]::smallint[]) into clean_days
    from unnest(coalesce(schedule_school_days, array[]::smallint[])) as d;
  if cardinality(clean_days) not between 1 and 7 or not clean_days <@ array[1,2,3,4,5,6,7]::smallint[] then
    raise exception 'school days are invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct d order by d), array[]::date[]) into clean_off
    from unnest(coalesce(schedule_days_off, array[]::date[])) as d;
  if cardinality(clean_off) > 366 then
    raise exception 'too many days off' using errcode = '22023';
  end if;
  if schedule_start is not null and (schedule_start < current_date - 366 or schedule_start > current_date + 366) then
    raise exception 'start date is out of range' using errcode = '22023';
  end if;

  insert into public.plan_schedules as s (plan_id, household_id, start_date, school_days, days_off, calendar_set, updated_by, updated_at)
  values (target_plan, target_household, schedule_start, clean_days, clean_off, true, auth.uid(), now())
  on conflict on constraint plan_schedules_pkey do update
    set start_date = excluded.start_date,
        school_days = excluded.school_days,
        days_off = excluded.days_off,
        calendar_set = true,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    where s.household_id = target_household;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'plan.schedule_set', 'plan', target_plan,
          jsonb_build_object('hasStartDate', schedule_start is not null,
                             'schoolDays', to_jsonb(clean_days),
                             'daysOff', cardinality(clean_off)));

  return query
    select s.plan_id, s.start_date, s.school_days, s.days_off, s.updated_at
      from public.plan_schedules s where s.plan_id = target_plan;
end $function$;

-- record_learning_capture (from 202608280046_learning_captures.sql)
create or replace function public.record_learning_capture(
  target_household uuid,
  target_learner uuid,
  capture_date date,
  capture_kind text,
  capture_subjects text[],
  capture_note text
)
returns table(capture_id uuid, captured_on date, created_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare
  clean_subjects text[];
  new_id uuid;
begin
  if not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.learners l where l.id = target_learner and l.household_id = target_household and l.deleted_at is null) then
    raise exception 'learner not found in household' using errcode = '42501';
  end if;
  if capture_date is null or capture_date > current_date + 1 or capture_date < current_date - 366 then
    raise exception 'capture date is out of range' using errcode = '22023';
  end if;
  if capture_kind is null or capture_kind not in ('book','outing','activity','co_op','tutor','note') then
    raise exception 'capture kind is invalid' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct s order by s), array[]::text[]) into clean_subjects
    from unnest(coalesce(capture_subjects, array[]::text[])) as s;
  if not clean_subjects <@ array['Language','Math','Science','Social studies','French','Arts','Health and physical education']::text[] then
    raise exception 'subject is invalid' using errcode = '22023';
  end if;
  if capture_note is null or char_length(btrim(capture_note)) not between 1 and 1000 then
    raise exception 'capture note is required and must be at most 1000 characters' using errcode = '22023';
  end if;

  insert into public.learning_captures (household_id, learner_id, captured_on, kind, subjects, note, created_by)
  values (target_household, target_learner, capture_date, capture_kind, clean_subjects, btrim(capture_note), auth.uid())
  returning id into new_id;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'capture.recorded', 'learning_capture', new_id,
          jsonb_build_object('learnerId', target_learner, 'kind', capture_kind, 'subjects', to_jsonb(clean_subjects)));

  return query select c.id, c.captured_on, c.created_at from public.learning_captures c where c.id = new_id;
end $function$;

-- remove_learning_capture (from 202608280046_learning_captures.sql)
create or replace function public.remove_learning_capture(target_household uuid, target_capture uuid)
returns timestamptz
language plpgsql security definer set search_path = public
as $function$
declare removed timestamptz;
begin
  if not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  update public.learning_captures set removed_at = now()
   where id = target_capture and household_id = target_household and removed_at is null
  returning removed_at into removed;
  if removed is null then
    raise exception 'capture not found' using errcode = '42501';
  end if;
  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'capture.removed', 'learning_capture', target_capture, '{}'::jsonb);
  return removed;
end $function$;

-- move_shared_activity (from 202608280049_shared_activities.sql)
create or replace function public.move_shared_activity(
  target_household uuid,
  target_shared_activity uuid,
  new_date date,
  target_learner uuid default null
)
returns table(activity_id uuid, scheduled_for date, split_learners integer)
language plpgsql security definer set search_path = public
as $function$
begin
  if not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.shared_activities a
     where a.id = target_shared_activity and a.household_id = target_household and a.removed_at is null
  ) then
    raise exception 'shared activity not found' using errcode = '42501';
  end if;
  if new_date is not null and (new_date < current_date - 366 or new_date > current_date + 366) then
    raise exception 'activity date is out of range' using errcode = '22023';
  end if;

  if target_learner is null then
    update public.shared_activities a set scheduled_for = new_date, updated_at = now() where a.id = target_shared_activity;
    update public.shared_activity_learners l set scheduled_for = null, updated_at = now()
     where l.activity_id = target_shared_activity and l.scheduled_for is not null;
  else
    update public.shared_activity_learners l set scheduled_for = new_date, updated_at = now()
     where l.activity_id = target_shared_activity and l.learner_id = target_learner and l.household_id = target_household;
    if not found then
      raise exception 'learner not found in household' using errcode = '42501';
    end if;
  end if;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'shared_activity.moved', 'shared_activity', target_shared_activity,
          jsonb_build_object('date', new_date, 'learnerId', target_learner));

  return query
    select a.id, a.scheduled_for,
           (select count(*)::integer from public.shared_activity_learners l
             where l.activity_id = a.id and l.scheduled_for is not null)
      from public.shared_activities a where a.id = target_shared_activity;
end $function$;

-- set_shared_activity_done (from 202608280049_shared_activities.sql)
create or replace function public.set_shared_activity_done(
  target_household uuid,
  target_shared_activity uuid,
  target_learner uuid,
  done boolean
)
returns timestamptz
language plpgsql security definer set search_path = public
as $function$
declare stamp timestamptz;
begin
  if not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.shared_activities a
     where a.id = target_shared_activity and a.household_id = target_household and a.removed_at is null
  ) then
    raise exception 'shared activity not found' using errcode = '42501';
  end if;
  update public.shared_activity_learners l
     set completed_at = case when done then now() end,
         completed_by = case when done then auth.uid() end,
         updated_at = now()
   where l.activity_id = target_shared_activity and l.learner_id = target_learner and l.household_id = target_household
  returning l.completed_at into stamp;
  if not found then
    raise exception 'learner not found in household' using errcode = '42501';
  end if;
  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), case when done then 'shared_activity.completed' else 'shared_activity.reopened' end,
          'shared_activity', target_shared_activity, jsonb_build_object('learnerId', target_learner));
  return stamp;
end $function$;

-- create_calendar_feed (from 202608280050_calendar_feeds.sql)
create or replace function public.create_calendar_feed(
  target_household uuid,
  target_learner uuid,
  include_titles boolean
)
returns table(feed_id uuid, token text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare
  new_token text;
  new_id uuid;
begin
  if not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.learners l where l.id = target_learner and l.household_id = target_household and l.deleted_at is null) then
    raise exception 'learner not found in household' using errcode = '42501';
  end if;

  -- 64 hex characters from two v4 UUIDs: 244 bits from the server's strong random source.
  new_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  update public.calendar_feeds f set revoked_at = now()
   where f.learner_id = target_learner and f.household_id = target_household and f.revoked_at is null;
  insert into public.calendar_feeds (household_id, learner_id, token_hash, include_titles, created_by)
  values (target_household, target_learner, sha256(convert_to(new_token, 'UTF8')), coalesce(include_titles, false), auth.uid())
  returning id into new_id;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'calendar_feed.created', 'calendar_feed', new_id,
          jsonb_build_object('learnerId', target_learner, 'includeTitles', coalesce(include_titles, false)));

  return query select f.id, new_token, f.created_at from public.calendar_feeds f where f.id = new_id;
end $function$;

-- revoke_calendar_feed (from 202608280050_calendar_feeds.sql)
create or replace function public.revoke_calendar_feed(target_household uuid, target_learner uuid)
returns integer
language plpgsql security definer set search_path = public
as $function$
declare revoked integer;
begin
  if not public.has_household_role(target_household, array['guardian']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  update public.calendar_feeds f set revoked_at = now()
   where f.learner_id = target_learner and f.household_id = target_household and f.revoked_at is null;
  get diagnostics revoked = row_count;
  if revoked > 0 then
    insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
    values (target_household, auth.uid(), 'calendar_feed.revoked', 'learner', target_learner, '{}'::jsonb);
  end if;
  return revoked;
end $function$;

-- 3 ----------------------------------------------------------------------------------------------
drop policy if exists activities_guardian_insert on public.lesson_activities;
create policy activities_guardian_insert on public.lesson_activities
  for insert
  with check (
    public.has_household_role(household_id, array['guardian']::public.membership_role[])
    and updated_by = auth.uid()
  );

drop policy if exists activities_guardian_update on public.lesson_activities;
create policy activities_guardian_update on public.lesson_activities
  for update
  using (
    public.has_household_role(household_id, array['guardian']::public.membership_role[])
  )
  with check (
    public.has_household_role(household_id, array['guardian']::public.membership_role[])
    and updated_by = auth.uid()
  );

-- Unused since 042 revoked direct writes, but they should say the same thing.
drop policy if exists learners_guardian_insert on public.learners;
create policy learners_guardian_insert on public.learners
  for insert
  with check (public.has_household_role(household_id, array['guardian']::public.membership_role[]));

drop policy if exists learners_guardian_update on public.learners;
create policy learners_guardian_update on public.learners
  for update
  using (public.has_household_role(household_id, array['guardian']::public.membership_role[]))
  with check (public.has_household_role(household_id, array['guardian']::public.membership_role[]));

drop policy if exists profiles_consent_limited_select on public.learner_profiles;
create policy profiles_consent_limited_select on public.learner_profiles for select using (
  public.has_household_role(household_id, array['guardian']::public.membership_role[])
  or (
    public.has_household_role(household_id, array['educator','admin']::public.membership_role[])
    and public.has_active_guardian_consent(household_id, learner_id)
  )
);
