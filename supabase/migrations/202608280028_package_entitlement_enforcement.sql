-- 202608280028_package_entitlement_enforcement.sql
-- Correctness review HIGH-1: the paid package contract was contradictory and
-- unenforced. PACKAGE_ENTITLEMENTS in src/service-domain.js said 8/16/40 weeks,
-- docs/END_TO_END_SHIP_PLAN.md sells 4/8/32 weeks, and the production authoring
-- path only enforced a generic 1..52 range. Staff could therefore author and
-- deliver a plan whose duration does not match the package the family paid for.
--
-- This migration makes the database the single source of truth for package
-- duration and enforces it at authoring time.
--
-- Read-only review artifact: this file has NOT been applied to any database.

-- Canonical package entitlements. The database owns this contract.
create table if not exists public.package_entitlements(
  package_code text primary key check (package_code in ('essentials','complete','annual')),
  plan_weeks integer not null check (plan_weeks between 1 and 52),
  included_revisions integer not null check (included_revisions between 0 and 20),
  sla_business_days integer not null check (sla_business_days between 1 and 30),
  updated_at timestamptz not null default now()
);

alter table public.package_entitlements enable row level security;

-- Readable by any authenticated user so the UI can display entitlements.
-- Writes are service/owner only (no write policy is defined).
drop policy if exists package_entitlements_read on public.package_entitlements;
create policy package_entitlements_read on public.package_entitlements
  for select using (auth.uid() is not null);

-- Seed the canonical values from the shipped product contract.
-- docs/END_TO_END_SHIP_PLAN.md sells 4 / 8 / 32 weeks. Keep code, docs, and
-- database aligned on this set; adjust here if the product decision changes.
insert into public.package_entitlements(package_code, plan_weeks, included_revisions, sla_business_days)
values
  ('essentials',  4, 0, 5),
  ('complete',    8, 1, 7),
  ('annual',     32, 4, 7)
on conflict (package_code) do update
  set plan_weeks = excluded.plan_weeks,
      included_revisions = excluded.included_revisions,
      sla_business_days = excluded.sla_business_days,
      updated_at = now();

-- Helper: the required plan length for a package.
create or replace function public.package_plan_weeks(target_package text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select pe.plan_weeks from public.package_entitlements pe where pe.package_code = target_package;
$$;

revoke all on function public.package_plan_weeks(text) from public;
grant execute on function public.package_plan_weeks(text) to authenticated, service_role;

-- Enforce the package length during staff authoring.
-- Replaces the generic 1..52 bound with the package-specific requirement.
create or replace function public.admin_save_plan_document(
  target_household uuid,
  target_case uuid,
  weeks_total integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  service_case public.service_cases%rowtype;
  required_weeks integer;
  new_plan_id uuid;
begin
  if not public.has_household_role(
    target_household, array['educator','admin']::public.membership_role[]
  ) then
    raise exception 'staff access required';
  end if;

  select * into service_case
  from public.service_cases
  where id = target_case and household_id = target_household
  for update;
  if not found then raise exception 'case not found'; end if;

  -- Resolve the package the family actually paid for, then require the plan to
  -- match it exactly.
  required_weeks := public.package_plan_weeks(service_case.package_code);
  if required_weeks is null then
    raise exception 'no entitlement defined for package %', service_case.package_code;
  end if;
  if weeks_total <> required_weeks then
    raise exception 'package % requires exactly % weeks, got %',
      service_case.package_code, required_weeks, weeks_total;
  end if;

  -- Existing authoring behaviour (placeholder for the real document write).
  select id into new_plan_id
  from public.plans
  where case_id = target_case
  order by created_at desc
  limit 1;

  return new_plan_id;
end $$;

revoke all on function public.admin_save_plan_document(uuid, uuid, integer) from public;
revoke all on function public.admin_save_plan_document(uuid, uuid, integer) from anon;
grant execute on function public.admin_save_plan_document(uuid, uuid, integer) to authenticated, service_role;

-- Regression assertion: the entitlement set must be non-empty and must expose
-- a required length for every sellable package.
do $$
declare missing text;
begin
  select string_agg(pkg, ', ')
  into missing
  from (values ('essentials'), ('complete'), ('annual')) as v(pkg)
  where not exists (
    select 1 from public.package_entitlements pe where pe.package_code = v.pkg
  );

  if missing is not null then
    raise exception 'package entitlements missing for: %', missing;
  end if;
end $$;
