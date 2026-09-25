-- 050: a live calendar subscription feed with a revocable, unguessable token (#47).
--
-- WHY
--   The .ics download (src/calendar-export.js) goes stale the moment a family moves a lesson or
--   takes a day off. A subscription URL lets Google, Apple and Outlook calendars refresh on their own.
--
-- MODEL
--   calendar_feeds   one active feed per learner. Only the SHA-256 of the token is stored; the
--                    token itself is returned once, to the guardian who created it, and is never
--                    readable again (not even by staff or the export). Creating a new feed revokes
--                    the old one (rotation); revoking stops the URL at once.
--
--   calendar_feed(token) is the one SECURITY DEFINER function anon may execute: a calendar app
--   cannot sign in. It answers only for an active token whose learner still has active guardian
--   consent, and it returns exactly what the guardian's own .ics download would contain for the
--   learner's latest published plan -- the same dates (planDayDates), the same skip rules, the same
--   private-by-default text: never the child's name, lesson titles only when the guardian opted in.
--   tests/postgres-rls-full-chain.test.mjs checks the events are byte-identical to planCalendarIcs.
--
--   Served by nginx at /feed/<token>.ics (nginx.conf.template), which asks PostgREST for text/plain
--   and answers text/calendar.

create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  learner_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  include_titles boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (household_id, learner_id) references public.learners(household_id, id) on delete cascade
);

create unique index calendar_feeds_one_active_per_learner on public.calendar_feeds (learner_id) where revoked_at is null;

alter table public.calendar_feeds enable row level security;

-- Guardians and admins see that a feed exists (never the token); educators do not need it.
create policy calendar_feeds_guardian_select on public.calendar_feeds
  for select using (public.has_household_role(household_id, array['guardian','admin']::public.membership_role[]));

revoke all on table public.calendar_feeds from public, anon, authenticated;
grant select (id, household_id, learner_id, include_titles, created_at, revoked_at) on table public.calendar_feeds to authenticated;

create or replace function public.create_calendar_feed(
  target_household uuid,
  target_learner uuid,
  include_titles boolean
)
returns table(feed_id uuid, token text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare
  new_token text;
  new_id uuid;
begin
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.learners l where l.id = target_learner and l.household_id = target_household and l.deleted_at is null) then
    raise exception 'learner not found in household' using errcode = '42501';
  end if;

  -- 64 hex characters from two v4 UUIDs: 244 bits from the server's strong random source.
  new_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  update public.calendar_feeds f set revoked_at = now()
   where f.learner_id = target_learner and f.household_id = target_household and f.revoked_at is null;
  insert into public.calendar_feeds (household_id, learner_id, token_hash, include_titles, created_by)
  values (target_household, target_learner, sha256(convert_to(new_token, 'UTF8')), coalesce(include_titles, false), auth.uid())
  returning id into new_id;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
  values (target_household, auth.uid(), 'calendar_feed.created', 'calendar_feed', new_id,
          jsonb_build_object('learnerId', target_learner, 'includeTitles', coalesce(include_titles, false)));

  return query select f.id, new_token, f.created_at from public.calendar_feeds f where f.id = new_id;
end $function$;

create or replace function public.revoke_calendar_feed(target_household uuid, target_learner uuid)
returns integer
language plpgsql security definer set search_path = public
as $function$
declare revoked integer;
begin
  if not public.has_household_role(target_household, array['guardian','admin']::public.membership_role[]) then
    raise exception 'guardian access required' using errcode = '42501';
  end if;
  update public.calendar_feeds f set revoked_at = now()
   where f.learner_id = target_learner and f.household_id = target_household and f.revoked_at is null;
  get diagnostics revoked = row_count;
  if revoked > 0 then
    insert into public.audit_events (household_id, actor_user_id, event_type, subject_type, subject_id, metadata)
    values (target_household, auth.uid(), 'calendar_feed.revoked', 'learner', target_learner, '{}'::jsonb);
  end if;
  return revoked;
end $function$;

revoke all on function public.create_calendar_feed(uuid, uuid, boolean) from public, anon;
revoke all on function public.revoke_calendar_feed(uuid, uuid) from public, anon;
grant execute on function public.create_calendar_feed(uuid, uuid, boolean) to authenticated;
grant execute on function public.revoke_calendar_feed(uuid, uuid) to authenticated;

