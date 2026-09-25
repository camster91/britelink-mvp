-- 049: one activity, several learners, a different expected outcome for each (#45).
--
-- WHY
--   Multi-child families teach together: one nature walk, one read-aloud, one baking session, with
--   a seven-year-old and an eleven-year-old each expected to get something different out of it.
--   Per-learner plans cannot say that, so families either duplicate the activity or skip it.
--
-- MODEL
--   shared_activities           the activity itself, authored by an educator (or admin) for a household.
--   shared_activity_learners    one row per learner: that learner's expected outcome, an optional
--                               per-learner date (a "split" from the shared date), and completion.
--
--   Single-household by construction: the learner row carries household_id and has composite
--   foreign keys to BOTH (shared_activities.household_id, id) and (learners.household_id, id). A row
--   joining household A's activity to household B's learner cannot satisfy both keys, whoever
--   inserts it -- including a SECURITY DEFINER function with a bug.
--
--   Rescheduling moves the activity for everyone (and clears splits). Moving it for one learner
--   stores that learner's own date: the split. Guardians move and mark done per learner; staff author
--   and remove. Every member reads.

create table public.shared_activities (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  subjects text[] not null default array[]::text[],
  scheduled_for date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint shared_activities_household_id_key unique (household_id, id),
  constraint shared_activities_subjects_valid check (
    cardinality(subjects) <= 7
    and subjects <@ array['Language','Math','Science','Social studies','French','Arts','Health and physical education']::text[]
  )
);

create table public.shared_activity_learners (
  activity_id uuid not null,
  household_id uuid not null,
  learner_id uuid not null,
  outcome text not null check (char_length(outcome) between 1 and 500),
  scheduled_for date,
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (activity_id, learner_id),
  foreign key (household_id, activity_id) references public.shared_activities(household_id, id) on delete cascade,
  foreign key (household_id, learner_id) references public.learners(household_id, id) on delete cascade
);

create index shared_activities_household_date_idx on public.shared_activities (household_id, scheduled_for);
create index shared_activity_learners_learner_idx on public.shared_activity_learners (learner_id);

alter table public.shared_activities enable row level security;
alter table public.shared_activity_learners enable row level security;

create policy shared_activities_member_select on public.shared_activities
  for select using (public.is_household_member(household_id));
create policy shared_activity_learners_member_select on public.shared_activity_learners
  for select using (public.is_household_member(household_id));

revoke all on table public.shared_activities from public, anon, authenticated;
revoke all on table public.shared_activity_learners from public, anon, authenticated;
grant select on table public.shared_activities to authenticated;
grant select on table public.shared_activity_learners to authenticated;

-- learner_outcomes: [{"learnerId": uuid, "outcome": text}, ...] -- at least two distinct learners
-- (one learner is an ordinary lesson), at most twelve.
create or replace function public.staff_create_shared_activity(
  target_household uuid,
  activity_title text,
  activity_description text,
  activity_subjects text[],
  activity_date date,
  learner_outcomes jsonb
)
returns table(activity_id uuid, learner_count integer, created_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare
  clean_subjects text[];
  new_id uuid;
  item jsonb;
  learner uuid;
  outcome_text text;
  seen uuid[] := array[]::uuid[];
begin
  if not public.has_household_role(target_household, array['educator','admin']::public.membership_role[]) then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  if activity_title is null or char_length(btrim(activity_title)) not between 1 and 200 then
    raise exception 'activity title is required and must be at most 200 characters' using errcode = '22023';
  end if;
  if activity_description is not null and char_length(activity_description) > 2000 then
    raise exception 'activity description must be at most 2000 characters' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct s order by s), array[]::text[]) into clean_subjects
    from unnest(coalesce(activity_subjects, array[]::text[])) as s;
  if not clean_subjects <@ array['Language','Math','Science','Social studies','French','Arts','Health and physical education']::text[] then
    raise exception 'subject is invalid' using errcode = '22023';
  end if;
  if activity_date is not null and (activity_date < current_date - 366 or activity_date > current_date + 366) then
    raise exception 'activity date is out of range' using errcode = '22023';
  end if;
  if jsonb_typeof(learner_outcomes) is distinct from 'array'
     or jsonb_array_length(learner_outcomes) not between 2 and 12 then
    raise exception 'a shared activity needs between 2 and 12 learners' using errcode = '22023';
  end if;

  insert into public.shared_activities (household_id, title, description, subjects, scheduled_for, created_by)
  values (target_household, btrim(activity_title), nullif(btrim(coalesce(activity_description, '')), ''),
          clean_subjects, activity_date, auth.uid())
  returning id into new_id;

  for item in select value from jsonb_array_elements(learner_outcomes) loop
    begin
      learner := (item->>'learnerId')::uuid;
    exception when invalid_text_representation then
      learner := null;
    end;
    outcome_text := btrim(coalesce(item->>'outcome', ''));
    if learner is null or not exists (
      select 1 from public.learners l where l.id = learner and l.household_id = target_household and l.deleted_at is null
    ) then
      raise exception 'learner not found in household' using errcode = '42501';
    end if;
    if learner = any(seen) then
      raise exception 'each learner can appear once' using errcode = '22023';
    end if;
    if char_length(outcome_text) not between 1 and 500 then
      raise exception 'each learner needs an expected outcome of at most 500 characters' using errcode = '22023';
    end if;
    seen := seen || learner;
    insert into public.shared_activity_learners (activity_id, household_id, learner_id, outcome)
    values (new_id, target_household, learner, outcome_text);
  end loop;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'shared_activity.created', 'shared_activity', new_id,
          jsonb_build_object('learners', to_jsonb(seen), 'subjects', to_jsonb(clean_subjects)));

  return query select a.id, cardinality(seen), a.created_at from public.shared_activities a where a.id = new_id;
