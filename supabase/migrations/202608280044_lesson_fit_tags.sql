-- 044: educator tags that let a family filter today's work (#41).
--
-- WHY
--   "What fits today?" -- time available, can the child do it alone, is a screen needed -- cannot be
--   answered from the plan: lessons carry adult_help_minutes and materials, but no duration, help
--   level, or device need. The educator already knows all three when writing the lesson, so the
--   cheapest honest source is three optional fields at authoring time.
--
-- MODEL
--   estimated_minutes  5..240, the whole lesson, not only adult time
--   help_level         independent | some_help | together
--   needs_screen       true when the lesson needs a device
--   All nullable. Existing plans are untagged, and untagged means unknown -- the family filter keeps
--   an untagged lesson visible and says it is untagged; it never guesses.
--
--   staff_create_plan_version (007) is the only writer of lessons, so it is redefined here verbatim
--   apart from the three validated fields; admin_save_plan_document (028) writes no lessons.

alter table public.lessons
  add column estimated_minutes integer check (estimated_minutes between 5 and 240),
  add column help_level text check (help_level in ('independent','some_help','together')),
  add column needs_screen boolean;

create or replace function public.staff_create_plan_version(target_household uuid,target_case uuid,plan_document jsonb)
returns table(plan_id uuid,plan_version integer,week_count integer,lesson_count integer)
language plpgsql security definer set search_path=public
as $$
declare service_case public.service_cases%rowtype; new_plan uuid; next_version integer; week_item jsonb; day_item jsonb; lesson_item jsonb; new_week uuid; new_day uuid; weeks_total integer; lessons_total integer:=0;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required'; end if;
  select * into service_case from public.service_cases where id=target_case and household_id=target_household for update;
  if not found then raise exception 'case not found'; end if;
  if service_case.status not in ('drafting','internal_review','revision_requested') then raise exception 'case is not ready for plan authoring'; end if;
  if service_case.status='revision_requested' and not exists(select 1 from public.revision_requests where case_id=target_case and status='accepted') then raise exception 'revision must be accepted before authoring'; end if;
  if jsonb_typeof(plan_document->'weeks')<>'array' then raise exception 'plan weeks must be an array'; end if;
  weeks_total:=jsonb_array_length(plan_document->'weeks');if weeks_total<1 or weeks_total>52 then raise exception 'plan requires 1 to 52 weeks'; end if;
  select coalesce(max(version),0)+1 into next_version from public.plans where case_id=target_case;
  insert into public.plans(household_id,case_id,learner_id,version,status,authored_by) values(target_household,target_case,service_case.learner_id,next_version,'draft',auth.uid()) returning id into new_plan;
  for week_item in select value from jsonb_array_elements(plan_document->'weeks') loop
    if (week_item->>'number')::integer not between 1 and 52 or char_length(btrim(week_item->>'theme')) not between 1 and 200 then raise exception 'invalid week'; end if;
    if jsonb_typeof(week_item->'days')<>'array' or jsonb_array_length(week_item->'days')<1 then raise exception 'each week requires at least one day'; end if;
    insert into public.plan_weeks(household_id,plan_id,week_number,theme) values(target_household,new_plan,(week_item->>'number')::integer,btrim(week_item->>'theme')) returning id into new_week;
    for day_item in select value from jsonb_array_elements(week_item->'days') loop
      if (day_item->>'number')::integer not between 1 and 7 then raise exception 'invalid day'; end if;
      if jsonb_typeof(day_item->'lessons')<>'array' or jsonb_array_length(day_item->'lessons')<1 then raise exception 'each day requires at least one lesson'; end if;
      insert into public.plan_days(household_id,week_id,day_number,planned_date) values(target_household,new_week,(day_item->>'number')::integer,nullif(day_item->>'plannedDate','')::date) returning id into new_day;
      for lesson_item in select value from jsonb_array_elements(day_item->'lessons') loop
        if (lesson_item->>'position')::integer<1 or char_length(btrim(lesson_item->>'subject')) not between 1 and 100 or char_length(btrim(lesson_item->>'title')) not between 1 and 200 or char_length(btrim(lesson_item->>'objective')) not between 1 and 1000 then raise exception 'invalid lesson'; end if;
        if jsonb_typeof(lesson_item->'instructions')<>'array' or jsonb_array_length(lesson_item->'instructions')<1 then raise exception 'lesson instructions are required'; end if;
        -- 044: optional "what fits today" tags. Absent means not yet tagged, never a guess.
        if nullif(lesson_item->>'estimatedMinutes','') is not null and (lesson_item->>'estimatedMinutes') !~ '^[0-9]{1,3}$' then raise exception 'estimated minutes are invalid'; end if;
        if nullif(lesson_item->>'estimatedMinutes','')::integer not between 5 and 240 then raise exception 'estimated minutes are invalid'; end if;
        if nullif(lesson_item->>'helpLevel','') is not null and lesson_item->>'helpLevel' not in ('independent','some_help','together') then raise exception 'help level is invalid'; end if;
        if lesson_item ? 'needsScreen' and jsonb_typeof(lesson_item->'needsScreen') not in ('boolean','null') then raise exception 'needs screen must be true or false'; end if;
        insert into public.lessons(household_id,day_id,position,subject,title,objective,instructions,materials,accommodations,adult_help_minutes,estimated_minutes,help_level,needs_screen)
        values(target_household,new_day,(lesson_item->>'position')::integer,btrim(lesson_item->>'subject'),btrim(lesson_item->>'title'),btrim(lesson_item->>'objective'),lesson_item->'instructions',coalesce(lesson_item->'materials','[]'::jsonb),coalesce(lesson_item->'accommodations','[]'::jsonb),nullif(lesson_item->>'adultHelpMinutes','')::integer,
               nullif(lesson_item->>'estimatedMinutes','')::integer,nullif(lesson_item->>'helpLevel',''),(lesson_item->>'needsScreen')::boolean);
        lessons_total:=lessons_total+1;
      end loop;
    end loop;
  end loop;
  update public.service_cases set status=case when service_case.status='revision_requested' then 'revision_requested'::public.case_status else 'drafting'::public.case_status end,updated_at=now() where id=target_case;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'plan.version_created','plan',new_plan,jsonb_build_object('version',next_version,'weeks',weeks_total,'lessons',lessons_total));
  return query select new_plan,next_version,weeks_total,lessons_total;
end $$;

-- The family export lists lesson columns explicitly (020), so the wrapper from 043 re-selects
-- lessons with the tags included. Additive: schemaVersion stays 2.
create or replace function public.export_guardian_household_authorized(target_household uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $function$
declare payload jsonb := public.export_guardian_household_core(target_household);
begin
  payload := jsonb_set(payload, '{manifest,included}', (payload #> '{manifest,included}') || '["planSchedules"]'::jsonb);
  payload := jsonb_set(payload, '{lessons}', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.day_id, x.position)
      from (select id, day_id, position, subject, title, objective, instructions, materials, accommodations,
                   adult_help_minutes, estimated_minutes, help_level, needs_screen
              from public.lessons where household_id = target_household) x), '[]'::jsonb));
  return payload || jsonb_build_object('planSchedules', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.plan_id)
      from (select plan_id, start_date, school_days, days_off, updated_at
              from public.plan_schedules where household_id = target_household) x), '[]'::jsonb));
end $function$;
revoke all on function public.export_guardian_household_authorized(uuid) from public, anon, authenticated;