-- RFC 5545 3.3.11 TEXT escaping; mirrors icsText in src/calendar-export.js.
create or replace function public.calendar_ics_text(value text)
returns text language sql immutable set search_path = public
as $function$
  select replace(replace(replace(replace(coalesce(value, ''), E'\\', E'\\\\'), ';', E'\\;'), ',', E'\\,'), E'\n', E'\\n')
$function$;

-- RFC 5545 3.1 line folding at 75 octets; mirrors foldIcsLine in src/calendar-export.js.
create or replace function public.calendar_ics_fold(line text)
returns text language plpgsql immutable set search_path = public
as $function$
declare
  out_text text := '';
  chunk text := '';
  size integer := 0;
  limit_octets integer := 75;
  ch text;
begin
  if octet_length(line) <= 75 then return line; end if;
  foreach ch in array regexp_split_to_array(line, '') loop
    if size + octet_length(ch) > limit_octets then
      out_text := out_text || chunk || E'\r\n ';
      chunk := '';
      size := 0;
      limit_octets := 74;
    end if;
    chunk := chunk || ch;
    size := size + octet_length(ch);
  end loop;
  return out_text || chunk;
end $function$;

revoke all on function public.calendar_ics_text(text) from public, anon, authenticated;
revoke all on function public.calendar_ics_fold(text) from public, anon, authenticated;

create or replace function public.calendar_feed(token text)
returns text
language plpgsql stable security definer set search_path = public
as $function$
declare
  feed public.calendar_feeds%rowtype;
  plan_row public.plans%rowtype;
  sched public.plan_schedules%rowtype;
  has_sched boolean := false;
  day_row record;
  cursor_date date;
  fixed date[];
  day_dates jsonb := '{}'::jsonb;
  lesson_row record;
  lesson_date date;
  by_date jsonb := '{}'::jsonb;
  event_date text;
  lines text[];
  stamp text := to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"');
  titles text[];
  n integer;
  description text;
begin
  if token is null or token !~ '^[0-9a-f]{64}$' then
    raise exception 'calendar feed not found' using errcode = '42501';
  end if;
  select * into feed from public.calendar_feeds f
   where f.token_hash = sha256(convert_to(token, 'UTF8')) and f.revoked_at is null;
  if not found
     or not exists (select 1 from public.learners l where l.id = feed.learner_id and l.deleted_at is null)
     or not public.has_active_guardian_consent(feed.household_id, feed.learner_id) then
    raise exception 'calendar feed not found' using errcode = '42501';
  end if;

  lines := array['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BriteLink//Family plan//EN', 'CALSCALE:GREGORIAN',
                 'METHOD:PUBLISH', 'X-WR-CALNAME:BriteLink', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];

  select * into plan_row from public.plans p
   where p.household_id = feed.household_id and p.learner_id = feed.learner_id and p.status = 'published'
   order by p.version desc limit 1;
  if found then
    select * into sched from public.plan_schedules s where s.plan_id = plan_row.id;
    has_sched := found;

    -- planDayDates (src/authenticated-workspace.js).
    select coalesce(array_agg(d.planned_date), array[]::date[]) into fixed
      from public.plan_days d join public.plan_weeks w on w.id = d.week_id
     where w.plan_id = plan_row.id and d.planned_date is not null;
    cursor_date := case when has_sched then sched.start_date end;
    for day_row in
      select d.id, d.planned_date from public.plan_days d join public.plan_weeks w on w.id = d.week_id
       where w.plan_id = plan_row.id order by w.week_number, d.day_number
    loop
      if day_row.planned_date is not null or cursor_date is null then
        day_dates := day_dates || jsonb_build_object(day_row.id::text, day_row.planned_date);
        continue;
      end if;
      while not (extract(isodow from cursor_date)::smallint = any(sched.school_days))
            or cursor_date = any(sched.days_off) or cursor_date = any(fixed) loop
        cursor_date := cursor_date + 1;
      end loop;
      day_dates := day_dates || jsonb_build_object(day_row.id::text, cursor_date);
      cursor_date := cursor_date + 1;
    end loop;

    -- planCalendarIcs (src/calendar-export.js): unfinished, unpaused lessons grouped by date.
    for lesson_row in
      select x.id, x.subject, x.title, x.day_id, a.status::text as status, a.scheduled_for
        from public.lessons x
        join public.plan_days d on d.id = x.day_id
        join public.plan_weeks w on w.id = d.week_id
        left join public.lesson_activities a on a.lesson_id = x.id and a.learner_id = feed.learner_id
       where w.plan_id = plan_row.id
       order by w.week_number, d.day_number, x.position
    loop
      continue when lesson_row.status in ('completed', 'skipped');
      continue when has_sched and lesson_row.subject = any(sched.paused_subjects);
      lesson_date := coalesce(lesson_row.scheduled_for, (day_dates ->> lesson_row.day_id::text)::date);
      continue when lesson_date is null;
      by_date := jsonb_set(by_date, array[lesson_date::text],
        coalesce(by_date -> lesson_date::text, '[]'::jsonb)
          || jsonb_build_array(lesson_row.subject || ': ' || lesson_row.title));
    end loop;

    for event_date in select k from jsonb_object_keys(by_date) k order by k loop
      select array_agg(v order by o) into titles from jsonb_array_elements_text(by_date -> event_date) with ordinality as t(v, o);
      n := cardinality(titles);
      description := case when feed.include_titles then array_to_string(titles, E'\n')
                          else 'Open BriteLink to see the day''s lessons.' end;
      lines := lines || array[
        'BEGIN:VEVENT',
        'UID:' || plan_row.id || '-' || replace(event_date, '-', '') || '@britelink',
        'DTSTAMP:' || stamp,
        'DTSTART;VALUE=DATE:' || replace(event_date, '-', ''),
        'DTEND;VALUE=DATE:' || to_char(event_date::date + 1, 'YYYYMMDD'),
        'SUMMARY:' || public.calendar_ics_text('BriteLink: ' || n || case when n = 1 then ' lesson' else ' lessons' end),
        'DESCRIPTION:' || public.calendar_ics_text(description),
        'TRANSP:TRANSPARENT',
        'END:VEVENT'];
    end loop;
  end if;

  lines := lines || 'END:VCALENDAR'::text;
  return (select string_agg(public.calendar_ics_fold(l), E'\r\n' order by o) from unnest(lines) with ordinality as u(l, o)) || E'\r\n';
