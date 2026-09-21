-- 039: expose the caller's identity so the lesson-save failure can be diagnosed.
--
-- WHY
--   A guardian's insert into lesson_activities is refused with 42501, while an identical insert
--   as superuser succeeds. The INSERT policy is:
--
--     has_household_role(household_id, ['guardian','admin']) AND updated_by = auth.uid()
--
--   has_household_role already returns true for this guardian, so the failure is either
--   auth.uid() returning something unexpected, or the policy evaluating differently than the
--   individual calls suggest. Neither can be observed from outside the database.
--
-- WHAT THIS IS
--   A read-only diagnostic. It returns the caller's uid and the role predicate result for one
--   household, so a test can compare a hand-minted token against a genuine GoTrue token.
--
-- SAFETY
--   SECURITY INVOKER, so auth.uid() resolves for the caller. No writes, no arguments that alter
--   state, and it exposes only the caller's own identity. Granted to authenticated only.
--
--   This should be REMOVED once the diagnosis is complete; it is a temporary instrument, not
--   product surface.

create or replace function public.diagnose_caller_identity(target_household uuid)
returns table(
  caller_uid uuid,
  is_guardian boolean,
  is_member boolean,
  role_count integer
)
language sql stable security invoker set search_path = public
as $function$
  select
    auth.uid(),
    public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]),
    public.is_household_member(target_household),
    (select count(*)::integer from public.memberships m
      where m.household_id = target_household and m.user_id = auth.uid());
$function$;

comment on function public.diagnose_caller_identity(uuid) is
  'TEMPORARY diagnostic: returns the caller uid and role predicates for one household, to diagnose the lesson_activities 42501. Remove once resolved.';

revoke all on function public.diagnose_caller_identity(uuid) from public, anon;
grant execute on function public.diagnose_caller_identity(uuid) to authenticated;
