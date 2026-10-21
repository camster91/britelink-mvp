-- 063: database follow-ups from the 2026-10-15 review.
--
-- WHY
--   - A lesson-progress row could be inserted against a lesson in a plan the family cannot read
--     yet (a draft or internal-review version), given its id: the insert policy never checked
--     the plan, unlike the read policy.
--   - "Removing" a learning note only stamps removed_at, but the read policy still returned the
--     note's text to every member of the family, staff included.
--   - The email job moves notices to 'sending' before it sends them. If it stopped between the two
--     steps, those notices stayed in 'sending' for good: never sent, never retried, never failed.
--   - has_active_guardian_consent() answered for any household and learner ids, to any signed-in
--     account. The temporary diagnose_caller_identity() (039) was still callable by every client.
--
-- WHAT CHANGES
--   1. activities_guardian_insert also requires the lesson's plan to be readable (as 062, plus
--      can_read_plan).
--   2. learning_captures_member_select hides removed notes. The app already filtered them out, and
--      the family's export still includes them (it reads as the owner).
--   3. notification_claim first returns notices stuck in 'sending' for over an hour to 'pending'
--      (or 'failed' after three attempts, with a reason), using a new claimed_at column.
--   4. has_active_guardian_consent() answers only for a member of that household. Inside the
--      calendar feed (no signed-in user) it still works as before. diagnose_caller_identity() is
--      no longer callable by clients.
--   Not changed: activity_plan_id(), lesson_plan_id() and day_plan_id() (030). They return only an
--   internal plan id for an id the caller already has, and every read policy calls them, so a
--   membership check there would cost every page load for no protected data.
--
-- RERUNNABLE: create or replace, drop policy if exists, add column if not exists.

-- 1 ----------------------------------------------------------------------------------------------
drop policy if exists activities_guardian_insert on public.lesson_activities;
create policy activities_guardian_insert on public.lesson_activities
  for insert
  with check (
    public.has_household_role(household_id, array['guardian']::public.membership_role[])
    and updated_by = auth.uid()
    and public.can_read_plan(public.lesson_plan_id(lesson_id))
  );

-- 2 ----------------------------------------------------------------------------------------------
drop policy if exists learning_captures_member_select on public.learning_captures;
create policy learning_captures_member_select on public.learning_captures
  for select using (public.is_household_member(household_id) and removed_at is null);

-- 3 ----------------------------------------------------------------------------------------------
alter table public.notification_outbox add column if not exists claimed_at timestamptz;

create or replace function public.notification_claim(max_items integer default 50)
returns table(notice_id bigint, notice_kind text, recipient_email text)
language plpgsql security definer set search_path = public, auth
as $$
begin
  if max_items not between 1 and 500 then raise exception 'max_items is invalid'; end if;
  -- 063: a run that stopped between claiming and reporting leaves notices in 'sending'. After an
  -- hour (the job runs every ten minutes), try them again, or give up after three attempts.
  update public.notification_outbox
     set status = case when attempts >= 3 then 'failed' else 'pending' end,
         last_error = 'the sending run stopped before reporting back'
   where status = 'sending' and coalesce(claimed_at, created_at) < now() - interval '1 hour';
  update public.notification_outbox set status = 'skipped', last_error = 'expired before sending'
   where status = 'pending' and created_at < now() - interval '2 days';
  update public.notification_outbox o set status = 'skipped', last_error = 'recipient turned emails off'
   where o.status = 'pending'
     and exists (select 1 from public.notification_preferences p where p.user_id = o.recipient_user_id and not p.email_enabled);
  return query
  with picked as (
    select o.id from public.notification_outbox o
    where o.status = 'pending'
    order by o.created_at
    limit max_items
    for update skip locked
  )
  update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
  from picked, auth.users u
  where o.id = picked.id and u.id = o.recipient_user_id
  returning o.id, o.kind, u.email::text;
end $$;
revoke all on function public.notification_claim(integer) from public, anon, authenticated;

-- 4 ----------------------------------------------------------------------------------------------
create or replace function public.has_active_guardian_consent(target_household uuid, target_learner uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select (auth.uid() is null or public.is_household_member(target_household))
     and exists (
       select 1 from public.guardian_consents consent
        where consent.household_id = target_household
          and consent.learner_id = target_learner
          and consent.withdrawn_at is null
     )
$$;
revoke all on function public.has_active_guardian_consent(uuid, uuid) from public;
grant execute on function public.has_active_guardian_consent(uuid, uuid) to authenticated;

revoke all on function public.diagnose_caller_identity(uuid) from public, anon, authenticated;
