-- Guardian delivery, revision, export, and deletion-request actions.
drop policy if exists revisions_guardian_insert on public.revision_requests;
-- Guardian revision creation is RPC-only so package entitlement cannot be bypassed.

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  kind text not null check (kind in ('deletion')),
  status text not null default 'pending' check (status in ('pending','verified','scheduled','completed','declined','cancelled')),
  reason text check (char_length(reason) <= 1000),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_note text check (char_length(resolution_note) <= 2000)
);
create unique index privacy_requests_one_open_household_kind on public.privacy_requests(household_id,kind) where status in ('pending','verified','scheduled');
alter table public.privacy_requests enable row level security;
create policy privacy_requests_guardian_select on public.privacy_requests for select using (public.has_household_role(household_id,array['guardian','admin']::public.membership_role[]));
create policy privacy_requests_admin_update on public.privacy_requests for update using (public.has_household_role(household_id,array['admin']::public.membership_role[])) with check (public.has_household_role(household_id,array['admin']::public.membership_role[]));

create or replace function public.acknowledge_guardian_delivery(target_household uuid,target_delivery uuid)
returns table(delivery_id uuid,case_id uuid,acknowledged_at timestamptz)
language plpgsql security definer set search_path=public,auth
as $$
declare related_case uuid; acknowledged timestamptz:=now();
begin
  if auth.uid() is null or not public.has_household_role(target_household,array['guardian']::public.membership_role[]) then raise exception 'guardian access required' using errcode='42501'; end if;
  update public.deliveries set status='acknowledged',acknowledged_at=acknowledged where id=target_delivery and household_id=target_household and status='sent' returning deliveries.case_id into related_case;
  if not found then raise exception 'sent delivery not found in household' using errcode='42501'; end if;
  update public.service_cases set status='acknowledged',acknowledged_at=acknowledged,updated_at=acknowledged where id=related_case and household_id=target_household and status in ('delivered','overdue');
  if not found then raise exception 'delivery case is not awaiting acknowledgement' using errcode='22023'; end if;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'delivery.acknowledged','delivery',target_delivery,jsonb_build_object('case_id',related_case));
  return query select target_delivery,related_case,acknowledged;
end $$;

create or replace function public.request_guardian_revision(target_household uuid,target_case uuid,request_reason text)
returns table(revision_id uuid,entitlement_index integer,remaining_revisions integer)
language plpgsql security definer set search_path=public,auth
as $$
declare package text; current_status public.case_status; allowance integer; used integer; new_revision uuid;
begin
  if auth.uid() is null or not public.has_household_role(target_household,array['guardian']::public.membership_role[]) then raise exception 'guardian access required' using errcode='42501'; end if;
  if request_reason is null or char_length(btrim(request_reason)) not between 1 and 2000 then raise exception 'revision reason is required' using errcode='22023'; end if;
  select package_code,status into package,current_status from public.service_cases where id=target_case and household_id=target_household for update;
  if not found then raise exception 'case not found in household' using errcode='42501'; end if;
  if current_status <> 'acknowledged' then raise exception 'delivery must be acknowledged before requesting a revision' using errcode='22023'; end if;
  allowance:=case package when 'essentials' then 0 when 'complete' then 1 when 'annual' then 4 else 0 end;
  select count(*)::integer into used from public.revision_requests where case_id=target_case and status <> 'declined';
  if used>=allowance then raise exception 'no included revisions remain' using errcode='22023'; end if;
  insert into public.revision_requests(household_id,case_id,requested_by,reason,entitlement_index,status) values(target_household,target_case,auth.uid(),btrim(request_reason),used+1,'requested') returning id into new_revision;
  update public.service_cases set status='revision_requested',updated_at=now() where id=target_case;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'revision.requested','revision',new_revision,jsonb_build_object('case_id',target_case,'entitlement_index',used+1,'remaining',allowance-used-1));
  return query select new_revision,used+1,allowance-used-1;
end $$;