end $function$;

-- The single anon-executable definer function (see tests/postgres-rls-full-chain.test.mjs,
-- ANON_RPCS). Authenticated clients have no reason to call it and do not get it.
revoke all on function public.calendar_feed(text) from public, authenticated;
grant execute on function public.calendar_feed(text) to anon;

-- The family's export carries the educator's weekly notes (048), shared activities (049) and which
-- calendar feeds exist (050; never the token hash). Additive to 047's wrapper; schemaVersion stays 2.
create or replace function public.export_guardian_household_authorized(target_household uuid)
returns jsonb language plpgsql security definer set search_path = public, auth
as $function$
declare payload jsonb := public.export_guardian_household_core(target_household);
begin
  payload := jsonb_set(payload, '{manifest,included}', (payload #> '{manifest,included}')
    || '["planSchedules","learningCaptures","weeklyNotes","sharedActivities","calendarFeeds"]'::jsonb);
  payload := jsonb_set(payload, '{lessons}', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.day_id, x.position)
      from (select id, day_id, position, subject, title, objective, instructions, materials, accommodations,
                   adult_help_minutes, estimated_minutes, help_level, needs_screen
              from public.lessons where household_id = target_household) x), '[]'::jsonb));
  return payload
    || jsonb_build_object('planSchedules', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.plan_id)
           from (select plan_id, start_date, school_days, days_off, calendar_set, paused_subjects, updated_at
                   from public.plan_schedules where household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('learningCaptures', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.captured_on, x.created_at)
           from (select id, learner_id, captured_on, kind, subjects, note, created_at, removed_at
                   from public.learning_captures where household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('weeklyNotes', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.week_start, x.learner_id)
           from (select id, learner_id, week_start, note, created_at, updated_at
                   from public.weekly_notes where household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('sharedActivities', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.created_at)
           from (select a.id, a.title, a.description, a.subjects, a.scheduled_for, a.created_at, a.removed_at,
                        coalesce((select jsonb_agg(jsonb_build_object('learnerId', l.learner_id, 'outcome', l.outcome,
                                    'scheduledFor', l.scheduled_for, 'completedAt', l.completed_at) order by l.learner_id)
                                    from public.shared_activity_learners l where l.activity_id = a.id), '[]'::jsonb) as learners
                   from public.shared_activities a where a.household_id = target_household) x), '[]'::jsonb))
    || jsonb_build_object('calendarFeeds', coalesce((
         select jsonb_agg(to_jsonb(x) order by x.created_at)
           from (select id, learner_id, include_titles, created_at, revoked_at
                   from public.calendar_feeds where household_id = target_household) x), '[]'::jsonb));
end $function$;
revoke all on function public.export_guardian_household_authorized(uuid) from public, anon, authenticated;
