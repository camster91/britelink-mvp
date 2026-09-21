-- 033: the missing first step -- a supported way to OPEN a case.
--
-- WHY THIS EXISTS
--   A `service_cases` row is the spine of the product: every staff RPC takes a `target_case`
--   that must already exist, and `admin_ingest_payment_event` explicitly *looks up* a case and
--   raises 'case not found' when there is none. Nothing in the product created one:
--
--     * the guardian cannot          -> cases_staff_write allows only educator/admin
--     * a payment cannot             -> it attaches to an existing case, by design
--     * a plain admin table insert   -> refused with 42501; the policy's WITH CHECK is not
--                                       satisfied by an INSERT issued through PostgREST
--
--   So a case had to be created by hand, and there was no supported way to do that. This
--   migration adds exactly one guarded entry point and nothing else.
--
-- DESIGN CHOICE (recorded, not inferred away)
--   Staff open the case; payment then attaches to it. This preserves the deliberate invariant
--   in the payment layer -- that a payment must match a case that already exists -- rather
--   than inverting it. See reviews/britelink-case-creation-proposal.md for the rejected
--   alternative and why it was rejected (a purchase records no learner).
--
-- WHAT THIS DOES NOT DO
--   It does not create cases for existing payments, does not touch payment handling, and does
--   not relax any policy. The table's RLS is unchanged. The function is SECURITY DEFINER and
--   re-checks authorisation itself, which is the same shape as staff_assign_case.

create or replace function public.staff_create_case(
  target_household uuid,
  target_learner uuid,
  target_package_code text
)
returns table(case_id uuid, current_status public.case_status, package_code text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  learner_row public.learners%rowtype;
  existing_open integer;
  new_case_id uuid;
begin
  -- Same guard shape as every other staff RPC: membership in THIS household, as admin.
  -- has_household_role reads auth.uid(), so a caller cannot act on a household they are not
  -- an admin of, even though the function itself runs as the definer.
  if not public.has_household_role(target_household, array['admin']::public.membership_role[]) then
    raise exception 'admin access required';
  end if;

  -- The learner must belong to the household the case is being opened for. Without this the
  -- two foreign keys would happily accept a learner from a different family.
  select * into learner_row
    from public.learners
   where id = target_learner and household_id = target_household;
  if not found then
    raise exception 'learner not found in household';
  end if;

  -- A household should not accumulate duplicate open work for the same child. One live case
  -- per learner at a time; the guardian can be invited again once the previous one closes.
  select count(*) into existing_open
    from public.service_cases
   where household_id = target_household
     and learner_id = target_learner
     and status not in ('closed','cancelled','refunded','chargeback');
  if existing_open > 0 then
    raise exception 'an open case already exists for this learner';
  end if;

  -- Status starts at 'paid', which is the first member of the case_status enum and the state
  -- the payment layer expects to attach to.
  insert into public.service_cases (household_id, learner_id, package_code, status)
  values (target_household, target_learner, target_package_code, 'paid')
  returning id into new_case_id;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (
    target_household, auth.uid(), 'case.created', 'service_case', new_case_id,
    jsonb_build_object('learnerId', target_learner, 'packageCode', target_package_code)
  );

  return query
    select c.id, c.status, c.package_code, c.created_at
      from public.service_cases c
     where c.id = new_case_id;
end $$;

comment on function public.staff_create_case(uuid, uuid, text) is
  'Opens a service case for a learner. Admin-only, within the household. The entry point that was missing: every other staff RPC requires an existing case.';

-- Execute is granted narrowly. The function authorises on its own terms, but limiting who can
-- even reach it keeps the surface small: anon has no business calling a staff action at all.
revoke all on function public.staff_create_case(uuid, uuid, text) from public, anon;
grant execute on function public.staff_create_case(uuid, uuid, text) to authenticated;
