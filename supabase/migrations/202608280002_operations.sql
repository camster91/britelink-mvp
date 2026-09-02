-- Paid-case, educator review, delivery, messaging, revision, and resource governance.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  external_checkout_id text unique,
  package_code text not null check (package_code in ('essentials', 'complete', 'annual')),
  payment_status text not null check (payment_status in ('pending', 'paid', 'refunded', 'chargeback')),
  currency text not null default 'CAD',
  amount_cents integer not null check (amount_cents >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.service_cases add column order_id uuid references public.orders(id);
alter table public.service_cases add column assigned_reviewer_id uuid references auth.users(id);
alter table public.service_cases add column acknowledged_at timestamptz;
alter table public.service_cases add column closed_at timestamptz;

create table public.educator_capacities (
  household_id uuid not null references public.households(id) on delete cascade,
  educator_user_id uuid not null references auth.users(id) on delete cascade,
  max_active_cases integer not null check (max_active_cases between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (household_id, educator_user_id)
);

create table public.case_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id),
  kind text not null default 'general' check (kind in ('general', 'clarification', 'revision', 'service')),
  body text not null check (char_length(body) between 1 and 4000),
  response_owner_user_id uuid references auth.users(id),
  response_due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.plan_reviews (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id),
  curriculum_checked boolean not null default false,
  safeguarding_checked boolean not null default false,
  accessibility_checked boolean not null default false,
  resource_rights_checked boolean not null default false,
  notes text check (char_length(notes) <= 4000),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.case_message_reads (
  household_id uuid not null references public.households(id) on delete cascade,
  message_id uuid not null references public.case_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  title text not null,
  url text,
  requirement text not null check (requirement in ('required', 'optional', 'substitute')),
  access_type text not null check (access_type in ('free', 'paid', 'library', 'household')),
  estimated_cost_cents integer check (estimated_cost_cents >= 0),
  region text,
  edition text,
  account_required boolean not null default false,
  ads_present boolean not null default false,
  privacy_reviewed_at timestamptz,
  rights_reviewed_at timestamptz,
  link_checked_at timestamptz,
  attribution text,
  substitute_resource_id uuid references public.resources(id),
  check (access_type <> 'paid' or estimated_cost_cents is not null)
);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  plan_version integer not null,
  channel text not null check (channel in ('secure_portal', 'email_notice')),
  status text not null check (status in ('queued', 'sent', 'failed', 'bounced', 'acknowledged')),
  attempt_count integer not null default 0,
  last_error_code text,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  reason text not null check (char_length(reason) between 1 and 2000),
  entitlement_index integer not null check (entitlement_index > 0),
  status text not null check (status in ('requested', 'accepted', 'declined', 'completed')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  disposition_reason text,
  completed_plan_id uuid references public.plans(id),
  change_summary text check (char_length(change_summary) <= 4000),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.orders enable row level security;
alter table public.educator_capacities enable row level security;
alter table public.case_messages enable row level security;
alter table public.case_message_reads enable row level security;
alter table public.plan_reviews enable row level security;
alter table public.resources enable row level security;
alter table public.deliveries enable row level security;
alter table public.revision_requests enable row level security;

create policy orders_guardian_select on public.orders for select using (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]));
create policy orders_admin_write on public.orders for all using (public.has_household_role(household_id, array['admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['admin']::public.membership_role[]));
create policy educator_capacities_staff_select on public.educator_capacities for select using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy educator_capacities_admin_write on public.educator_capacities for all using (public.has_household_role(household_id, array['admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['admin']::public.membership_role[]));
create policy messages_member_select on public.case_messages for select using (public.is_household_member(household_id));
create policy messages_member_insert on public.case_messages for insert with check (public.is_household_member(household_id) and sender_user_id = auth.uid());
create policy message_reads_member_select on public.case_message_reads for select using (public.is_household_member(household_id));
create policy message_reads_self_insert on public.case_message_reads for insert with check (public.is_household_member(household_id) and user_id = auth.uid());
create policy message_reads_self_update on public.case_message_reads for update using (user_id = auth.uid() and public.is_household_member(household_id)) with check (user_id = auth.uid() and public.is_household_member(household_id));
create policy reviews_staff_access on public.plan_reviews for all using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy resources_member_select on public.resources for select using (public.is_household_member(household_id));
create policy resources_staff_write on public.resources for all using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy deliveries_member_select on public.deliveries for select using (public.is_household_member(household_id));
create policy deliveries_staff_write on public.deliveries for all using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy revisions_member_select on public.revision_requests for select using (public.is_household_member(household_id));
create policy revisions_guardian_insert on public.revision_requests for insert with check (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]) and requested_by = auth.uid());
create policy revisions_staff_update on public.revision_requests for update using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));

create index case_messages_case_created_idx on public.case_messages(case_id, created_at);
create index case_messages_owner_due_idx on public.case_messages(response_owner_user_id, response_due_at) where resolved_at is null;
create index case_message_reads_user_idx on public.case_message_reads(user_id, read_at);
create index service_cases_status_due_idx on public.service_cases(status, sla_due_at);
create index audit_events_household_created_idx on public.audit_events(household_id, created_at);
create index deliveries_case_created_idx on public.deliveries(case_id, created_at);
create index resources_plan_idx on public.resources(plan_id);
