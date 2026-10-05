-- 058: email notifications (owner decision, 2026-10-05).
--
-- Families and staff only learned of a new plan, message or revision answer by opening the app.
-- This records each such event in an outbox; scripts/send-notifications.sh (run by the
-- Notifications workflow, OFF until counsel approves the wording, #10) emails a short notice through
-- the Mailgun account Auth already uses. The emails carry no child or plan details: only "something
-- new is waiting in BriteLink" and a link.
--
--   plan_delivered        a plan was sent to the family          -> every guardian of the household
--   message_to_guardian   staff wrote on the family's case       -> every guardian of the household
--   message_to_staff      a guardian wrote on the case           -> the assigned educator, or every
--                                                                    admin when none is assigned
--   revision_decided      a revision request was accepted,       -> the guardian who asked
--                         declined or completed
--
-- Each person can turn emails off (notification_preferences, default on). The sender never emails
-- an event older than two days, so switching sending on never delivers a stale backlog.

create table if not exists public.notification_preferences(
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
grant select on public.notification_preferences to authenticated;
drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences
  for select using (user_id = auth.uid());

create or replace function public.set_email_notifications(enabled boolean)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.memberships m where m.user_id = auth.uid()) then
    raise exception 'sign in to a household first' using errcode = '42501';
  end if;
  if enabled is null then raise exception 'choose on or off' using errcode = '22023'; end if;
  insert into public.notification_preferences(user_id, email_enabled, updated_at)
  values (auth.uid(), enabled, now())
  on conflict (user_id) do update set email_enabled = excluded.email_enabled, updated_at = excluded.updated_at;
  return enabled;
end $$;
revoke all on function public.set_email_notifications(boolean) from public, anon;
grant execute on function public.set_email_notifications(boolean) to authenticated;

create table if not exists public.notification_outbox(
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan_delivered', 'message_to_guardian', 'message_to_staff', 'revision_decided')),
  subject_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (kind, subject_id, recipient_user_id)
);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
-- Sealed like retention_execution_ledger: clients may run a SELECT, but with RLS on and no policy it
-- always returns nothing. Only the operator job, as the database owner, reads it.
grant select on public.notification_outbox to authenticated;
create index if not exists notification_outbox_pending_idx on public.notification_outbox(created_at) where status = 'pending';

-- Queue one notice per recipient; the same event never queues twice for the same person.
create or replace function public.enqueue_notification(target_household uuid, recipients uuid[], notice_kind text, notice_subject uuid, actor uuid)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notification_outbox(household_id, recipient_user_id, kind, subject_id)
  select target_household, r, notice_kind, notice_subject
  from unnest(recipients) r
  where r is not null and r is distinct from actor
  on conflict (kind, subject_id, recipient_user_id) do nothing;
$$;
revoke all on function public.enqueue_notification(uuid, uuid[], text, uuid, uuid) from public, anon, authenticated;

create or replace function public.household_guardians(target_household uuid)
returns uuid[]
language sql stable security definer set search_path = public
as $$ select coalesce(array_agg(m.user_id), '{}') from public.memberships m where m.household_id = target_household and m.role = 'guardian' $$;
revoke all on function public.household_guardians(uuid) from public, anon, authenticated;

create or replace function public.notify_on_case_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare educator uuid; sender_is_guardian boolean;
begin
  select exists(select 1 from public.memberships m where m.household_id = new.household_id and m.user_id = new.sender_user_id and m.role = 'guardian')
    into sender_is_guardian;
  if sender_is_guardian then
    select sc.assigned_educator_id into educator from public.service_cases sc where sc.id = new.case_id;
    perform public.enqueue_notification(new.household_id,
      case when educator is not null then array[educator]
           else (select coalesce(array_agg(m.user_id), '{}') from public.memberships m where m.household_id = new.household_id and m.role = 'admin') end,
      'message_to_staff', new.id, new.sender_user_id);
  else
    perform public.enqueue_notification(new.household_id, public.household_guardians(new.household_id), 'message_to_guardian', new.id, new.sender_user_id);
  end if;
  return new;
end $$;
revoke all on function public.notify_on_case_message() from public, anon, authenticated;
drop trigger if exists case_messages_notify on public.case_messages;
create trigger case_messages_notify after insert on public.case_messages
  for each row execute function public.notify_on_case_message();

-- A delivery notice is keyed to the delivery, so a retried send of the same delivery is one email.
create or replace function public.notify_on_delivery()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    perform public.enqueue_notification(new.household_id, public.household_guardians(new.household_id), 'plan_delivered', new.id, auth.uid());
  end if;
  return new;
end $$;
revoke all on function public.notify_on_delivery() from public, anon, authenticated;
drop trigger if exists deliveries_notify on public.deliveries;
create trigger deliveries_notify after insert or update of status on public.deliveries
  for each row execute function public.notify_on_delivery();

-- One notice per decision: accepted, declined and completed are separate events, so they key on
-- the request plus a per-status uuid derived from it.
create or replace function public.notify_on_revision_decision()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('accepted', 'declined', 'completed') and old.status is distinct from new.status then
    perform public.enqueue_notification(new.household_id, array[new.requested_by], 'revision_decided',
      md5(new.id::text || ':' || new.status)::uuid, auth.uid());
  end if;
  return new;
end $$;
revoke all on function public.notify_on_revision_decision() from public, anon, authenticated;
drop trigger if exists revision_requests_notify on public.revision_requests;
create trigger revision_requests_notify after update of status on public.revision_requests
  for each row execute function public.notify_on_revision_decision();

-- Sender side (run by the operator job as the database owner; no client role can call these).
-- Claims up to max_items pending notices, expiring anything older than two days and skipping anyone
-- who turned emails off. Returns the address to send to; the caller reports each result back.
create or replace function public.notification_claim(max_items integer default 50)
returns table(notice_id bigint, notice_kind text, recipient_email text)
language plpgsql security definer set search_path = public, auth
as $$
begin
  if max_items not between 1 and 500 then raise exception 'max_items is invalid'; end if;
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
  update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1
  from picked, auth.users u
  where o.id = picked.id and u.id = o.recipient_user_id
  returning o.id, o.kind, u.email::text;
end $$;
revoke all on function public.notification_claim(integer) from public, anon, authenticated;

create or replace function public.notification_finish(target_notice bigint, delivered boolean, failure text default null)
returns void
language sql security definer set search_path = public
as $$
  update public.notification_outbox
     set status = case when delivered then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
         sent_at = case when delivered then now() else sent_at end,
         last_error = case when delivered then null else left(coalesce(failure, 'send failed'), 300) end
   where id = target_notice and status = 'sending';
$$;
revoke all on function public.notification_finish(bigint, boolean, text) from public, anon, authenticated;
