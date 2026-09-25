-- 048: an optional note from the educator for the week (#43).
--
-- WHY
--   The weekly story (client-side, from lessons, captures and the family calendar) tells a parent
--   what happened. #43 also asks for "an optional note from the educator for the week": a few
--   human words -- a win noticed, a suggestion -- from the person who wrote the plan.
--
-- MODEL
--   One note per learner per week, keyed by the Monday that starts the ISO week (the same week the
--   weekly story shows). Educators and admins in the household write through staff_set_weekly_note
--   and staff_clear_weekly_note; every member reads. Text only and bounded; the same "no health or
--   diagnosis details" rule as every other free-text field is stated in the authoring UI.

create table public.weekly_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  learner_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  note text not null check (char_length(note) between 1 and 1000),
  author_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, learner_id) references public.learners(household_id, id) on delete cascade,
  constraint weekly_notes_one_per_week unique (learner_id, week_start)
);

alter table public.weekly_notes enable row level security;

create policy weekly_notes_member_select on public.weekly_notes
  for select using (public.is_household_member(household_id));

-- 042 revoked Supabase's default table grants; read is the only client privilege.
revoke all on table public.weekly_notes from public, anon, authenticated;
grant select on table public.weekly_notes to authenticated;

create or replace function public.staff_set_weekly_note(
  target_household uuid,
  target_learner uuid,
  target_week date,
  note_body text
)
returns table(note_id uuid, week_start date, updated_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare saved uuid;
begin
  if not public.has_household_role(target_household, array['educator','admin']::public.membership_role[]) then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.learners l where l.id = target_learner and l.household_id = target_household and l.deleted_at is null) then
    raise exception 'learner not found in household' using errcode = '42501';
  end if;
  if target_week is null or extract(isodow from target_week) <> 1
     or target_week < current_date - 371 or target_week > current_date + 7 then
    raise exception 'week must be a Monday within the last year' using errcode = '22023';
  end if;
  if note_body is null or char_length(btrim(note_body)) not between 1 and 1000 then
    raise exception 'weekly note is required and must be at most 1000 characters' using errcode = '22023';
  end if;

  insert into public.weekly_notes as w (household_id, learner_id, week_start, note, author_user_id)
  values (target_household, target_learner, target_week, btrim(note_body), auth.uid())
  on conflict on constraint weekly_notes_one_per_week do update
    set note = excluded.note, author_user_id = excluded.author_user_id, updated_at = now()
    where w.household_id = target_household
  returning w.id into saved;
  if saved is null then
    raise exception 'learner not found in household' using errcode = '42501';
  end if;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'weekly_note.saved', 'weekly_note', saved,
          jsonb_build_object('learnerId', target_learner, 'weekStart', target_week));

  return query select w.id, w.week_start, w.updated_at from public.weekly_notes w where w.id = saved;
end $function$;

create or replace function public.staff_clear_weekly_note(
  target_household uuid,
  target_learner uuid,
  target_week date
)
returns boolean
language plpgsql security definer set search_path = public
as $function$
declare removed uuid;
begin
  if not public.has_household_role(target_household, array['educator','admin']::public.membership_role[]) then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  delete from public.weekly_notes w
   where w.household_id = target_household and w.learner_id = target_learner and w.week_start = target_week
  returning w.id into removed;
  if removed is null then
    raise exception 'weekly note not found' using errcode = '42501';
  end if;
  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'weekly_note.cleared', 'weekly_note', removed,
          jsonb_build_object('learnerId', target_learner, 'weekStart', target_week));
  return true;
end $function$;

revoke all on function public.staff_set_weekly_note(uuid, uuid, date, text) from public, anon;
revoke all on function public.staff_clear_weekly_note(uuid, uuid, date) from public, anon;
grant execute on function public.staff_set_weekly_note(uuid, uuid, date, text) to authenticated;
grant execute on function public.staff_clear_weekly_note(uuid, uuid, date) to authenticated;
