-- Revision completion, server-owned messaging, and operational exception controls.

alter table public.service_cases add column status_reason text check(char_length(status_reason)<=500);
alter table public.service_cases add column previous_operational_status public.case_status;

drop policy if exists messages_member_insert on public.case_messages;

create or replace function public.send_case_message(target_household uuid,target_case uuid,message_kind text,message_body text)
returns table(message_id uuid,response_owner_user_id uuid,response_due_at timestamptz,created_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare member_role public.membership_role; service_case public.service_cases%rowtype; owner_id uuid; new_message uuid; due_at timestamptz;
begin
  select role into member_role from public.memberships where household_id=target_household and user_id=auth.uid();if not found then raise exception 'household membership required';end if;
  select * into service_case from public.service_cases where id=target_case and household_id=target_household;if not found then raise exception 'case not found';end if;
  if message_kind not in ('general','clarification','revision','service') then raise exception 'invalid message kind';end if;
  if char_length(btrim(message_body)) not between 1 and 4000 then raise exception 'message body is invalid';end if;
  if member_role='guardian' then owner_id:=coalesce(service_case.assigned_educator_id,(select m.user_id from public.memberships m where m.household_id=target_household and m.role='admin' order by m.created_at limit 1));
  else owner_id:=(select m.user_id from public.memberships m where m.household_id=target_household and m.role='guardian' order by m.created_at limit 1);end if;
  due_at:=case when owner_id is not null then now()+interval '2 days' end;
  insert into public.case_messages(household_id,case_id,sender_user_id,kind,body,response_owner_user_id,response_due_at) values(target_household,target_case,auth.uid(),message_kind,btrim(message_body),owner_id,due_at) returning id into new_message;
  insert into public.case_message_reads(household_id,message_id,user_id) values(target_household,new_message,auth.uid());
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'message.sent','message',new_message,jsonb_build_object('caseId',target_case,'kind',message_kind,'responseOwnerId',owner_id,'responseDueAt',due_at));
  return query select new_message,owner_id,due_at,now();
end $$;

create or replace function public.staff_resolve_case_message(target_household uuid,target_message uuid)
returns table(message_id uuid,resolved_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare message_row public.case_messages%rowtype; is_admin boolean;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required';end if;
  select * into message_row from public.case_messages m where m.id=target_message and m.household_id=target_household and m.resolved_at is null for update;if not found then raise exception 'open message not found';end if;
  is_admin:=public.has_household_role(target_household,array['admin']::public.membership_role[]);if message_row.response_owner_user_id is distinct from auth.uid() and not is_admin then raise exception 'response owner or admin required';end if;
  update public.case_messages set resolved_at=now() where id=target_message;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'message.resolved','message',target_message,jsonb_build_object('caseId',message_row.case_id));
  return query select target_message,now();
end $$;

create or replace function public.staff_complete_revision(target_household uuid,target_revision uuid,revision_change_summary text)
returns table(revision_id uuid,completed_plan_id uuid,plan_version integer,completed_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare revision_row public.revision_requests%rowtype; latest_plan public.plans%rowtype; prior_version integer;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required';end if;
  if char_length(btrim(revision_change_summary)) not between 1 and 4000 then raise exception 'change summary is required';end if;
  select * into revision_row from public.revision_requests where id=target_revision and household_id=target_household and status='accepted' for update;if not found then raise exception 'accepted revision not found';end if;
  select coalesce(max(d.plan_version),0) into prior_version from public.deliveries d where d.case_id=revision_row.case_id and d.status in ('sent','acknowledged');
  select * into latest_plan from public.plans p where p.case_id=revision_row.case_id order by p.version desc limit 1;if not found or latest_plan.version<=prior_version then raise exception 'new plan version required';end if;
  if latest_plan.status<>'internal_review' or not exists(select 1 from public.plan_reviews r where r.plan_id=latest_plan.id and r.approved_at is not null and r.curriculum_checked and r.safeguarding_checked and r.accessibility_checked and r.resource_rights_checked) then raise exception 'approved revised plan required';end if;
  if exists(select 1 from public.resources r where r.plan_id=latest_plan.id and ((r.url is not null and (r.link_checked_at is null or r.privacy_reviewed_at is null)) or r.rights_reviewed_at is null or nullif(btrim(r.attribution),'') is null or nullif(btrim(r.region),'') is null or (r.access_type='paid' and r.estimated_cost_cents is null) or (r.requirement='required' and r.substitute_resource_id is null))) then raise exception 'resource governance is incomplete';end if;
  update public.plans p set status='archived' where p.case_id=revision_row.case_id and p.status='published';update public.plans set status='published',published_at=now() where id=latest_plan.id;
  update public.revision_requests set status='completed',completed_plan_id=latest_plan.id,change_summary=btrim(revision_change_summary),completed_at=now() where id=target_revision;
  update public.service_cases set status='revised',status_reason='Approved revision completed',updated_at=now() where id=revision_row.case_id;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'revision.completed','revision',target_revision,jsonb_build_object('planId',latest_plan.id,'planVersion',latest_plan.version,'changeSummary',btrim(revision_change_summary)));
  return query select target_revision,latest_plan.id,latest_plan.version,now();