end $function$;

create or replace function public.staff_remove_shared_activity(target_household uuid, target_shared_activity uuid)
returns timestamptz
language plpgsql security definer set search_path = public
as $function$
declare removed timestamptz;
begin
  if not public.has_household_role(target_household, array['educator','admin']::public.membership_role[]) then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  update public.shared_activities set removed_at = now(), updated_at = now()
   where id = target_shared_activity and household_id = target_household and removed_at is null
  returning removed_at into removed;
  if removed is null then
    raise exception 'shared activity not found' using errcode = '42501';
  end if;
  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'shared_activity.removed', 'shared_activity', target_shared_activity, '{}'::jsonb);
  return removed;
end $function$;

-- target_learner null: move for everyone (clears splits). Otherwise: move only that learner (split).
-- A null new_date means "no fixed date" (for everyone), or "back with the group" (for one learner).
create or replace function public.move_shared_activity(
  target_household uuid,
  target_shared_activity uuid,
  new_date date,
  target_learner uuid default null
)
returns table(activity_id uuid, scheduled_for date, split_learners integer)
language plpgsql security definer set search_path = public
as $function$
begin
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.shared_activities a
     where a.id = target_shared_activity and a.household_id = target_household and a.removed_at is null
  ) then
    raise exception 'shared activity not found' using errcode = '42501';
  end if;
  if new_date is not null and (new_date < current_date - 366 or new_date > current_date + 366) then
    raise exception 'activity date is out of range' using errcode = '22023';
  end if;

  if target_learner is null then
    update public.shared_activities a set scheduled_for = new_date, updated_at = now() where a.id = target_shared_activity;
    update public.shared_activity_learners l set scheduled_for = null, updated_at = now()
     where l.activity_id = target_shared_activity and l.scheduled_for is not null;
  else
    update public.shared_activity_learners l set scheduled_for = new_date, updated_at = now()
     where l.activity_id = target_shared_activity and l.learner_id = target_learner and l.household_id = target_household;
    if not found then
      raise exception 'learner not found in household' using errcode = '42501';
    end if;
  end if;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'shared_activity.moved', 'shared_activity', target_shared_activity,
          jsonb_build_object('date', new_date, 'learnerId', target_learner));

  return query
    select a.id, a.scheduled_for,
           (select count(*)::integer from public.shared_activity_learners l
             where l.activity_id = a.id and l.scheduled_for is not null)
      from public.shared_activities a where a.id = target_shared_activity;
end $function$;

create or replace function public.set_shared_activity_done(
  target_household uuid,
  target_shared_activity uuid,
  target_learner uuid,
  done boolean
)
returns timestamptz
language plpgsql security definer set search_path = public
as $function$
declare stamp timestamptz;
begin
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.shared_activities a
     where a.id = target_shared_activity and a.household_id = target_household and a.removed_at is null
  ) then
    raise exception 'shared activity not found' using errcode = '42501';
  end if;
  update public.shared_activity_learners l
     set completed_at = case when done then now() end,
         completed_by = case when done then auth.uid() end,
         updated_at = now()
   where l.activity_id = target_shared_activity and l.learner_id = target_learner and l.household_id = target_household
  returning l.completed_at into stamp;
  if not found then
    raise exception 'learner not found in household' using errcode = '42501';
  end if;
  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), case when done then 'shared_activity.completed' else 'shared_activity.reopened' end,
          'shared_activity', target_shared_activity, jsonb_build_object('learnerId', target_learner));
  return stamp;
end $function$;

revoke all on function public.staff_create_shared_activity(uuid, text, text, text[], date, jsonb) from public, anon;
revoke all on function public.staff_remove_shared_activity(uuid, uuid) from public, anon;
revoke all on function public.move_shared_activity(uuid, uuid, date, uuid) from public, anon;
revoke all on function public.set_shared_activity_done(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.staff_create_shared_activity(uuid, text, text, text[], date, jsonb) to authenticated;
grant execute on function public.staff_remove_shared_activity(uuid, uuid) to authenticated;
grant execute on function public.move_shared_activity(uuid, uuid, date, uuid) to authenticated;
grant execute on function public.set_shared_activity_done(uuid, uuid, uuid, boolean) to authenticated;
