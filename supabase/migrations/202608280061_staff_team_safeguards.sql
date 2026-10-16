-- 061: staff team safeguards (review follow-up to 060).
--
-- WHY
--   A review of 060 before it reached production found four gaps:
--   - staff_team_add bound a person by email alone. With an auth stack that auto-confirms emails,
--     anyone could register a future staff member's address first and be made staff.
--   - Every educator joined every family. One phished educator login could then read every
--     child's plans, messages and learning notes. Owner decision (2026-10-15): educators see only
--     the families they are assigned to; admins still see every family, because they triage new
--     cases and assign them.
--   - A calendar link stayed live after the person who made it left the household, so a removed
--     staff member could keep reading a child's schedule.
--   - staff_team_remove could race a family signing up at the same moment and leave the removed
--     person in that new family.
--
-- WHAT CHANGES
--   1. staff_team_add requires a confirmed email. An admin is shared into every family. An
--      educator gets only a case-limit row in each family, which puts them in the admin's
--      "assign" list without letting them read anything.
--   2. A new family is shared with every admin on the team, and gets a case-limit row for every
--      educator on it.
--   3. staff_assign_case adds a staff-team educator to the family at the moment an admin assigns
--      them a case there.
--   4. staff_team_remove locks the team row first, so a family signing up at the same moment
--      either sees the person gone or has them removed with everyone else.
--   5. Leaving a household revokes the calendar links that person made in it.
--   6. Staff can see an unassigned educator's display name (for the assign list), and an
--      educator can set their name before their first family.
--   7. my_staff_profile(): the signed-in person's own staff role and name, so the app can tell an educator
--      waiting for a first family apart from a new parent.
--   8. Clean-up for a database where 060 already ran: an educator keeps a family only where they
--      hold or wrote for a case there, and links made by people who already left are revoked.
--
-- RERUNNABLE: create or replace, drop if exists, and idempotent updates and deletes only.

