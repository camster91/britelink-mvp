-- BriteLink private-beta core schema.
-- Apply only after environment-specific review, backup policy, and consent language are approved.
create extension if not exists pgcrypto;

create type public.membership_role as enum ('guardian', 'educator', 'admin');
create type public.case_status as enum ('paid', 'intake_pending', 'submitted', 'triage', 'clarification', 'assigned', 'drafting', 'internal_review', 'published', 'delivered', 'acknowledged', 'revision_requested', 'revised', 'closed', 'on_hold', 'overdue', 'cancelled', 'refunded', 'chargeback');
create type public.lesson_activity_status as enum ('not_started', 'in_progress', 'paused', 'completed', 'skipped', 'rescheduled');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.memberships (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.learners (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  preferred_name text not null check (char_length(preferred_name) between 1 and 80),
  grade_label text not null,
  jurisdiction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.guardian_consents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  learner_id uuid not null references public.learners(id) on delete cascade,
  guardian_user_id uuid not null references auth.users(id),
  notice_version text not null,
  purposes text[] not null,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table public.learner_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  learner_id uuid not null references public.learners(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  planning_context jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (learner_id, version)
);

create table public.service_cases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  learner_id uuid not null references public.learners(id),
  package_code text not null check (package_code in ('essentials', 'complete', 'annual')),
  status public.case_status not null default 'paid',
  assigned_educator_id uuid references auth.users(id),
  intake_received_at timestamptz,
  sla_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  learner_id uuid not null references public.learners(id),
  version integer not null default 1,
  status text not null check (status in ('draft', 'internal_review', 'published', 'archived')),
  authored_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (case_id, version)
);

create table public.plan_weeks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 52),
  theme text not null,
  unique (plan_id, week_number)
);

create table public.plan_days (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_id uuid not null references public.plan_weeks(id) on delete cascade,
  day_number integer not null check (day_number between 1 and 7),
  planned_date date,
  unique (week_id, day_number)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  day_id uuid not null references public.plan_days(id) on delete cascade,
  position integer not null check (position > 0),
  subject text not null,
  title text not null,
  objective text not null,
  instructions jsonb not null,
  materials jsonb not null default '[]'::jsonb,
  accommodations jsonb not null default '[]'::jsonb,
  adult_help_minutes integer check (adult_help_minutes >= 0),
  unique (day_id, position)
);

create table public.lesson_activities (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  learner_id uuid not null references public.learners(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  status public.lesson_activity_status not null default 'not_started',
  caregiver_note text check (char_length(caregiver_note) <= 2000),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (learner_id, lesson_id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  subject_type text not null,
  subject_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.memberships m where m.household_id = target_household and m.user_id = auth.uid()) $$;

create or replace function public.has_household_role(target_household uuid, allowed public.membership_role[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.memberships m where m.household_id = target_household and m.user_id = auth.uid() and m.role = any(allowed)) $$;

alter table public.households enable row level security;
alter table public.memberships enable row level security;
alter table public.learners enable row level security;
alter table public.guardian_consents enable row level security;
alter table public.learner_profiles enable row level security;
alter table public.service_cases enable row level security;
alter table public.plans enable row level security;
alter table public.plan_weeks enable row level security;
alter table public.plan_days enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_activities enable row level security;
alter table public.audit_events enable row level security;

create policy households_select on public.households for select using (public.is_household_member(id));
create policy memberships_select on public.memberships for select using (public.is_household_member(household_id));
create policy learners_select on public.learners for select using (public.is_household_member(household_id));
create policy learners_guardian_write on public.learners for all using (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]));
create policy consents_guardian_access on public.guardian_consents for all using (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]));
create policy profiles_member_select on public.learner_profiles for select using (public.is_household_member(household_id));
create policy profiles_guardian_write on public.learner_profiles for insert with check (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]));
create policy cases_member_select on public.service_cases for select using (public.is_household_member(household_id));
create policy cases_staff_write on public.service_cases for all using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy plans_member_select on public.plans for select using (public.is_household_member(household_id) and (status = 'published' or public.has_household_role(household_id, array['educator','admin']::public.membership_role[])));
create policy plans_staff_write on public.plans for all using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy weeks_member_select on public.plan_weeks for select using (public.is_household_member(household_id));
create policy weeks_staff_write on public.plan_weeks for all using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy days_member_select on public.plan_days for select using (public.is_household_member(household_id));
create policy days_staff_write on public.plan_days for all using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy lessons_member_select on public.lessons for select using (public.is_household_member(household_id));
create policy lessons_staff_write on public.lessons for all using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));
create policy activities_member_select on public.lesson_activities for select using (public.is_household_member(household_id));
create policy activities_guardian_write on public.lesson_activities for all using (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[])) with check (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]) and updated_by = auth.uid());
create policy audits_admin_select on public.audit_events for select using (public.has_household_role(household_id, array['admin']::public.membership_role[]));

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.has_household_role(uuid, public.membership_role[]) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.has_household_role(uuid, public.membership_role[]) to authenticated;
