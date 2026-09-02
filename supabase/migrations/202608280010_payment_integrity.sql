-- Idempotent, privacy-minimal payment event ingestion. Provider signature verification belongs at the webhook edge.

alter table public.orders add column updated_at timestamptz not null default now();
alter table public.orders add column last_event_at timestamptz;
drop policy if exists orders_admin_write on public.orders;

create table public.payment_events(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  provider_event_key text not null unique check(char_length(provider_event_key) between 8 and 200),
  external_checkout_id text not null check(char_length(external_checkout_id) between 3 and 200),
  payment_status text not null check(payment_status in ('pending','paid','refunded','chargeback')),
  package_code text not null check(package_code in ('essentials','complete','annual')),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  amount_cents integer not null check(amount_cents>=0),
  occurred_at timestamptz not null,
  processed_at timestamptz not null default now()
);
alter table public.payment_events enable row level security;
create policy payment_events_admin_select on public.payment_events for select using(public.has_household_role(household_id,array['admin']::public.membership_role[]));
create index payment_events_case_occurred_idx on public.payment_events(case_id,occurred_at desc);

create or replace function public.admin_ingest_payment_event(
  target_household uuid,target_case uuid,provider_event_key text,external_checkout_id text,
  event_package_code text,event_payment_status text,event_currency text,event_amount_cents integer,event_occurred_at timestamptz
) returns table(order_id uuid,payment_event_id uuid,payment_status text,case_status public.case_status,already_processed boolean)
language plpgsql security definer set search_path=public
as $$
declare service_case public.service_cases%rowtype;existing_event public.payment_events%rowtype;order_row public.orders%rowtype;new_event uuid;next_case_status public.case_status;
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;
  if char_length(btrim(provider_event_key)) not between 8 and 200 or char_length(btrim(external_checkout_id)) not between 3 and 200 then raise exception 'payment event identifiers are invalid';end if;
  if event_package_code not in ('essentials','complete','annual') or event_payment_status not in ('pending','paid','refunded','chargeback') or event_currency !~ '^[A-Z]{3}$' or event_amount_cents<0 or event_amount_cents>100000000 then raise exception 'payment event fields are invalid';end if;
  if event_occurred_at>now()+interval '5 minutes' then raise exception 'payment event time cannot be in the future';end if;
  select * into service_case from public.service_cases where id=target_case and household_id=target_household for update;if not found then raise exception 'case not found';end if;if service_case.package_code<>event_package_code then raise exception 'payment package does not match case';end if;
  select * into existing_event from public.payment_events pe where pe.provider_event_key=btrim(admin_ingest_payment_event.provider_event_key);
  if found then
    if existing_event.household_id<>target_household or existing_event.case_id<>target_case or existing_event.external_checkout_id<>btrim(external_checkout_id) or existing_event.payment_status<>event_payment_status or existing_event.package_code<>event_package_code or existing_event.currency<>upper(event_currency) or existing_event.amount_cents<>event_amount_cents or existing_event.occurred_at<>event_occurred_at then raise exception 'payment event replay mismatch';end if;
    return query select existing_event.order_id,existing_event.id,existing_event.payment_status,service_case.status,true;return;
  end if;
  select * into order_row from public.orders o where o.external_checkout_id=btrim(admin_ingest_payment_event.external_checkout_id) for update;
  if found then
    if order_row.household_id<>target_household or order_row.package_code<>event_package_code or order_row.currency<>upper(event_currency) or order_row.amount_cents<>event_amount_cents then raise exception 'payment event does not match existing order';end if;
    if order_row.last_event_at is not null and event_occurred_at<order_row.last_event_at then raise exception 'stale payment event';end if;
    if order_row.payment_status in ('refunded','chargeback') and order_row.payment_status<>event_payment_status then raise exception 'terminal payment state cannot change';end if;
    if order_row.payment_status='pending' and event_payment_status in ('refunded','chargeback') then raise exception 'unpaid order cannot be refunded or charged back';end if;
    update public.orders set payment_status=event_payment_status,paid_at=case when event_payment_status='paid' then coalesce(paid_at,event_occurred_at) else paid_at end,last_event_at=event_occurred_at,updated_at=now() where id=order_row.id returning * into order_row;
  else
    if event_payment_status in ('refunded','chargeback') then raise exception 'terminal payment event requires an existing paid order';end if;
    insert into public.orders(household_id,external_checkout_id,package_code,payment_status,currency,amount_cents,paid_at,last_event_at) values(target_household,btrim(external_checkout_id),event_package_code,event_payment_status,upper(event_currency),event_amount_cents,case when event_payment_status='paid' then event_occurred_at end,event_occurred_at) returning * into order_row;
  end if;
  if service_case.order_id is not null and service_case.order_id<>order_row.id then raise exception 'case is already bound to another order';end if;
  next_case_status:=service_case.status;
  if event_payment_status='paid' then update public.service_cases set order_id=order_row.id,status=case when status='paid' then 'paid'::public.case_status else status end,updated_at=now() where id=target_case;
  elsif event_payment_status in ('refunded','chargeback') and service_case.status not in ('closed','cancelled','refunded','chargeback') then next_case_status:=event_payment_status::public.case_status;update public.service_cases set order_id=order_row.id,status=next_case_status,status_reason='Payment '||event_payment_status,updated_at=now() where id=target_case;end if;
  insert into public.payment_events(household_id,case_id,order_id,provider_event_key,external_checkout_id,payment_status,package_code,currency,amount_cents,occurred_at) values(target_household,target_case,order_row.id,btrim(provider_event_key),btrim(external_checkout_id),event_payment_status,event_package_code,upper(event_currency),event_amount_cents,event_occurred_at) returning id into new_event;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'payment.status_ingested','payment_event',new_event,jsonb_build_object('caseId',target_case,'orderId',order_row.id,'providerEventKey',btrim(provider_event_key),'paymentStatus',event_payment_status,'amountCents',event_amount_cents,'currency',upper(event_currency),'occurredAt',event_occurred_at));
  select status into next_case_status from public.service_cases where id=target_case;return query select order_row.id,new_event,event_payment_status,next_case_status,false;
end $$;

revoke all on function public.admin_ingest_payment_event(uuid,uuid,text,text,text,text,text,integer,timestamptz) from public;
grant execute on function public.admin_ingest_payment_event(uuid,uuid,text,text,text,text,text,integer,timestamptz) to authenticated;
