-- 064: staff approve a new family before its case opens (owner decision 2026-10-21).
--
-- WHY
--   Anyone can sign up, and each signup got an open case at once (060). A script with throwaway
--   mailboxes could fill the staff queue with fake families, and every message from them emailed
--   staff. Cameron decided that a staff admin approves each self-signup family first.
--
-- WHAT CHANGES
--   1. households.approved_at. Every existing family, and every family staff create, is approved
--      (the column defaults to now()). Only provision_beta_household creates a family that waits.
--   2. staff_approve_household(): a staff admin approves a waiting family. Recorded in audit_events.
--   3. While a family waits, its case cannot move past the family's own steps (paid, intake
--      pending, submitted), and no educator can be assigned. Closing, cancelling, refunds and
--      chargebacks still work, so a fake signup can be closed without approving it.
--   4. While a family waits, its messages do not email staff.
--   The family can still set up, fill in and submit the intake form while they wait.
--
-- RERUNNABLE: add column if not exists, create or replace, drop trigger if exists. Rerunning never
-- approves or un-approves anyone.

-- 1 ----------------------------------------------------------------------------------------------
alter table public.households add column if not exists approved_at timestamptz default now();

create or replace function public.provision_beta_household(
  learner_name text,
  learner_grade text,
  learner_jurisdiction text default 'Ontario'
)
returns table(
  household_id uuid,
  learner_id uuid,
  case_id uuid,
  created boolean
)
language plpgsql security definer set search_path = public
as $function$
declare
  caller uuid := auth.uid();
  clean_learner text := btrim(coalesce(learner_name, ''));
  clean_grade text := btrim(coalesce(learner_grade, ''));
  clean_jurisdiction text := btrim(coalesce(learner_jurisdiction, ''));
  existing_household uuid;
  new_household uuid;
  new_learner uuid;
  new_case uuid;
begin
  if caller is null then
    raise exception 'signed-in account required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = caller and u.email_confirmed_at is not null) then
    raise exception 'confirmed email required' using errcode = '42501';
  end if;

  -- One provisioning at a time per account; the membership check below is then race-free.
  perform pg_advisory_xact_lock(hashtext('provision_beta_household:' || caller::text));

  select m.household_id into existing_household
    from public.memberships m
   where m.user_id = caller
     -- 060: only the caller's own family counts. A staff member now belongs to every family's
     -- household, and must never be handed one of those as "their" family.
     and m.role = 'guardian'
   order by m.created_at, m.household_id
   limit 1;

  if existing_household is not null then
    return query
      select existing_household,
             (select l.id from public.learners l
               where l.household_id = existing_household and l.deleted_at is null
               order by l.created_at limit 1),
             (select c.id from public.service_cases c
               where c.household_id = existing_household order by c.created_at desc limit 1),
             false;
    return;
  end if;

  if clean_learner = '' or char_length(clean_learner) > 120 then
    raise exception 'learner name is required and must be at most 120 characters' using errcode = '22023';
  end if;
  if clean_grade = '' or char_length(clean_grade) > 60 then
    raise exception 'learner grade is required and must be at most 60 characters' using errcode = '22023';
  end if;
  if clean_jurisdiction = '' or char_length(clean_jurisdiction) > 120 then
    raise exception 'jurisdiction is required' using errcode = '22023';
  end if;

  -- 064: a family that signs itself up waits for a staff admin's approval.
  insert into public.households (display_name, approved_at)
  values ('Household - ' || clean_learner, null)
  returning id into new_household;

  insert into public.memberships (household_id, user_id, role)
  values (new_household, caller, 'guardian');

  insert into public.learners (household_id, preferred_name, grade_label, jurisdiction)
  values (new_household, clean_learner, clean_grade, clean_jurisdiction)
  returning id into new_learner;

  -- Beta entitlement, unchanged from 037: long enough that a beta family is never cut off
  -- mid-term; not a marketing promise.
  insert into public.service_cases (household_id, learner_id, package_code, status)
  values (new_household, new_learner, 'annual', 'paid')
  returning id into new_case;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type,
                                   subject_id, metadata)
  values (new_household, caller, 'household.provisioned', 'household', new_household,
          jsonb_build_object('source', 'beta_signup', 'learnerId', new_learner));

  return query select new_household, new_learner, new_case, true;
end $function$;
revoke all on function public.provision_beta_household(text, text, text) from public, anon;
grant execute on function public.provision_beta_household(text, text, text) to authenticated;

-- 2 ----------------------------------------------------------------------------------------------
create or replace function public.staff_approve_household(target_household uuid)
returns timestamptz
language plpgsql security definer set search_path = public
as $function$
declare approved timestamptz;
begin
  if not public.has_household_role(target_household, array['admin']::public.membership_role[]) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  update public.households set approved_at = now()
   where id = target_household and approved_at is null
   returning approved_at into approved;
  if approved is null then
    select h.approved_at into approved from public.households h where h.id = target_household;
    return approved;
  end if;
  insert into public.audit_events(household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'household.approved', 'household', target_household, '{}'::jsonb);
  return approved;
end $function$;
revoke all on function public.staff_approve_household(uuid) from public, anon;
grant execute on function public.staff_approve_household(uuid) to authenticated;

-- 3 ----------------------------------------------------------------------------------------------
create or replace function public.enforce_household_approved()
returns trigger
-- Security definer so the check sees the household whoever makes the change.
language plpgsql security definer set search_path = public
as $function$
begin
  if exists (select 1 from public.households h where h.id = new.household_id and h.approved_at is null)
     and (
       (new.status is distinct from old.status
        and new.status not in ('paid', 'intake_pending', 'submitted', 'closed', 'cancelled', 'refunded', 'chargeback'))
       or new.assigned_educator_id is distinct from old.assigned_educator_id
     ) then
    raise exception 'approve this family before starting work on its case';
  end if;
  return new;
end $function$;
revoke all on function public.enforce_household_approved() from public, anon, authenticated;

drop trigger if exists service_cases_require_approved_household on public.service_cases;
create trigger service_cases_require_approved_household
  before update of status, assigned_educator_id on public.service_cases
  for each row execute function public.enforce_household_approved();

-- 4 ----------------------------------------------------------------------------------------------
create or replace function public.notify_on_case_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare educator uuid; sender_is_guardian boolean;
begin
  select exists(select 1 from public.memberships m where m.household_id = new.household_id and m.user_id = new.sender_user_id and m.role = 'guardian')
    into sender_is_guardian;
  if sender_is_guardian then
    -- 064: staff are not emailed about a family that is still waiting for approval. The message
    -- is kept, and staff see it once they approve the family.
    if exists (select 1 from public.households h where h.id = new.household_id and h.approved_at is null) then
      return new;
    end if;
    select sc.assigned_educator_id into educator from public.service_cases sc where sc.id = new.case_id;
    perform public.enqueue_notification(new.household_id,
      case when educator is not null then array[educator]
           else (select coalesce(array_agg(m.user_id), '{}') from public.memberships m where m.household_id = new.household_id and m.role = 'admin') end,
      'message_to_staff', new.id, new.sender_user_id);
  else
    perform public.enqueue_notification(new.household_id, public.household_guardians(new.household_id), 'message_to_guardian', new.id, new.sender_user_id);
  end if;
  return new;
end $$;
revoke all on function public.notify_on_case_message() from public, anon, authenticated;
