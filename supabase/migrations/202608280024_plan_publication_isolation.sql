-- 202608280024_plan_publication_isolation.sql
-- Security review HIGH-1: guardians could read unpublished plan content through
-- child-table RLS policies (plan_weeks, plan_days, lessons, resources), because
-- those policies only checked household membership while the parent `plans`
-- policy hides non-published plans from non-staff.
--
-- This migration makes the publication rule transitive: a guardian may only see
-- child rows whose owning plan is published. Educators/admins keep full access.
--
-- Read-only review artifact: this file has NOT been applied to any database.

-- Helper: is this plan visible to the calling user?
-- Published plans are visible to any household member; unpublished plans are
-- visible only to educator/admin roles in that household.
create or replace function public.can_read_plan(target_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = target_plan
      and public.is_household_member(p.household_id)
      and (
        p.status = 'published'
        or public.has_household_role(
             p.household_id,
             array['educator','admin']::public.membership_role[]
           )
      )
  );
$$;

revoke all on function public.can_read_plan(uuid) from public;
grant execute on function public.can_read_plan(uuid) to authenticated;

-- plan_weeks: enforce the parent plan's publication state.
drop policy if exists weeks_member_select on public.plan_weeks;
create policy weeks_member_select on public.plan_weeks
  for select
  using (
    public.is_household_member(household_id)
    and public.can_read_plan(plan_id)
  );

-- plan_days: reach the plan via its week.
drop policy if exists days_member_select on public.plan_days;
create policy days_member_select on public.plan_days
  for select
  using (
    public.is_household_member(household_id)
    and exists (
      select 1 from public.plan_weeks w
      where w.id = plan_days.week_id
        and public.can_read_plan(w.plan_id)
    )
  );

-- lessons: reach the plan via day -> week.
drop policy if exists lessons_member_select on public.lessons;
create policy lessons_member_select on public.lessons
  for select
  using (
    public.is_household_member(household_id)
    and exists (
      select 1
      from public.plan_days d
      join public.plan_weeks w on w.id = d.week_id
      where d.id = lessons.day_id
        and public.can_read_plan(w.plan_id)
    )
  );

-- lesson_activities: reach the plan via lesson -> day -> week.
drop policy if exists activities_member_select on public.lesson_activities;
create policy activities_member_select on public.lesson_activities
  for select
  using (
    public.is_household_member(household_id)
    and exists (
      select 1
      from public.lessons l
      join public.plan_days d on d.id = l.day_id
      join public.plan_weeks w on w.id = d.week_id
      where l.id = lesson_activities.lesson_id
        and public.can_read_plan(w.plan_id)
    )
  );

-- resources: resources carry plan_id directly (see 202608280002_operations.sql).
drop policy if exists resources_member_select on public.resources;
create policy resources_member_select on public.resources
  for select
  using (
    public.is_household_member(household_id)
    and public.can_read_plan(plan_id)
  );

-- Regression assertion: fail the migration loudly if any of the four child
-- policies were left without the publication check.
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
    raise exception 'plan publication isolation not applied to: %', offender;
  end if;
end $$;
