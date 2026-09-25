-- 046: capture learning that happened outside the plan (#44).
--
-- WHY
--   A plan only records what BriteLink prescribed. Eclectic, unschooling, Charlotte Mason and project
--   families learn from books, outings, co-ops and tutors; without a place to note that, the product
--   serves one philosophy and the family's record is incomplete (BUILD-PRIORITIES P1 #5).
--
-- MODEL
--   One row per note: when, what kind, which subjects, and a short free note. Text only for now --
--   photos of children need the private attachment path, scanning and counsel review (#4, #10), so
--   they are deliberately not stored here. The note carries the same "no health details" guidance
--   the intake does, and is bounded.
--   Guardians (and household admins) write through record_learning_capture / remove_learning_capture;
--   members read. A removal is a soft delete so the export can still account for it.

create table public.learning_captures (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  learner_id uuid not null,
  captured_on date not null,
  kind text not null check (kind in ('book','outing','activity','co_op','tutor','note')),
  subjects text[] not null default array[]::text[],
  note text not null check (char_length(note) between 1 and 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  foreign key (household_id, learner_id) references public.learners(household_id, id) on delete cascade,
  constraint learning_captures_subjects_valid check (
    cardinality(subjects) <= 7
    and subjects <@ array['Language','Math','Science','Social studies','French','Arts','Health and physical education']::text[]
  )
);

create index learning_captures_learner_day_idx on public.learning_captures (learner_id, captured_on desc);

alter table public.learning_captures enable row level security;

create policy learning_captures_member_select on public.learning_captures
  for select using (public.is_household_member(household_id));

grant select on table public.learning_captures to authenticated;

-- Same per-actor rate limit as other client-originated rows (011).
create trigger rate_limit_learning_captures before insert on public.learning_captures
  for each row execute function public.enforce_insert_rate_limit('capture.record', 60, 3600);

create or replace function public.record_learning_capture(
  target_household uuid,
  target_learner uuid,
  capture_date date,
  capture_kind text,
  capture_subjects text[],
  capture_note text
)
returns table(capture_id uuid, captured_on date, created_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare
  clean_subjects text[];
  new_id uuid;
begin
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.learners l where l.id = target_learner and l.household_id = target_household and l.deleted_at is null) then
    raise exception 'learner not found in household' using errcode = '42501';
  end if;
  if capture_date is null or capture_date > current_date + 1 or capture_date < current_date - 366 then
    raise exception 'capture date is out of range' using errcode = '22023';
  end if;
  if capture_kind is null or capture_kind not in ('book','outing','activity','co_op','tutor','note') then
    raise exception 'capture kind is invalid' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct s order by s), array[]::text[]) into clean_subjects
    from unnest(coalesce(capture_subjects, array[]::text[])) as s;
  if not clean_subjects <@ array['Language','Math','Science','Social studies','French','Arts','Health and physical education']::text[] then
    raise exception 'subject is invalid' using errcode = '22023';
  end if;
  if capture_note is null or char_length(btrim(capture_note)) not between 1 and 1000 then
    raise exception 'capture note is required and must be at most 1000 characters' using errcode = '22023';
  end if;

  insert into public.learning_captures (household_id, learner_id, captured_on, kind, subjects, note, created_by)
  values (target_household, target_learner, capture_date, capture_kind, clean_subjects, btrim(capture_note), auth.uid())
  returning id into new_id;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'capture.recorded', 'learning_capture', new_id,
          jsonb_build_object('learnerId', target_learner, 'kind', capture_kind, 'subjects', to_jsonb(clean_subjects)));

  return query select c.id, c.captured_on, c.created_at from public.learning_captures c where c.id = new_id;
end $function$;

create or replace function public.remove_learning_capture(target_household uuid, target_capture uuid)
returns timestamptz
language plpgsql security definer set search_path = public
as $function$
declare removed timestamptz;
begin
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  update public.learning_captures set removed_at = now()
   where id = target_capture and household_id = target_household and removed_at is null
  returning removed_at into removed;
  if removed is null then
    raise exception 'capture not found' using errcode = '42501';
  end if;
  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'capture.removed', 'learning_capture', target_capture, '{}'::jsonb);
  return removed;
end $function$;

revoke all on function public.record_learning_capture(uuid, uuid, date, text, text[], text) from public, anon;
revoke all on function public.remove_learning_capture(uuid, uuid) from public, anon;
grant execute on function public.record_learning_capture(uuid, uuid, date, text, text[], text) to authenticated;
grant execute on function public.remove_learning_capture(uuid, uuid) to authenticated;

-- The family's portable export carries their captures, including removed ones (with removed_at),
-- so the record is complete. Additive to 044's wrapper; schemaVersion stays 2.
create or replace function public.export_guardian_household_authorized(target_household uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $function$
declare payload jsonb := public.export_guardian_household_core(target_household);
begin
  payload := jsonb_set(payload, '{manifest,included}', (payload #> '{manifest,included}') || '["planSchedules","learningCaptures"]'::jsonb);
  payload := jsonb_set(payload, '{lessons}', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.day_id, x.position)
      from (select id, day_id, position, subject, title, objective, instructions, materials, accommodations,
                   adult_help_minutes, estimated_minutes, help_level, needs_screen
              from public.lessons where household_id = target_household) x), '[]'::jsonb));
  return payload
    || jsonb_build_object('planSchedules', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.plan_id)
           from (select plan_id, start_date, school_days, days_off, updated_at
                   from public.plan_schedules where household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('learningCaptures', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.captured_on, x.created_at)
           from (select id, learner_id, captured_on, kind, subjects, note, created_at, removed_at
                   from public.learning_captures where household_id = target_household) x), '[]'::jsonb));
end $function$;
revoke all on function public.export_guardian_household_authorized(uuid) from public, anon, authenticated;
