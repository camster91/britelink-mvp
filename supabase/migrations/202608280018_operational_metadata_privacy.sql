-- Restrict operational metadata to bounded, non-content diagnostic dimensions.

create or replace function public.operational_metadata_is_safe(candidate jsonb)
returns boolean language plpgsql immutable set search_path=public
as $$
declare entry record;
begin
  if candidate is null or jsonb_typeof(candidate)<>'object' or octet_length(candidate::text)>4096 then return false;end if;
  for entry in select key,value from jsonb_each(candidate) loop
    if entry.key not in ('operation','provider','statusCode','errorCode','attemptCount','durationBucket','queueDepth','objectCount','retryable','region') then return false;end if;
    if jsonb_typeof(entry.value) not in ('string','number','boolean','null') then return false;end if;
    if jsonb_typeof(entry.value)='string' and char_length(entry.value#>>'{}')>120 then return false;end if;
  end loop;
  return true;
end $$;

alter table public.operational_events add constraint operational_events_safe_metadata check(public.operational_metadata_is_safe(metadata));

create or replace function public.admin_record_operational_event(target_household uuid,event_component text,event_severity text,event_code text,event_correlation_key text,event_metadata jsonb,event_occurred_at timestamptz)
returns bigint language plpgsql security definer set search_path=public
as $$
declare new_event bigint;
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;
  if char_length(btrim(event_component)) not between 2 and 80 or event_severity not in ('info','warning','error','critical') or event_code !~ '^[a-z0-9][a-z0-9._-]{2,79}$' then raise exception 'operational event fields are invalid';end if;
  if event_correlation_key is not null and char_length(btrim(event_correlation_key)) not between 8 and 120 then raise exception 'operational correlation key is invalid';end if;
  if not public.operational_metadata_is_safe(event_metadata) then raise exception 'operational metadata is invalid';end if;
  if event_occurred_at>now()+interval '5 minutes' or event_occurred_at<now()-interval '30 days' then raise exception 'operational event time is invalid';end if;
  insert into public.operational_events(household_id,actor_user_id,component,severity,event_code,correlation_key,metadata,occurred_at)
  values(target_household,auth.uid(),btrim(event_component),event_severity,event_code,nullif(btrim(event_correlation_key),''),event_metadata,event_occurred_at) returning id into new_event;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,metadata) values(target_household,auth.uid(),'operations.event_recorded','operational_event',jsonb_build_object('operationalEventId',new_event,'component',btrim(event_component),'severity',event_severity,'eventCode',event_code));
  return new_event;
end $$;

revoke all on function public.operational_metadata_is_safe(jsonb) from public;
revoke all on function public.admin_record_operational_event(uuid,text,text,text,text,jsonb,timestamptz) from public;
grant execute on function public.admin_record_operational_event(uuid,text,text,text,text,jsonb,timestamptz) to authenticated;