end $$;

create or replace function public.staff_record_educator_absence(target_household uuid,target_case uuid,absence_reason text)
returns table(case_id uuid,previous_status public.case_status,current_status public.case_status,updated_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare service_case public.service_cases%rowtype;
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;if char_length(btrim(absence_reason)) not between 1 and 500 then raise exception 'absence reason is required';end if;
  select * into service_case from public.service_cases where id=target_case and household_id=target_household and status in ('assigned','drafting','internal_review') for update;if not found then raise exception 'educator-owned case not found';end if;
  update public.service_cases set status='on_hold',previous_operational_status=service_case.status,status_reason=btrim(absence_reason),assigned_educator_id=null,updated_at=now() where id=target_case;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'educator.absence_recorded','service_case',target_case,jsonb_build_object('from',service_case.status,'reason',btrim(absence_reason)));
  return query select target_case,service_case.status,'on_hold'::public.case_status,now();
end $$;

create or replace function public.staff_mark_overdue_cases(target_household uuid,evaluated_at timestamptz default now())
returns table(case_id uuid,previous_status public.case_status,current_status public.case_status,sla_due_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare item record;
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;if evaluated_at>now()+interval '5 minutes' then raise exception 'evaluation time cannot be in the future';end if;
  for item in select sc.id,sc.status,sc.sla_due_at from public.service_cases sc where sc.household_id=target_household and sc.sla_due_at is not null and sc.sla_due_at<evaluated_at and sc.status in ('triage','assigned','drafting','delivered') for update loop
    update public.service_cases set status='overdue',previous_operational_status=item.status,status_reason='SLA due time passed',updated_at=now() where id=item.id;
    insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'case.marked_overdue','service_case',item.id,jsonb_build_object('from',item.status,'slaDueAt',item.sla_due_at,'evaluatedAt',evaluated_at));
    case_id:=item.id;previous_status:=item.status;current_status:='overdue';sla_due_at:=item.sla_due_at;return next;
  end loop;
end $$;

revoke all on function public.send_case_message(uuid,uuid,text,text) from public;revoke all on function public.staff_resolve_case_message(uuid,uuid) from public;revoke all on function public.staff_complete_revision(uuid,uuid,text) from public;revoke all on function public.staff_record_educator_absence(uuid,uuid,text) from public;revoke all on function public.staff_mark_overdue_cases(uuid,timestamptz) from public;
grant execute on function public.send_case_message(uuid,uuid,text,text) to authenticated;grant execute on function public.staff_resolve_case_message(uuid,uuid) to authenticated;grant execute on function public.staff_complete_revision(uuid,uuid,text) to authenticated;grant execute on function public.staff_record_educator_absence(uuid,uuid,text) to authenticated;grant execute on function public.staff_mark_overdue_cases(uuid,timestamptz) to authenticated;
