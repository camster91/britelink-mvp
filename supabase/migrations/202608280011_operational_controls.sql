-- Database-enforced abuse quotas and privacy-minimal operational signals.

create table public.operation_rate_windows(
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action_key text not null check(char_length(action_key) between 3 and 80),
  window_started_at timestamptz not null,
  attempt_count integer not null check(attempt_count>0),
  last_attempt_at timestamptz not null default now(),
  primary key(household_id,actor_user_id,action_key,window_started_at)
);
alter table public.operation_rate_windows enable row level security;
create policy operation_rate_windows_admin_select on public.operation_rate_windows for select using(public.has_household_role(household_id,array['admin']::public.membership_role[]));
create index operation_rate_windows_expiry_idx on public.operation_rate_windows(window_started_at);

create table public.operational_events(
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  component text not null check(char_length(component) between 2 and 80),
  severity text not null check(severity in ('info','warning','error','critical')),
  event_code text not null check(event_code ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  correlation_key text check(correlation_key is null or char_length(correlation_key) between 8 and 120),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=4096),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
alter table public.operational_events enable row level security;
create policy operational_events_admin_select on public.operational_events for select using(public.has_household_role(household_id,array['admin']::public.membership_role[]));
create index operational_events_severity_occurred_idx on public.operational_events(severity,occurred_at desc);

create or replace function public.enforce_operation_rate_limit(target_household uuid,target_action_key text,maximum_attempts integer,window_seconds integer)
returns integer language plpgsql security definer set search_path=public
as $$
declare actor uuid:=auth.uid();bucket timestamptz;current_count integer;
begin
  if actor is null then return 0;end if;
  if not public.is_household_member(target_household) then raise exception 'household membership required';end if;
  if target_action_key !~ '^[a-z0-9][a-z0-9._-]{2,79}$' or maximum_attempts not between 1 and 10000 or window_seconds not between 10 and 86400 then raise exception 'rate limit configuration is invalid';end if;
  bucket:=to_timestamp(floor(extract(epoch from clock_timestamp())/window_seconds)*window_seconds);
  insert into public.operation_rate_windows(household_id,actor_user_id,action_key,window_started_at,attempt_count,last_attempt_at)
  values(target_household,actor,target_action_key,bucket,1,clock_timestamp())
  on conflict(household_id,actor_user_id,action_key,window_started_at) do update set attempt_count=public.operation_rate_windows.attempt_count+1,last_attempt_at=clock_timestamp()
  returning attempt_count into current_count;
  if current_count>maximum_attempts then raise exception 'operation rate limit exceeded for %',target_action_key using errcode='P0001';end if;
  return current_count;
end $$;

create or replace function public.enforce_insert_rate_limit() returns trigger language plpgsql security definer set search_path=public
as $$ begin perform public.enforce_operation_rate_limit(new.household_id,tg_argv[0],tg_argv[1]::integer,tg_argv[2]::integer);return new;end $$;

create trigger rate_limit_case_messages before insert on public.case_messages for each row execute function public.enforce_insert_rate_limit('message.send',12,300);
create trigger rate_limit_learner_profiles before insert on public.learner_profiles for each row execute function public.enforce_insert_rate_limit('intake.submit',5,3600);
create trigger rate_limit_revision_requests before insert on public.revision_requests for each row execute function public.enforce_insert_rate_limit('revision.request',10,86400);
create trigger rate_limit_privacy_requests before insert on public.privacy_requests for each row execute function public.enforce_insert_rate_limit('privacy.request',3,86400);
create trigger rate_limit_deliveries before insert on public.deliveries for each row execute function public.enforce_insert_rate_limit('delivery.record',30,3600);
create trigger rate_limit_payment_events before insert on public.payment_events for each row execute function public.enforce_insert_rate_limit('payment.ingest',120,60);
create trigger rate_limit_operational_events before insert on public.operational_events for each row execute function public.enforce_insert_rate_limit('operations.record',120,60);

create or replace function public.admin_record_operational_event(target_household uuid,event_component text,event_severity text,event_code text,event_correlation_key text,event_metadata jsonb,event_occurred_at timestamptz)
returns bigint language plpgsql security definer set search_path=public
as $$
declare new_event bigint;
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;
  if char_length(btrim(event_component)) not between 2 and 80 or event_severity not in ('info','warning','error','critical') or event_code !~ '^[a-z0-9][a-z0-9._-]{2,79}$' then raise exception 'operational event fields are invalid';end if;
  if event_correlation_key is not null and char_length(btrim(event_correlation_key)) not between 8 and 120 then raise exception 'operational correlation key is invalid';end if;
  if event_metadata is null or jsonb_typeof(event_metadata)<>'object' or octet_length(event_metadata::text)>4096 then raise exception 'operational metadata is invalid';end if;
  if event_occurred_at>now()+interval '5 minutes' or event_occurred_at<now()-interval '30 days' then raise exception 'operational event time is invalid';end if;
  insert into public.operational_events(household_id,actor_user_id,component,severity,event_code,correlation_key,metadata,occurred_at)
  values(target_household,auth.uid(),btrim(event_component),event_severity,event_code,nullif(btrim(event_correlation_key),''),event_metadata,event_occurred_at) returning id into new_event;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,metadata) values(target_household,auth.uid(),'operations.event_recorded','operational_event',jsonb_build_object('operationalEventId',new_event,'component',btrim(event_component),'severity',event_severity,'eventCode',event_code));
  return new_event;
end $$;

revoke all on function public.enforce_operation_rate_limit(uuid,text,integer,integer) from public;
revoke all on function public.enforce_insert_rate_limit() from public;
revoke all on function public.admin_record_operational_event(uuid,text,text,text,text,jsonb,timestamptz) from public;
grant execute on function public.admin_record_operational_event(uuid,text,text,text,text,jsonb,timestamptz) to authenticated;
