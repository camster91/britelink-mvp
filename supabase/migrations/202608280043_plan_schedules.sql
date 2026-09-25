-- 043: a family-owned calendar for a published plan (#40).
--
-- WHY
--   Plans are numbered weeks and days; plan_days.planned_date is optional and usually null, so the
--   product had no way to say which real day a plan day falls on. Without that, "take today off",
--   "shift the rest of the week" and a date-aware next action are impossible, and the learning
--   record has no dates.
--
-- MODEL (the Homeschool Planet pattern: a start date plus school days, and days off that shift
--   everything after them)
--   * start_date + school_days (ISO weekdays, 1 = Monday .. 7 = Sunday) place plan days, in order,
--     on successive school days. The client computes the dates; nothing is stored per lesson.
--   * days_off is the append-only history of days the family took off. A day off shifts every
--     later plan day by one school day. Removing one undoes it.
--   * An educator-set plan_days.planned_date stays a fixed commitment and is not moved.
--   * start_date null means "no fixed days": the family goes at its own pace (loop scheduling).
--   Guardians own this row, not staff: it describes the family's week, not the curriculum.

create table public.plan_schedules (
  plan_id uuid primary key references public.plans(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  start_date date,
  school_days smallint[] not null default array[1,2,3,4,5]::smallint[],
  days_off date[] not null default array[]::date[],
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint plan_schedules_school_days_valid check (
    cardinality(school_days) between 1 and 7
    and school_days <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint plan_schedules_days_off_bounded check (cardinality(days_off) <= 366)
);

alter table public.plan_schedules enable row level security;

-- Readable by the household's members, and only for a plan they can read.
create policy plan_schedules_member_select on public.plan_schedules
  for select using (public.is_household_member(household_id) and public.can_read_plan(plan_id));

grant select on table public.plan_schedules to authenticated;

-- The only write path. A guardian or admin of the plan's own household, published plans only.
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

  insert into public.plan_schedules as s (plan_id, household_id, start_date, school_days, days_off, updated_by, updated_at)
  values (target_plan, target_household, schedule_start, clean_days, clean_off, auth.uid(), now())
  on conflict on constraint plan_schedules_pkey do update
    set start_date = excluded.start_date,
        school_days = excluded.school_days,
        days_off = excluded.days_off,
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

revoke all on function public.set_plan_schedule(uuid, uuid, date, smallint[], date[]) from public, anon;
grant execute on function public.set_plan_schedule(uuid, uuid, date, smallint[], date[]) to authenticated;

-- The schedule is the family's own data, so it is part of their portable export. The export body
-- (020, wrapped by 021's recent-authentication check) is renamed and wrapped here rather than
-- rewritten: the wrapper adds planSchedules to the payload and to manifest.included. The change is
-- additive, so schemaVersion stays 2.
alter function public.export_guardian_household_authorized(uuid) rename to export_guardian_household_core;
create function public.export_guardian_household_authorized(target_household uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $function$
declare payload jsonb := public.export_guardian_household_core(target_household);
begin
  payload := jsonb_set(payload, '{manifest,included}', (payload #> '{manifest,included}') || '["planSchedules"]'::jsonb);
  return payload || jsonb_build_object('planSchedules', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.plan_id)
      from (select plan_id, start_date, school_days, days_off, updated_at
              from public.plan_schedules where household_id = target_household) x), '[]'::jsonb));
end $function$;
revoke all on function public.export_guardian_household_core(uuid) from public, anon, authenticated;
revoke all on function public.export_guardian_household_authorized(uuid) from public, anon, authenticated;

comment on table public.plan_schedules is
  'Family-owned calendar for a published plan: start date, school weekdays, and days off. Dates are derived client-side; nothing is stored per lesson.';
