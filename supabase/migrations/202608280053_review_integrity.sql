-- 053: integrity fixes from the 2026-10-01 correctness review.
--
-- 1. Co-guardians can update each other's lesson progress.
--    activities_guardian_update (031) put `updated_by = auth.uid()` in USING, which is tested
--    against the EXISTING row: once guardian A touched a lesson, guardian B (or the admin) could
--    never mark it done ("new row violates row-level security policy (USING expression)").
--    USING now only requires a guardian/admin role in the row's household; WITH CHECK still
--    requires the writer to stamp themselves as updated_by.
--
-- 2. A case can only be "delivered" when a delivery was actually sent.
--    staff_transition_case (006) allowed published/revised/overdue -> delivered without any
--    deliveries row, which left the guardian unable to acknowledge (that needs a sent delivery)
--    and staff unable to record one (the case was no longer published/revised). The trigger
--    below requires a sent or acknowledged delivery of the case's current published plan for any
--    move INTO 'delivered'. staff_record_delivery inserts its delivery before it updates the
--    case, so the real delivery path is unaffected.
--
-- 3. An approved plan cannot change, and only a currently approved plan can be published.
--    Resources could be added after the independent reviewer approved (staff_add_plan_resource
--    accepts plans still in internal_review), and publication only checked that SOME approved
--    review existed, so a later failed review did not block it. Now:
--      - resources cannot be added to, or changed on, a plan that has an approved review;
--      - a resource's substitute must be another resource on the same plan;
--      - a plan can only become 'published' when its latest review is an approval with every
--        check ticked. This covers both publication paths (staff_transition_case and
--        staff_complete_revision) without rewriting them.

-- 1 ---------------------------------------------------------------------------------------------
drop policy if exists activities_guardian_update on public.lesson_activities;
create policy activities_guardian_update on public.lesson_activities
  for update
  using (
    public.has_household_role(household_id, array['guardian','admin']::public.membership_role[])
  )
  with check (
    public.has_household_role(household_id, array['guardian','admin']::public.membership_role[])
    and updated_by = auth.uid()
  );

-- 2 ---------------------------------------------------------------------------------------------
create or replace function public.enforce_case_delivery()
returns trigger
language plpgsql set search_path = public
as $function$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and not exists (
    select 1 from public.deliveries d join public.plans p on p.id = d.plan_id
    where d.case_id = new.id and p.status = 'published' and d.status in ('sent', 'acknowledged')
  ) then
    raise exception 'record the delivery of the published plan first';
  end if;
  return new;
end $function$;
revoke all on function public.enforce_case_delivery() from public, anon, authenticated;

drop trigger if exists service_cases_require_delivery on public.service_cases;
create trigger service_cases_require_delivery
  before update of status on public.service_cases
  for each row execute function public.enforce_case_delivery();

-- 3 ---------------------------------------------------------------------------------------------
create or replace function public.enforce_resource_review_freeze()
returns trigger
language plpgsql set search_path = public
as $function$
begin
  if exists (select 1 from public.plan_reviews r where r.plan_id = new.plan_id and r.approved_at is not null) then
    raise exception 'this plan has been approved; resources can no longer change';
  end if;
  if tg_op = 'UPDATE' and old.plan_id is distinct from new.plan_id
     and exists (select 1 from public.plan_reviews r where r.plan_id = old.plan_id and r.approved_at is not null) then
    raise exception 'this plan has been approved; resources can no longer change';
  end if;
  if new.substitute_resource_id is not null and not exists (
    select 1 from public.resources s
    where s.id = new.substitute_resource_id and s.plan_id = new.plan_id
      and s.household_id = new.household_id and s.id <> new.id
  ) then
    raise exception 'substitute resource must be another resource on the same plan';
  end if;
  return new;
end $function$;
revoke all on function public.enforce_resource_review_freeze() from public, anon, authenticated;

drop trigger if exists resources_review_freeze on public.resources;
create trigger resources_review_freeze
  before insert or update on public.resources
  for each row execute function public.enforce_resource_review_freeze();

create or replace function public.enforce_publication_review()
returns trigger
language plpgsql set search_path = public
as $function$
declare latest public.plan_reviews%rowtype;
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    select * into latest from public.plan_reviews r
    where r.plan_id = new.id
    order by r.created_at desc, r.id desc
    limit 1;
    if not found or latest.approved_at is null or not (latest.curriculum_checked and latest.safeguarding_checked
       and latest.accessibility_checked and latest.resource_rights_checked) then
      raise exception 'the latest internal review of this plan must be an approval';
    end if;
  end if;
  return new;
end $function$;
revoke all on function public.enforce_publication_review() from public, anon, authenticated;

drop trigger if exists plans_require_current_approval on public.plans;
create trigger plans_require_current_approval
  before update of status on public.plans
  for each row execute function public.enforce_publication_review();
