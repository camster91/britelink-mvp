-- Privacy-minimal, household-scoped operational health signals for external monitors.

create or replace function public.admin_operational_health_snapshot(target_household uuid,evaluated_at timestamptz default now())
returns table(signal_code text,severity text,entity_count bigint,oldest_at timestamptz,threshold_seconds integer)
language plpgsql security definer set search_path=public
as $$
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;
  if evaluated_at>now()+interval '5 minutes' or evaluated_at<now()-interval '1 hour' then raise exception 'health evaluation time is invalid';end if;
  return query select health.* from (
  select 'attachment.scan_stale'::text as signal_code,'error'::text as severity,count(*) as entity_count,min(created_at) as oldest_at,900 as threshold_seconds from public.case_attachments where household_id=target_household and status='pending_scan' and created_at<evaluated_at-interval '15 minutes' having count(*)>0
  union all select 'delivery.failed','error',count(*),min(created_at),0 from public.deliveries where household_id=target_household and status in ('failed','bounced') having count(*)>0
  union all select 'message.response_overdue','warning',count(*),min(response_due_at),0 from public.case_messages where household_id=target_household and resolved_at is null and response_due_at<evaluated_at having count(*)>0
  union all select 'case.sla_overdue','critical',count(*),min(sla_due_at),0 from public.service_cases where household_id=target_household and status='overdue' having count(*)>0
  union all select 'deletion.job_due','critical',count(*),min(eligible_at),0 from public.deletion_jobs where household_id=target_household and status='scheduled' and not legal_hold and eligible_at<=evaluated_at having count(*)>0
  union all select 'payment.pending_stale','warning',count(*),min(created_at),3600 from public.orders where household_id=target_household and payment_status='pending' and created_at<evaluated_at-interval '1 hour' having count(*)>0
  union all select 'payment.case_binding_missing','error',count(*),min(o.paid_at),0 from public.orders o where o.household_id=target_household and o.payment_status='paid' and not exists(select 1 from public.service_cases sc where sc.household_id=target_household and sc.order_id=o.id) having count(*)>0
  union all select 'operations.recent_error','error',count(*),min(oe.occurred_at),900 from public.operational_events oe where oe.household_id=target_household and oe.severity in ('error','critical') and oe.occurred_at>=evaluated_at-interval '15 minutes' having count(*)>0
  ) as health
  order by case health.severity when 'critical' then 1 when 'error' then 2 else 3 end,health.signal_code;
end $$;

revoke all on function public.admin_operational_health_snapshot(uuid,timestamptz) from public;
grant execute on function public.admin_operational_health_snapshot(uuid,timestamptz) to authenticated;
