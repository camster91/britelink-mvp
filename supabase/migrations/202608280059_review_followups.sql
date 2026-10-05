-- 059: remaining items from the 2026-10-02 full-app review (#101).
--
-- 1. Families keep seeing plan versions they were given. A revision archives the old published plan,
--    and guardians could read only 'published' plans, so lessons finished on an earlier version
--    vanished from the weekly story and the learning report. Guardians can now read 'archived'
--    plans too (read-only; only previously published plans are ever archived, by
--    staff_transition_case and staff_complete_revision). The household export already includes
--    them (054). Drafts and internal-review plans stay staff-only.
--
-- 2. A case paused by a consent withdrawal can be closed. on_hold had no path to 'closed', so such a
--    case never reached retention (admin_retention_candidates looks at closed cases).
--    staff_close_held_case lets an admin close an on_hold case with a reason, audited.
--
-- 3. Assignment capacity cannot be overrun by two assignments at once: staff_assign_case now locks
--    the educator's capacity row before counting.

-- 1 ---------------------------------------------------------------------------------------------
drop policy if exists plans_member_select on public.plans;
create policy plans_member_select on public.plans for select using (
  public.is_household_member(household_id)
  and (status in ('published', 'archived')
       or public.has_household_role(household_id, array['educator','admin']::public.membership_role[]))
);

create or replace function public.can_read_plan(target_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = target_plan
      and public.is_household_member(p.household_id)
      and (
        p.status in ('published', 'archived')
        or public.has_household_role(
             p.household_id,
             array['educator','admin']::public.membership_role[]
           )
      )
  );
$$;
revoke all on function public.can_read_plan(uuid) from public;
grant execute on function public.can_read_plan(uuid) to authenticated;

-- 2 ---------------------------------------------------------------------------------------------
create or replace function public.staff_close_held_case(target_household uuid, target_case uuid, close_reason text)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare closed_time timestamptz := now(); held public.service_cases%rowtype;
begin
  if not public.has_household_role(target_household, array['admin']::public.membership_role[]) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(close_reason, ''))) not between 1 and 500 then
    raise exception 'a reason for closing is required' using errcode = '22023';
  end if;
  select * into held from public.service_cases where id = target_case and household_id = target_household for update;
  if not found then raise exception 'case not found'; end if;
  if held.status <> 'on_hold' then raise exception 'only a case on hold can be closed this way'; end if;
  update public.service_cases
     set status = 'closed', previous_operational_status = held.status, status_reason = btrim(close_reason),
         assigned_educator_id = null, closed_at = closed_time, updated_at = closed_time
   where id = target_case;
  insert into public.audit_events(household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'case.closed_from_hold', 'service_case', target_case,
          jsonb_build_object('reason', btrim(close_reason)));
  return closed_time;
end $$;
revoke all on function public.staff_close_held_case(uuid, uuid, text) from public, anon;
grant execute on function public.staff_close_held_case(uuid, uuid, text) to authenticated;

-- 3 ---------------------------------------------------------------------------------------------
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

  -- THE FIX: alias the table so the reference cannot collide with the output column.
  select ec.max_active_cases into capacity_limit
    from public.educator_capacities ec
   where ec.household_id = target_household
     and ec.educator_user_id = target_educator
   -- 059: lock the educator's capacity row, so two assignments at the same moment are counted
   -- one after the other and cannot both pass the limit.
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

