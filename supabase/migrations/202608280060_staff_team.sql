-- 060: the staff team (issue #100).
--
-- WHY
--   Staff see a family only through a membership in that family's household. Signup (041) adds the
--   guardian and nobody else, so no educator or admin could see a new family's case or messages,
--   and a guardian's message had no one to go to.
--
-- WHAT CHANGES
--   1. staff_team: the people who work for BriteLink, each an educator or an admin, with an
--      educator's active-case limit. Sealed: no client can read or change it. The operator manages
--      it through the Staff workflow (scripts/staff-team.sh), which calls the functions in 3.
--   2. When a family's guardian membership is created, everyone on the staff team is added to that
--      household (and each educator gets a capacity row), so a new family is visible to staff at
--      once. A staff member who is also that family's guardian stays its guardian.
--   3. Operator-only functions: staff_team_add (also shares every existing family with the person),
--      staff_team_remove (refuses while the person still holds an open case), staff_team_list.
--   4. provision_beta_household looks only at the caller's guardian membership, so a staff member
--      who signs up as a parent gets their own family, never another family's household.

create table if not exists public.staff_team(
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.membership_role not null check (role in ('educator', 'admin')),
  max_active_cases integer not null default 10 check (max_active_cases between 0 and 100),
  added_at timestamptz not null default now()
);
alter table public.staff_team enable row level security;
revoke all on public.staff_team from public, anon, authenticated;
comment on table public.staff_team is
  'BriteLink staff shared into every family household (060). Operator-managed; no client access.';

-- 1 + 2 ------------------------------------------------------------------------------------------
-- Adds staff to a household. Only the given person when target_user is set, else the whole team.
-- An existing membership (for example a staff member who is this family's guardian) is kept.
create or replace function public.share_household_with_staff(target_household uuid, target_user uuid default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare added integer;
begin
  insert into public.memberships(household_id, user_id, role)
  select target_household, t.user_id, t.role
    from public.staff_team t
   where target_user is null or t.user_id = target_user
  on conflict (household_id, user_id) do nothing;
  get diagnostics added = row_count;

  insert into public.educator_capacities(household_id, educator_user_id, max_active_cases)
  select target_household, t.user_id, t.max_active_cases
    from public.staff_team t
    join public.memberships m on m.household_id = target_household and m.user_id = t.user_id and m.role = 'educator'
   where t.role = 'educator' and (target_user is null or t.user_id = target_user)
  on conflict (household_id, educator_user_id) do update set max_active_cases = excluded.max_active_cases, updated_at = now();
  return added;
end $$;
revoke all on function public.share_household_with_staff(uuid, uuid) from public, anon, authenticated;

create or replace function public.share_new_family_with_staff()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.share_household_with_staff(new.household_id);
  return new;
end $$;
revoke all on function public.share_new_family_with_staff() from public, anon, authenticated;

drop trigger if exists memberships_share_with_staff on public.memberships;
create trigger memberships_share_with_staff
  after insert on public.memberships
  for each row when (new.role = 'guardian')
  execute function public.share_new_family_with_staff();

-- 3 ----------------------------------------------------------------------------------------------
create or replace function public.staff_team_add(staff_email text, staff_role text, case_limit integer default 10)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  person uuid;
  current_role_name public.membership_role;
  households_shared integer := 0;
  h record;
begin
  if staff_role not in ('educator', 'admin') then
    raise exception 'role must be educator or admin' using errcode = '22023';
  end if;
  if case_limit is null or case_limit not between 0 and 100 then
    raise exception 'case limit must be 0-100' using errcode = '22023';
  end if;
  select u.id into person from auth.users u where lower(u.email) = lower(btrim(staff_email));
  if person is null then
    raise exception 'no BriteLink account with that email yet: invite them first' using errcode = 'P0002';
  end if;
  select t.role into current_role_name from public.staff_team t where t.user_id = person;
  if current_role_name is not null and current_role_name::text <> staff_role then
    raise exception 'already on the staff team as %; remove them first to change the role', current_role_name using errcode = '22023';
  end if;

  insert into public.staff_team(user_id, role, max_active_cases)
  values (person, staff_role::public.membership_role, case_limit)
  on conflict (user_id) do update set max_active_cases = excluded.max_active_cases;

  for h in select distinct m.household_id from public.memberships m where m.role = 'guardian' loop
    households_shared := households_shared + public.share_household_with_staff(h.household_id, person);
  end loop;
  return households_shared;
end $$;
revoke all on function public.staff_team_add(text, text, integer) from public, anon, authenticated;

create or replace function public.staff_team_remove(staff_email text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare person uuid; removed integer;
begin
  select t.user_id into person
    from public.staff_team t join auth.users u on u.id = t.user_id
   where lower(u.email) = lower(btrim(staff_email));
  if person is null then
    raise exception 'that email is not on the staff team' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.service_cases c
     where (c.assigned_educator_id = person or c.assigned_reviewer_id = person)
       and c.status not in ('closed', 'cancelled', 'refunded', 'chargeback')
  ) then
    raise exception 'they still hold open cases: reassign those first' using errcode = '55000';
  end if;
  delete from public.educator_capacities where educator_user_id = person;
  delete from public.memberships where user_id = person and role in ('educator', 'admin');
  get diagnostics removed = row_count;
  delete from public.staff_team where user_id = person;
  return removed;
end $$;
revoke all on function public.staff_team_remove(text) from public, anon, authenticated;

create or replace function public.staff_team_list()
returns table(email text, role public.membership_role, max_active_cases integer, families integer, added_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select u.email::text, t.role, t.max_active_cases,
         (select count(*)::integer from public.memberships m where m.user_id = t.user_id and m.role = t.role),
         t.added_at
    from public.staff_team t join auth.users u on u.id = t.user_id
   order by t.added_at;
$$;
revoke all on function public.staff_team_list() from public, anon, authenticated;

-- 4 ----------------------------------------------------------------------------------------------
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

revoke all on function public.provision_beta_household(text, text, text) from public, anon;
grant execute on function public.provision_beta_household(text, text, text) to authenticated;
