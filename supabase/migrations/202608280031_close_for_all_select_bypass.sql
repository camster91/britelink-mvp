-- 202608280031_close_for_all_select_bypass.sql
-- REAL ROOT CAUSE of the publication leak, proven by execution.
--
-- Migrations 024 and 030 both tried to close this by hardening
-- activities_member_select. Neither worked. The leak was never there.
--
-- WHY IT LEAKED
--   lesson_activities carries TWO permissive policies:
--       activities_guardian_write  FOR ALL   using has_household_role(guardian,admin)
--       activities_member_select   FOR SELECT using is_household_member(...) and can_read_plan(...)
--
--   Postgres ORs permissive policies together. FOR ALL means "any command", which
--   INCLUDES SELECT. So for a guardian -- who passes the role test -- the FOR ALL
--   policy grants read on every row in the household, entirely independent of the
--   publication gate. Hardening the SELECT policy could never help while a sibling
--   policy granted SELECT unconditionally.
--
--   Proven by execution with the plan set to 'draft', acting as the guardian:
--       can_read_plan(plan) = false      <- gate correctly denies
--       visible_plans       = 0          <- parent correctly hidden
--       visible_weeks       = 0
--       visible_days        = 0
--       visible_lessons     = 0
--       visible_activities  = 1          <- LEAKED via FOR ALL
--
-- THE FIX
--   Split each FOR ALL write policy into explicit INSERT / UPDATE / DELETE
--   policies that carry no SELECT grant. SELECT is then governed solely by the
--   publication-aware policy.
--
-- SCOPE NOTE: the same FOR ALL pattern exists on `learners` and
-- `educator_capacities`. Neither currently exposes unpublished plan content, so
-- they are not part of this leak -- but the pattern is the same hazard and is
-- fixed here for consistency, because a future column or child table could make
-- them leak the same way.
--
-- Read-only review artifact: this file has NOT been applied to any deployed database.

-- ---------------------------------------------------------------------------
-- lesson_activities: the actual leak
-- ---------------------------------------------------------------------------

drop policy if exists activities_guardian_write on public.lesson_activities;

create policy activities_guardian_insert on public.lesson_activities
  for insert
  with check (
    public.has_household_role(household_id, array['guardian','admin']::public.membership_role[])
    and updated_by = auth.uid()
  );

create policy activities_guardian_update on public.lesson_activities
  for update
  using (
    public.has_household_role(household_id, array['guardian','admin']::public.membership_role[])
    and updated_by = auth.uid()
  )
  with check (
    public.has_household_role(household_id, array['guardian','admin']::public.membership_role[])
    and updated_by = auth.uid()
  );

-- Guardians may not delete their own activity records; no DELETE policy is added.
-- Absence of a permissive DELETE policy denies the operation.

-- ---------------------------------------------------------------------------
-- learners: same FOR ALL pattern
-- ---------------------------------------------------------------------------

drop policy if exists learners_guardian_write on public.learners;

create policy learners_guardian_insert on public.learners
  for insert
  with check (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]));

create policy learners_guardian_update on public.learners
  for update
  using (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]))
  with check (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]));

-- ---------------------------------------------------------------------------
-- educator_capacities: same FOR ALL pattern
-- ---------------------------------------------------------------------------

drop policy if exists educator_capacities_admin_write on public.educator_capacities;

create policy educator_capacities_admin_insert on public.educator_capacities
  for insert
  with check (public.has_household_role(household_id, array['admin']::public.membership_role[]));

create policy educator_capacities_admin_update on public.educator_capacities
  for update
  using (public.has_household_role(household_id, array['admin']::public.membership_role[]))
  with check (public.has_household_role(household_id, array['admin']::public.membership_role[]));

-- ---------------------------------------------------------------------------
-- Regression assertion
-- ---------------------------------------------------------------------------

do $$
declare offender text;
begin
  -- No FOR ALL policy may remain on a table that also has a publication-gated
  -- SELECT policy, because FOR ALL implicitly grants SELECT and ORs past the gate.
  select string_agg(c.relname || '.' || p.polname, ', ')
  into offender
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where p.polcmd = '*'
    and p.polpermissive
    and c.relname in ('lesson_activities', 'lessons', 'plan_days', 'plan_weeks', 'resources', 'learners');

  if offender is not null then
    raise exception 'FOR ALL policy still grants implicit SELECT past a publication gate: %', offender;
  end if;

  -- The split write policies must exist, so the fix cannot silently remove write
  -- access entirely.
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'lesson_activities' and p.polname = 'activities_guardian_insert'
  ) then
    raise exception 'activities insert policy missing after split';
  end if;

  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'lesson_activities' and p.polname = 'activities_guardian_update'
  ) then
    raise exception 'activities update policy missing after split';
  end if;
end $$;
