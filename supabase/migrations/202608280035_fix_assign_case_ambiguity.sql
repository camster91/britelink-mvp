-- 035: fix an ambiguity that makes staff_assign_case fail for every caller.
--
-- THE BUG
--   staff_assign_case RETURNS TABLE(case_id uuid, educator_user_id uuid, ...). The name
--   educator_user_id is therefore in scope as an output column. Its body then writes:
--
--       select max_active_cases into capacity_limit
--         from public.educator_capacities
--        where household_id = target_household
--          and educator_user_id = target_educator;
--
--   educator_capacities also has a column named educator_user_id, so the reference matches
--   both the output column and the table column. PL/pgSQL refuses to guess:
--
--       ERROR: 42702: column reference "educator_user_id" is ambiguous
--       DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
--   The assignment has never worked. It was unreachable: nothing could create a service_cases
--   row, so no caller ever got far enough to trip it. Migration 033 opened that path, and the
--   lifecycle walkthrough then hit this immediately.
--
-- THE FIX
--   Qualify the column with its table alias. One predicate, no behaviour change. The other
--   reads in this function already qualify their tables, which is why only this line failed.
--
-- WHY NOT RENAME THE OUTPUT COLUMN
--   The output shape is part of the function's contract; changing it would require DROP and
--   could break any caller. The defect is the unqualified reference, not the name.

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
     and ec.educator_user_id = target_educator;
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

comment on function public.staff_assign_case(uuid, uuid, uuid) is
  'Assigns an educator to a case. Fixed in migration 035: the capacity lookup referenced educator_user_id unqualified, which collided with the output column of the same name and made the function fail with 42702 for every caller.';
