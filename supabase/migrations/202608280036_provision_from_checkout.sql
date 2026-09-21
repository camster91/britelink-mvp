-- 036: the front door -- a completed checkout provisions a family.
--
-- THE GAP
--   The payment side of this product is complete: Stripe verification, `orders`,
--   `payment_events`, replay protection, package tiers. The account side is absent. Nothing
--   created a household, a guardian account, a learner, or a case:
--
--     insert into public.households   -> no such statement anywhere
--     insert into public.learners     -> no such statement anywhere
--     signInWithOtp(shouldCreateUser:false) -> an unknown email is silently ignored
--
--   So a paying customer could not be let in. This adds the provisioning step that sits
--   between a confirmed payment and a working workspace.
--
-- WHAT IT DOES, IN ONE TRANSACTION
--   Given the details a checkout already carries (email, child's name, grade, package), it
--   creates household + guardian account + membership + learner + case(status 'paid').
--   The case starts at 'paid', which is the state `admin_ingest_payment_event` expects to
--   attach to -- so the existing payment path then works unchanged.
--
-- WHY THE LEARNER IS CAPTURED HERE
--   A case requires a `learner_id`. A payment alone records no learner, which is why an
--   automatic case could not be created before. Collecting the child's name and grade at
--   checkout is what makes creation possible; it is a required input, not a default.
--
-- IDEMPOTENCY
--   Checkout webhooks are delivered more than once. The caller passes the checkout id and a
--   repeated call returns the existing household rather than creating a second one. This
--   mirrors the replay handling already present in `admin_ingest_payment_event`.
--
-- AUTHORISATION
--   This runs as a service-role operation from the payment webhook, not from a browser. It is
--   not granted to `anon` or `authenticated`: no client may provision a household.

create or replace function public.provision_household_from_checkout(
  checkout_id text,
  guardian_email text,
  learner_name text,
  learner_grade text,
  package_code text,
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
  clean_checkout text := btrim(checkout_id);
  existing_household uuid;
  new_household uuid;
  new_user uuid;
  new_learner uuid;
  new_case uuid;
begin
  if clean_checkout = '' then raise exception 'checkout id is required'; end if;
  if clean_email = '' or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'guardian email is invalid';
  end if;
  if clean_learner = '' or char_length(clean_learner) > 120 then
    raise exception 'learner name is required and must be at most 120 characters';
  end if;
  if package_code not in ('essentials','complete','annual') then
    raise exception 'package code is invalid';
  end if;
  if learner_jurisdiction is null or btrim(learner_jurisdiction) = '' then
    raise exception 'learner jurisdiction is required';
  end if;

  -- Idempotency: one checkout provisions exactly one household.
  --
  -- The unique key is `orders.external_checkout_id`, and this function writes that order row
  -- itself (below). Reading a row that a later step creates would not work: on a replayed
  -- webhook the order does not exist yet, so the second delivery would provision again and
  -- create a duplicate household, learner and case for a real family.
  select o.household_id into existing_household
    from public.orders o where o.external_checkout_id = clean_checkout
   limit 1;

  if existing_household is not null then
    return query
      select h.id,
             (select m.user_id from public.memberships m
               where m.household_id = h.id and m.role = 'guardian' limit 1),
             (select l.id from public.learners l where l.household_id = h.id limit 1),
             (select c.id from public.service_cases c where c.household_id = h.id limit 1),
             false
        from public.households h where h.id = existing_household;
    return;
  end if;

  insert into public.households (display_name)
  values ('Household - ' || clean_learner)
  returning id into new_household;

  -- Reuse an existing account for this email if one is already present (a second child, a
  -- repeat purchase). Creating a duplicate auth user for a known email would be a bug.
  select id into new_user from auth.users
   where lower(email) = clean_email and email_confirmed_at is not null limit 1;

  if new_user is null then
    new_user := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
      email_change, phone_change, phone_change_token, reauthentication_token
    ) values (
      new_user, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', clean_email, now(), now(), now(),
      md5(random()::text), md5(random()::text), md5(random()::text), md5(random()::text),
      '', '', md5(random()::text), md5(random()::text)
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), new_user, new_user,
            jsonb_build_object('sub', new_user::text, 'email', clean_email),
            'email', now(), now(), now());
  end if;

  insert into public.memberships (household_id, user_id, role)
  values (new_household, new_user, 'guardian')
  on conflict do nothing;

  insert into public.learners (household_id, preferred_name, grade_label, jurisdiction)
  values (new_household, clean_learner, clean_grade, btrim(learner_jurisdiction))
  returning id into new_learner;

  insert into public.service_cases (household_id, learner_id, package_code, status)
  values (new_household, new_learner, package_code, 'paid')
  returning id into new_case;

  -- The idempotency key. UNIQUE on external_checkout_id, so a replayed webhook cannot create a
  -- second household. Written here rather than waiting for the payment event, because the
  -- provisioning call is what must be protected against replay.
  insert into public.orders (household_id, external_checkout_id, package_code,
                             payment_status, currency, amount_cents)
  values (new_household, clean_checkout, package_code, 'pending', 'CAD', 0)
  on conflict (external_checkout_id) do nothing;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type,
                                   subject_id, metadata)
  values (new_household, null, 'household.provisioned', 'household', new_household,
          jsonb_build_object('checkoutId', clean_checkout, 'packageCode', package_code,
                             'learnerId', new_learner));

  return query select new_household, new_user, new_learner, new_case, true;
end $function$;

comment on function public.provision_household_from_checkout(text, text, text, text, text, text) is
  'Provisions household + guardian account + learner + case from a completed checkout. The missing front door: nothing in the product created a household, an account, a learner or a case.';

-- Server-side only. No browser session may call this.
revoke all on function public.provision_household_from_checkout(text, text, text, text, text, text)
  from public, anon, authenticated;
