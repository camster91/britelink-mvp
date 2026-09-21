-- 202608280030_fix_activities_publication_leak.sql
-- Regression fix: migration 024 closed the unpublished-plan leak for plans,
-- weeks, days, and lessons, but NOT for lesson_activities.
--
-- QA (britelink-qa-synthetic-stack.md) proved it by execution. With a plan set to
-- 'draft', acting as a guardian:
--     visible_plans      = 0   blocked
--     visible_weeks      = 0   blocked
--     visible_lessons    = 0   blocked
--     visible_activities = 1   LEAKED
--
-- ROOT CAUSE
--   024's activities_member_select reached the plan through a JOIN chain:
--       lesson_activities -> lessons -> plan_days -> plan_weeks -> can_read_plan
--   The policy expression is evaluated with the CALLER's privileges, but the
--   intermediate tables (lessons, plan_days, plan_weeks) are themselves protected
--   by RLS. Once those child policies correctly hid the draft rows, the join
--   became unreliable as the sole gate: the activity row's own
--   `is_household_member(household_id)` test still passed, and the EXISTS result
--   did not reliably resolve false.
--
-- THE FIX
--   Resolve the whole ancestry inside one SECURITY DEFINER function, so the
--   publication decision is made from the real hierarchy regardless of what the
--   caller can see, and the policy reduces to a single unambiguous predicate.
--   This mirrors how can_read_plan already works for the parent plan.
--
-- Read-only review artifact: this file has NOT been applied to any deployed database.

-- Walk from an activity up to its plan and apply the publication rule there.
create or replace function public.activity_plan_id(target_activity uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.plan_id
  from public.lesson_activities a
  join public.lessons l on l.id = a.lesson_id
  join public.plan_days d on d.id = l.day_id
  join public.plan_weeks w on w.id = d.week_id
  where a.id = target_activity;
$$;

revoke all on function public.activity_plan_id(uuid) from public;
grant execute on function public.activity_plan_id(uuid) to authenticated, service_role;

-- The activity is readable when its owning plan is readable. Single predicate,
-- no join in the policy itself, so there is nothing left for RLS ordering to
-- perturb.
drop policy if exists activities_member_select on public.lesson_activities;
create policy activities_member_select on public.lesson_activities
  for select
  using (
    public.is_household_member(household_id)
    and public.can_read_plan(public.activity_plan_id(id))
  );

-- Same treatment for lessons and days, for the same reason: their policies reach
-- the plan through joins into RLS-protected tables. Resolving the ancestry inside
-- a definer function removes that dependency.
create or replace function public.lesson_plan_id(target_lesson uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.plan_id
  from public.lessons l
  join public.plan_days d on d.id = l.day_id
  join public.plan_weeks w on w.id = d.week_id
  where l.id = target_lesson;
$$;

revoke all on function public.lesson_plan_id(uuid) from public;
grant execute on function public.lesson_plan_id(uuid) to authenticated, service_role;

drop policy if exists lessons_member_select on public.lessons;
create policy lessons_member_select on public.lessons
  for select
  using (
    public.is_household_member(household_id)
    and public.can_read_plan(public.lesson_plan_id(id))
  );

create or replace function public.day_plan_id(target_day uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.plan_id
  from public.plan_days d
  join public.plan_weeks w on w.id = d.week_id
  where d.id = target_day;
$$;

revoke all on function public.day_plan_id(uuid) from public;
grant execute on function public.day_plan_id(uuid) to authenticated, service_role;

drop policy if exists days_member_select on public.plan_days;
create policy days_member_select on public.plan_days
  for select
  using (
    public.is_household_member(household_id)
    and public.can_read_plan(public.day_plan_id(id))
  );

-- Regression assertion: every publication-gated child policy must test the
-- plan via a helper, never via an inline join into another RLS-protected table.
do $$
declare offender text;
begin
  select string_agg(p.polname, ', ')
  into offender
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname in ('plan_weeks','plan_days','lessons','lesson_activities','resources')
    and p.polname in (
      'weeks_member_select','days_member_select','lessons_member_select',
      'activities_member_select','resources_member_select'
    )
    and pg_get_expr(p.polqual, p.polrelid) not like '%can_read_plan%';

  if offender is not null then
    raise exception 'publication gate missing on: %', offender;
  end if;

  -- The specific regression: an inline join to lessons/plan_days in a child
  -- policy reintroduces the ordering dependency that leaked.
  select string_agg(p.polname, ', ')
  into offender
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname in ('lesson_activities','lessons')
    and p.polname in ('activities_member_select','lessons_member_select')
    and pg_get_expr(p.polqual, p.polrelid) like '%JOIN%';

  if offender is not null then
    raise exception 'child policy still joins an RLS-protected table inline: %', offender;
  end if;
end $$;
