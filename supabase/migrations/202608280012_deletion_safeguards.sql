-- Reviewed deletion scheduling. Physical deletion remains a separately approved service job.

create table public.deletion_jobs(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  privacy_request_id uuid not null unique references public.privacy_requests(id) on delete cascade,
  status text not null check(status in ('scheduled','cancelled','running','completed','failed')),
  eligible_at timestamptz not null,
  approved_by uuid not null references auth.users(id),
  approval_basis text not null check(char_length(approval_basis) between 10 and 2000),
  identity_verified boolean not null,
  co_guardian_reviewed boolean not null,
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text check(cancellation_reason is null or char_length(cancellation_reason) between 1 and 1000),
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text check(failure_code is null or char_length(failure_code) between 2 and 80),
  check(status<>'scheduled' or (identity_verified and co_guardian_reviewed and not legal_hold))
);
alter table public.deletion_jobs enable row level security;
create policy deletion_jobs_admin_select on public.deletion_jobs for select using(public.has_household_role(household_id,array['admin']::public.membership_role[]));
create index deletion_jobs_due_idx on public.deletion_jobs(eligible_at) where status='scheduled' and not legal_hold;

create or replace function public.admin_schedule_household_deletion(target_household uuid,target_request uuid,deletion_eligible_at timestamptz,retention_basis text,identity_verified boolean,co_guardian_reviewed boolean)
returns table(deletion_job_id uuid,request_status text,job_status text,eligible_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare request_row public.privacy_requests%rowtype;new_job uuid;
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;
  if identity_verified is not true or co_guardian_reviewed is not true then raise exception 'identity and co-guardian safeguards are required';end if;
  if deletion_eligible_at<now()+interval '24 hours' or deletion_eligible_at>now()+interval '7 years' then raise exception 'deletion eligibility time is invalid';end if;
  if char_length(btrim(retention_basis)) not between 10 and 2000 then raise exception 'retention basis is required';end if;
  select * into request_row from public.privacy_requests where id=target_request and household_id=target_household and kind='deletion' and status in ('pending','verified') for update;if not found then raise exception 'open deletion request not found';end if;
  if request_row.requested_by=auth.uid() then raise exception 'requester cannot approve deletion';end if;
  insert into public.deletion_jobs(household_id,privacy_request_id,status,eligible_at,approved_by,approval_basis,identity_verified,co_guardian_reviewed)
  values(target_household,target_request,'scheduled',deletion_eligible_at,auth.uid(),btrim(retention_basis),true,true) returning id into new_job;
  update public.privacy_requests set status='scheduled',resolved_by=auth.uid(),resolution_note='Deletion scheduled after identity, co-guardian, and retention review' where id=target_request;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'privacy.deletion_scheduled','deletion_job',new_job,jsonb_build_object('privacyRequestId',target_request,'eligibleAt',deletion_eligible_at,'identityVerified',true,'coGuardianReviewed',true));
  return query select new_job,'scheduled','scheduled',deletion_eligible_at;
end $$;

create or replace function public.admin_cancel_household_deletion(target_household uuid,target_job uuid,cancel_reason text)
returns table(deletion_job_id uuid,job_status text,cancelled_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare job_row public.deletion_jobs%rowtype;cancelled timestamptz:=now();
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;
  if char_length(btrim(cancel_reason)) not between 1 and 1000 then raise exception 'cancellation reason is required';end if;
  select * into job_row from public.deletion_jobs where id=target_job and household_id=target_household and status='scheduled' for update;if not found then raise exception 'scheduled deletion job not found';end if;
  update public.deletion_jobs set status='cancelled',cancelled_by=auth.uid(),cancelled_at=cancelled,cancellation_reason=btrim(cancel_reason) where id=target_job;
  update public.privacy_requests set status='cancelled',resolved_by=auth.uid(),resolved_at=cancelled,resolution_note='Deletion schedule cancelled: '||btrim(cancel_reason) where id=job_row.privacy_request_id;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'privacy.deletion_cancelled','deletion_job',target_job,jsonb_build_object('privacyRequestId',job_row.privacy_request_id,'reason',btrim(cancel_reason)));
  return query select target_job,'cancelled',cancelled;
end $$;

revoke all on function public.admin_schedule_household_deletion(uuid,uuid,timestamptz,text,boolean,boolean) from public;
revoke all on function public.admin_cancel_household_deletion(uuid,uuid,text) from public;
grant execute on function public.admin_schedule_household_deletion(uuid,uuid,timestamptz,text,boolean,boolean) to authenticated;
grant execute on function public.admin_cancel_household_deletion(uuid,uuid,text) to authenticated;
