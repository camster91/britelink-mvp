-- 040: let a guardian read back a lesson activity that is not yet linked to a plan.
--
-- WHY
--   Saving lesson progress failed with 42501 for every signed-in guardian. The INSERT was
--   always allowed; the failure came from the read-back. PostgREST wraps writes in a CTE that
--   re-reads the inserted row, so the SELECT policy runs on the new row even when the client
--   did not ask for representation.
--
--   The SELECT policy was:
--     is_household_member(household_id) AND can_read_plan(activity_plan_id(id))
--   and can_read_plan() requires an existing, published plan. A brand-new activity has no plan
--   link yet, so activity_plan_id(id) is NULL, can_read_plan(NULL) is false, the read-back
--   fails, and the whole statement aborts with a misleading "row violates row-level security
--   policy" error on the INSERT.
--
-- WHAT THIS CHANGES
--   A not-yet-linked activity (activity_plan_id(id) IS NULL) is now readable by a member of its
--   own household. Linked activities keep the existing gate unchanged.
--
-- SAFETY
--   This only widens visibility to unlinked rows within the caller's own household.
--   is_household_member(household_id) is still required, so cross-household reads remain
--   blocked, and all linked rows still require can_read_plan().

drop policy if exists activities_member_select on public.lesson_activities;

create policy activities_member_select on public.lesson_activities
  for select
  using (
    public.is_household_member(household_id)
    and (
      public.activity_plan_id(id) is null
      or public.can_read_plan(public.activity_plan_id(id))
    )
  );

comment on policy activities_member_select on public.lesson_activities is
  'Members may read activities in their own household; linked activities additionally require can_read_plan(). Unlinked (new) activities are readable so PostgREST read-back succeeds after insert.';