-- 1 + 2 ------------------------------------------------------------------------------------------
-- Adds staff to a household. With target_user: that person (any staff role), as a member, with an
-- educator's case limit. Without: every admin as a member, and a case-limit row for every educator.
create or replace function public.share_household_with_staff(target_household uuid, target_user uuid default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare added integer;
begin
  -- Hold the team rows this reads until commit. staff_team_remove locks a row before it removes
  -- the person's memberships, so the two cannot interleave (see 4).
  perform 1 from public.staff_team t
   where target_user is null or t.user_id = target_user
   for share;

  insert into public.memberships(household_id, user_id, role)
  select target_household, t.user_id, t.role
    from public.staff_team t
   where (target_user is null and t.role = 'admin') or t.user_id = target_user
  on conflict (household_id, user_id) do nothing;
  get diagnostics added = row_count;

  insert into public.educator_capacities(household_id, educator_user_id, max_active_cases)
  select target_household, t.user_id, t.max_active_cases
    from public.staff_team t
   where t.role = 'educator' and (target_user is null or t.user_id = target_user)
     -- Not for a staff educator who is this family's own guardian: they cannot be its educator.
     and not exists (
       select 1 from public.memberships m
        where m.household_id = target_household and m.user_id = t.user_id and m.role <> 'educator'
     )
  on conflict (household_id, educator_user_id) do update set max_active_cases = excluded.max_active_cases, updated_at = now();
  return added;
end $$;
revoke all on function public.share_household_with_staff(uuid, uuid) from public, anon, authenticated;

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
  -- 061: an account counts only once its owner has opened a sign-in link sent to that address.
  if not exists (select 1 from auth.users u where u.id = person and u.email_confirmed_at is not null) then
    raise exception 'that account has not confirmed its email yet: ask them to sign in once first' using errcode = '42501';
  end if;
  select t.role into current_role_name from public.staff_team t where t.user_id = person;
  if current_role_name is not null and current_role_name::text <> staff_role then
    raise exception 'already on the staff team as %; remove them first to change the role', current_role_name using errcode = '22023';
  end if;

  insert into public.staff_team(user_id, role, max_active_cases)
  values (person, staff_role::public.membership_role, case_limit)
  on conflict (user_id) do update set max_active_cases = excluded.max_active_cases;

  if staff_role = 'admin' then
    for h in select distinct m.household_id from public.memberships m where m.role = 'guardian' loop
      households_shared := households_shared + public.share_household_with_staff(h.household_id, person);
    end loop;
  else
    -- An educator is not shared into any family here, only made assignable in each one (3).
    insert into public.educator_capacities(household_id, educator_user_id, max_active_cases)
    select distinct g.household_id, person, case_limit
      from public.memberships g
     where g.role = 'guardian'
       and not exists (
         select 1 from public.memberships m
          where m.household_id = g.household_id and m.user_id = person and m.role <> 'educator'
       )
    on conflict (household_id, educator_user_id) do update set max_active_cases = excluded.max_active_cases, updated_at = now();
  end if;
  return households_shared;
end $$;
revoke all on function public.staff_team_add(text, text, integer) from public, anon, authenticated;

-- 3 ----------------------------------------------------------------------------------------------
-- 059's staff_assign_case, plus: a staff-team educator becomes a member of the family when an
-- admin assigns them a case there. Everything else is unchanged.
create or replace function public.staff_assign_case(
  target_household uuid,
  target_case uuid,
  target_educator uuid
)
returns table(
  case_id uuid,
  educator_user_id uuid,
  current_status public.case_status,
  updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $function$
declare
  service_case public.service_cases%rowtype;
  capacity_limit integer;
  active_count integer;
begin
  if not public.has_household_role(target_household, array['admin']::public.membership_role[]) then
    raise exception 'admin access required';
  end if;
  -- 061: join a staff-team educator to this family now, unless they already belong to it in
  -- another role (a staff member who is this family's guardian cannot be its educator).
  if exists (select 1 from public.staff_team t where t.user_id = target_educator and t.role = 'educator')
     and not exists (select 1 from public.memberships m where m.household_id = target_household and m.user_id = target_educator) then
    perform public.share_household_with_staff(target_household, target_educator);
  end if;
  if not exists (
    select 1 from public.memberships
     where household_id = target_household and user_id = target_educator and role = 'educator'
  ) then
    raise exception 'assignee must be an educator in this household';
  end if;

  select * into service_case
    from public.service_cases
   where id = target_case and household_id = target_household
   for update;
  if not found then
    raise exception 'case not found';
  end if;
  if service_case.status not in ('triage','assigned','on_hold') then
    raise exception 'case is not assignable';
  end if;

  select ec.max_active_cases into capacity_limit
    from public.educator_capacities ec
   where ec.household_id = target_household
     and ec.educator_user_id = target_educator
   for update;
  if capacity_limit is null then
    raise exception 'educator capacity is not configured';
  end if;

  select count(*) into active_count
    from public.service_cases sc
   where sc.household_id = target_household
     and sc.assigned_educator_id = target_educator
     and sc.status in ('assigned','drafting','internal_review')
     and sc.id <> target_case;
  if active_count >= capacity_limit then
    raise exception 'educator has reached active case capacity';
  end if;

  update public.service_cases
     set assigned_educator_id = target_educator,
         status = 'assigned',
         updated_at = now()
   where id = target_case;

  insert into public.audit_events(
    household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'case.assigned', 'service_case', target_case,
          jsonb_build_object('educatorUserId', target_educator));

  return query select target_case, target_educator, 'assigned'::public.case_status, now();
end $function$;
revoke all on function public.staff_assign_case(uuid, uuid, uuid) from public, anon;
grant execute on function public.staff_assign_case(uuid, uuid, uuid) to authenticated;

-- 4 ----------------------------------------------------------------------------------------------
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
  -- 061: lock first. A family signing up now waits for this to finish and then no longer sees
  -- the person; one that got here first has finished, and its membership is deleted below.
  perform 1 from public.staff_team t where t.user_id = person for update;
  if exists (
    select 1 from public.service_cases c
     where (c.assigned_educator_id = person or c.assigned_reviewer_id = person)
       and c.status not in ('closed', 'cancelled', 'refunded', 'chargeback')
  ) then
    raise exception 'they still hold open cases: reassign those first' using errcode = '55000';
  end if;
  delete from public.educator_capacities where educator_user_id = person;
  -- Their calendar links in these families are revoked by the trigger in 5.
  delete from public.memberships where user_id = person and role in ('educator', 'admin');
  get diagnostics removed = row_count;
  delete from public.staff_team where user_id = person;
  return removed;
end $$;
revoke all on function public.staff_team_remove(text) from public, anon, authenticated;

-- 5 ----------------------------------------------------------------------------------------------
create or replace function public.revoke_departed_member_feeds()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- An erased household takes its links with it (on delete cascade); nothing to revoke.
  if not exists (select 1 from public.households h where h.id = old.household_id) then
    return old;
  end if;
  update public.calendar_feeds
     set revoked_at = now()
   where household_id = old.household_id and created_by = old.user_id and revoked_at is null;
  return old;
end $$;
revoke all on function public.revoke_departed_member_feeds() from public, anon, authenticated;

drop trigger if exists memberships_revoke_departed_feeds on public.memberships;
create trigger memberships_revoke_departed_feeds
  after delete on public.memberships
  for each row execute function public.revoke_departed_member_feeds();

-- 6 ----------------------------------------------------------------------------------------------
-- 057's policy, plus: a name is visible to staff of a family where that person can be assigned.
drop policy if exists staff_display_names_select on public.staff_display_names;
create policy staff_display_names_select on public.staff_display_names
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.user_id = staff_display_names.user_id
        and public.has_household_role(m.household_id, array['educator','admin']::public.membership_role[])
    )
    or exists (
      select 1 from public.educator_capacities ec
      where ec.educator_user_id = staff_display_names.user_id
        and public.has_household_role(ec.household_id, array['educator','admin']::public.membership_role[])
    )
  );

create or replace function public.set_staff_display_name(new_name text)
returns text
language plpgsql security definer set search_path = public
as $$
declare clean text := btrim(coalesce(new_name, ''));
begin
  if auth.uid() is null or not (
    exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.role in ('educator', 'admin'))
    -- 061: an educator waiting for a first family can set their name too.
    or exists (select 1 from public.staff_team t where t.user_id = auth.uid())
  ) then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 80 then
    raise exception 'name must be 1 to 80 characters' using errcode = '22023';
  end if;
  insert into public.staff_display_names(user_id, display_name, updated_at)
  values (auth.uid(), clean, now())
  on conflict (user_id) do update set display_name = excluded.display_name, updated_at = excluded.updated_at;
  return clean;
