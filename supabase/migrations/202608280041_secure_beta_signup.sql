-- 041: beta signup provisions only the signed-in caller, after they prove the email is theirs.
--
-- WHY
--   037's provision_household_from_signup(guardian_email, ...) was SECURITY DEFINER and granted
--   to anon. The sign-in page called it before the family had clicked any link, so anyone holding
--   the public anon key could:
--     1. enumerate families: for an existing guardian email it returned that family's
--        household_id, user_id, learner_id and case_id to an unauthenticated caller;
--     2. create confirmed accounts for emails they do not own: it inserted auth.users with
--        email_confirmed_at = now(), plus a household, a learner name of the caller's choosing,
--        and a free annual case -- with no ownership proof and no rate limit.
--
-- WHAT CHANGES
--   The anon-callable function is dropped. provision_beta_household() takes no email: the account
--   is auth.uid(), GoTrue has already created it through the magic link (signInWithOtp with
--   shouldCreateUser), and email_confirmed_at is only set once the family clicked that link. The
--   function refuses unconfirmed accounts, returns only the caller's own household when one
--   exists, and serialises per caller so a double-submit cannot create two households.
--
-- DEPLOY ORDER
--   Ship with the matching src/ change (AuthenticatedApp.jsx calls provisionBetaHousehold after
--   sign-in). Deploying this migration alone breaks beta signup on the old client, which is the
--   intended failure mode: closed, not open.

drop function if exists public.provision_household_from_signup(text, text, text, text);

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

  insert into public.households (display_name)
  values ('Household - ' || clean_learner)
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

comment on function public.provision_beta_household(text, text, text) is
  'Beta signup for the signed-in, email-confirmed caller only. Replaces 037''s anon-callable provision_household_from_signup.';

revoke all on function public.provision_beta_household(text, text, text) from public, anon;
grant execute on function public.provision_beta_household(text, text, text) to authenticated;