create or replace function public.export_guardian_household(target_household uuid)
returns jsonb language plpgsql security definer set search_path=public,auth
as $$
declare payload jsonb;
begin
  if auth.uid() is null or not public.has_household_role(target_household,array['guardian']::public.membership_role[]) then raise exception 'guardian access required' using errcode='42501'; end if;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'privacy.exported','household',target_household,jsonb_build_object('format','json','scope','household'));
  select jsonb_build_object(
    'exportedAt',now(),'household',(select to_jsonb(h)-'deleted_at' from public.households h where h.id=target_household),
    'learners',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id,preferred_name,grade_label,jurisdiction,created_at,updated_at,deleted_at from public.learners where household_id=target_household) row_data),'[]'::jsonb),
    'profiles',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.version) from (select id,learner_id,version,planning_context,submitted_at,created_at from public.learner_profiles where household_id=target_household) row_data),'[]'::jsonb),
    'consents',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.consented_at) from (select id,learner_id,notice_version,purposes,consented_at,withdrawn_at from public.guardian_consents where household_id=target_household) row_data),'[]'::jsonb),
    'cases',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id,learner_id,package_code,status,intake_received_at,sla_due_at,acknowledged_at,closed_at,created_at,updated_at from public.service_cases where household_id=target_household) row_data),'[]'::jsonb),
    'plans',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id,case_id,learner_id,version,status,published_at,created_at from public.plans where household_id=target_household) row_data),'[]'::jsonb),
    'lessonActivities',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.updated_at) from (select id,learner_id,lesson_id,status,caregiver_note,schedule_reason,scheduled_for,updated_at from public.lesson_activities where household_id=target_household) row_data),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id,case_id,sender_user_id,kind,body,response_due_at,resolved_at,created_at from public.case_messages where household_id=target_household) row_data),'[]'::jsonb),
    'deliveries',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id,case_id,plan_id,plan_version,channel,status,attempt_count,sent_at,acknowledged_at,created_at from public.deliveries where household_id=target_household) row_data),'[]'::jsonb),
    'revisions',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id,case_id,reason,entitlement_index,status,disposition_reason,change_summary,created_at,completed_at from public.revision_requests where household_id=target_household) row_data),'[]'::jsonb),
    'privacyRequests',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id,kind,status,reason,created_at,resolved_at,resolution_note from public.privacy_requests where household_id=target_household) row_data),'[]'::jsonb)
  ) into payload;
  return payload;
end $$;

create or replace function public.request_guardian_household_deletion(target_household uuid,request_reason text default null)
returns table(request_id uuid,request_status text,created_at timestamptz)
language plpgsql security definer set search_path=public,auth
as $$
declare existing public.privacy_requests%rowtype; created public.privacy_requests%rowtype;
begin
  if auth.uid() is null or not public.has_household_role(target_household,array['guardian']::public.membership_role[]) then raise exception 'guardian access required' using errcode='42501'; end if;
  if request_reason is not null and char_length(btrim(request_reason))>1000 then raise exception 'deletion request reason is too long' using errcode='22023'; end if;
  select pr.* into existing from public.privacy_requests pr where pr.household_id=target_household and pr.kind='deletion' and pr.status in ('pending','verified','scheduled') order by pr.created_at desc limit 1;
  if found then return query select existing.id,existing.status,existing.created_at; return; end if;
  insert into public.privacy_requests(household_id,requested_by,kind,status,reason) values(target_household,auth.uid(),'deletion','pending',nullif(btrim(request_reason),'')) returning * into created;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'privacy.deletion_requested','privacy_request',created.id,jsonb_build_object('status','pending'));
  return query select created.id,created.status,created.created_at;
end $$;

revoke all on function public.acknowledge_guardian_delivery(uuid,uuid) from public;
revoke all on function public.request_guardian_revision(uuid,uuid,text) from public;
revoke all on function public.export_guardian_household(uuid) from public;
revoke all on function public.request_guardian_household_deletion(uuid,text) from public;
grant execute on function public.acknowledge_guardian_delivery(uuid,uuid),public.request_guardian_revision(uuid,uuid,text),public.export_guardian_household(uuid),public.request_guardian_household_deletion(uuid,text) to authenticated;