end $$;
revoke all on function public.set_staff_display_name(text) from public, anon;
grant execute on function public.set_staff_display_name(text) to authenticated;

-- 7 ----------------------------------------------------------------------------------------------
-- Only ever answers about the caller: no row when they are not on the team.
create or replace function public.my_staff_profile()
returns table(role text, display_name text)
language sql stable security definer set search_path = public
as $$
  select t.role::text, n.display_name
    from public.staff_team t
    left join public.staff_display_names n on n.user_id = t.user_id
   where t.user_id = auth.uid();
$$;
revoke all on function public.my_staff_profile() from public, anon;
grant execute on function public.my_staff_profile() to authenticated;

-- 8 ----------------------------------------------------------------------------------------------
-- A no-op on a database where 060 has not run yet, or where nobody is on the team.
insert into public.educator_capacities(household_id, educator_user_id, max_active_cases)
select m.household_id, m.user_id, t.max_active_cases
  from public.memberships m join public.staff_team t on t.user_id = m.user_id and t.role = 'educator'
 where m.role = 'educator'
on conflict (household_id, educator_user_id) do nothing;

delete from public.memberships m
 using public.staff_team t
 where t.user_id = m.user_id and t.role = 'educator' and m.role = 'educator'
   and not exists (
     select 1 from public.service_cases c
      where c.household_id = m.household_id
        and (c.assigned_educator_id = m.user_id or c.assigned_reviewer_id = m.user_id)
   )
   and not exists (
     select 1 from public.plans p where p.household_id = m.household_id and p.authored_by = m.user_id
   );

update public.calendar_feeds f
   set revoked_at = now()
 where f.revoked_at is null
   and not exists (
     select 1 from public.memberships m where m.household_id = f.household_id and m.user_id = f.created_by
   );
