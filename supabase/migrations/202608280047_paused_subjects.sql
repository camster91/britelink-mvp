-- 047: pause a subject without rewriting the plan (#40).
--
-- WHY
--   "Pause a subject" is one of the four flexible-week moves families ask for (skip a day, carry
--   forward, rebalance, pause). A paused subject's lessons stay in the plan and the record; the
--   next action and the student list simply pass them by until the subject is resumed.
--
-- MODEL
--   plan_schedules.paused_subjects -- the plan's subject names the family has paused. It lives on
--   the family calendar row (043) because it describes the family's week, not the curriculum.
--   set_paused_subjects writes only this column, creating the calendar row (own pace, no start
--   date) if the family has not set one, and only lists subjects that actually occur in the plan.

-- calendar_set distinguishes "the family chose a calendar (or chose own pace)" from "a row exists
-- only because a subject was paused". Without it, pausing a subject would silently read as having
-- chosen own pace, and the family would never be asked when they school.
alter table public.plan_schedules
  add column calendar_set boolean not null default true,
  add column paused_subjects text[] not null default array[]::text[],
  add constraint plan_schedules_paused_subjects_bounded check (cardinality(paused_subjects) <= 50);

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
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
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

revoke all on function public.set_paused_subjects(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_paused_subjects(uuid, uuid, text[]) to authenticated;

-- set_plan_schedule (043) marks the calendar as chosen; body otherwise verbatim.
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
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
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

-- The export carries paused subjects with the rest of the family calendar (046's wrapper, one column added).
create or replace function public.export_guardian_household_authorized(target_household uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $function$
declare payload jsonb := public.export_guardian_household_core(target_household);
begin
  payload := jsonb_set(payload, '{manifest,included}', (payload #> '{manifest,included}') || '["planSchedules","learningCaptures"]'::jsonb);
  payload := jsonb_set(payload, '{lessons}', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.day_id, x.position)
      from (select id, day_id, position, subject, title, objective, instructions, materials, accommodations,
                   adult_help_minutes, estimated_minutes, help_level, needs_screen
              from public.lessons where household_id = target_household) x), '[]'::jsonb));
  return payload
    || jsonb_build_object('planSchedules', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.plan_id)
           from (select plan_id, start_date, school_days, days_off, calendar_set, paused_subjects, updated_at
                   from public.plan_schedules where household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('learningCaptures', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.captured_on, x.created_at)
           from (select id, learner_id, captured_on, kind, subjects, note, created_at, removed_at
                   from public.learning_captures where household_id = target_household) x), '[]'::jsonb));
end $function$;
revoke all on function public.export_guardian_household_authorized(uuid) from public, anon, authenticated;
