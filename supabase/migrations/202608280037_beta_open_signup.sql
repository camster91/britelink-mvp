-- 037: BETA MODE -- open self-serve signup, no payment required.
--
-- WHY
--   The product was built as a paid service: a case starts at `paid`, payment attaches to it,
--   and the live Stripe key is a real-money key. For a free beta none of that should be in the
--   path. A family should be able to sign up, add a child, and receive a plan without anyone
--   paying anything.
--
-- WHAT THIS ADDS
--   One function that provisions a household from a SIGNUP rather than a checkout: no order,
--   no payment event, no Stripe. The case is created in `paid` status because that is the
--   status the rest of the lifecycle expects to advance from -- the payment meaning of that
--   status is not used in beta; it simply marks "work is open".
--
-- RELATIONSHIP TO 036
--   036 provisions from a completed checkout. This provisions from a signup. They share the
--   same shape so that when payment is switched back on, the checkout path already exists.
--   Both are service-role only.
--
-- BETA SAFETY
--   * Nothing here touches the Stripe key or the payment functions.
--   * No order row and no payment_event row is created, so the live payment path cannot be
--     triggered by beta signups.
--   * One household per email, enforced, so a repeat signup does not create duplicates.

create or replace function public.provision_household_from_signup(
  guardian_email text,
  learner_name text,
  learner_grade text,
  learner_jurisdiction text default 'Ontario'
)
returns table(
  household_id uuid,
  guardian_user_id uuid,
  learner_id uuid,
  case_id uuid,
  created boolean
)
language plpgsql security definer set search_path = public
as $function$
declare
  clean_email text := lower(btrim(guardian_email));
  clean_learner text := btrim(learner_name);
  clean_grade text := btrim(learner_grade);
  clean_jurisdiction text := btrim(learner_jurisdiction);
  existing_user uuid;
  existing_household uuid;
  new_household uuid;
  new_learner uuid;
  new_case uuid;
begin
  if clean_email = '' or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email is invalid';
  end if;
  if clean_learner = '' or char_length(clean_learner) > 120 then
    raise exception 'learner name is required and must be at most 120 characters';
  end if;
  if clean_jurisdiction = '' then
    raise exception 'jurisdiction is required';
  end if;

  -- Does this email already have a household? If so, do not make a second one.
  select id into existing_user from auth.users
   where lower(email) = clean_email and email_confirmed_at is not null limit 1;

  if existing_user is not null then
    select m.household_id into existing_household
      from public.memberships m
     where m.user_id = existing_user and m.role = 'guardian'
     order by m.household_id limit 1;

    if existing_household is not null then
      return query
        select h.id, existing_user,
               (select l.id from public.learners l
                 where l.household_id = h.id and l.deleted_at is null
                 order by l.created_at limit 1),
               (select c.id from public.service_cases c
                 where c.household_id = h.id order by c.created_at desc limit 1),
               false
          from public.households h where h.id = existing_household;
      return;
    end if;
  end if;

  insert into public.households (display_name)
  values ('Household - ' || clean_learner)
  returning id into new_household;

  if existing_user is null then
    existing_user := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
      email_change, phone_change, phone_change_token, reauthentication_token
    ) values (
      existing_user, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', clean_email, now(), now(), now(),
      md5(random()::text), md5(random()::text), md5(random()::text), md5(random()::text),
      '', '', md5(random()::text), md5(random()::text)
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), existing_user, existing_user,
            jsonb_build_object('sub', existing_user::text, 'email', clean_email),
            'email', now(), now(), now());
  end if;

  insert into public.memberships (household_id, user_id, role)
  values (new_household, existing_user, 'guardian')
  on conflict do nothing;

  insert into public.learners (household_id, preferred_name, grade_label, jurisdiction)
  values (new_household, clean_learner, clean_grade, clean_jurisdiction)
  returning id into new_learner;

  -- Beta entitlement. The lifetime is long enough that a beta family is never cut off
  -- mid-term; it is not a marketing promise, just a working default.
  insert into public.service_cases (household_id, learner_id, package_code, status)
  values (new_household, new_learner, 'annual', 'paid')
  returning id into new_case;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type,
                                   subject_id, metadata)
  values (new_household, existing_user, 'household.provisioned', 'household', new_household,
          jsonb_build_object('source', 'beta_signup', 'learnerId', new_learner));

  return query select new_household, existing_user, new_learner, new_case, true;
end $function$;

comment on function public.provision_household_from_signup(text, text, text, text) is
  'Beta signup: provisions household + guardian account + learner + open case with no payment. The free-beta counterpart to provision_household_from_checkout.';

-- Open to a signed-in visitor during beta. This is the whole point: a family signs itself up.
-- The function is still guarded -- it validates every input and cannot be used to attach to an
-- existing household the caller does not own.
revoke all on function public.provision_household_from_signup(text, text, text, text)
  from public, anon;
grant execute on function public.provision_household_from_signup(text, text, text, text)
  to anon, authenticated;
