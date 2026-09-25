-- 051: privacy-minimal beta funnel (#53, #13).
--
-- WHY
--   The private beta's success measure is "a new family reaches its first completed lesson without
--   contacting support". Nothing recorded when a lesson was FIRST completed: lesson_activities.
--   updated_at moves on every later edit (a note, a reschedule, an undo and redo), and there is no
--   audit event for client-written activity rows.
--
-- MODEL
--   lesson_activities.first_completed_at -- set by a trigger the first time a row is completed and
--   never cleared, whatever the client sends (clients write this table directly, 014/031, so the
--   column must not be client-controlled). Existing completed rows are backfilled from updated_at,
--   which is the best evidence available for them.
--
--   service_beta_funnel() -- one row per live household with milestone timestamps only: created,
--   first intake submitted, first plan published, first delivery acknowledged, first lesson
--   completed, and how many guardian messages were sent before that first completion. No names,
--   no content, no learner ids. service_role only: it spans households by design, so no client
--   role may execute it. Run by the operator through scripts/beta-funnel-report.mjs.

alter table public.lesson_activities add column first_completed_at timestamptz;

update public.lesson_activities set first_completed_at = updated_at
 where status = 'completed' and first_completed_at is null;

create or replace function public.stamp_first_completion()
returns trigger
language plpgsql set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    new.first_completed_at := case when new.status = 'completed' then now() end;
  else
    new.first_completed_at := coalesce(old.first_completed_at,
                                       case when new.status = 'completed' then now() end);
  end if;
  return new;
end $function$;

revoke all on function public.stamp_first_completion() from public, anon, authenticated;

create trigger lesson_activities_first_completion
  before insert or update on public.lesson_activities
  for each row execute function public.stamp_first_completion();

create or replace function public.service_beta_funnel()
returns table(
  household_id uuid,
  synthetic boolean,
  created_at timestamptz,
  intake_submitted_at timestamptz,
  plan_published_at timestamptz,
  delivery_acknowledged_at timestamptz,
  first_completed_at timestamptz,
  guardian_messages_before_first_completion integer
)
language sql stable security definer set search_path = public
as $function$
  with firsts as (
    select h.id,
           h.display_name like 'SYNTHETIC%' as synthetic,
           h.created_at,
           (select min(p.submitted_at) from public.learner_profiles p where p.household_id = h.id) as intake_at,
           (select min(pl.published_at) from public.plans pl where pl.household_id = h.id) as published_at,
           (select min(d.acknowledged_at) from public.deliveries d where d.household_id = h.id) as acknowledged_at,
           (select min(a.first_completed_at) from public.lesson_activities a where a.household_id = h.id) as completed_at
      from public.households h
     where h.deleted_at is null
  )
  select f.id, f.synthetic, f.created_at, f.intake_at, f.published_at, f.acknowledged_at, f.completed_at,
         (select count(*)::integer
            from public.case_messages m
            join public.memberships ms on ms.household_id = m.household_id and ms.user_id = m.sender_user_id and ms.role = 'guardian'
           where m.household_id = f.id
             and (f.completed_at is null or m.created_at < f.completed_at))
    from firsts f
   order by f.created_at
$function$;

revoke all on function public.service_beta_funnel() from public, anon, authenticated;
grant execute on function public.service_beta_funnel() to service_role;
