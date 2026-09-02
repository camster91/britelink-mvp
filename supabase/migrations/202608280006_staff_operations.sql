-- Staff operations are RPC-only so lifecycle rules and actor attribution cannot be bypassed.

drop policy if exists cases_staff_write on public.service_cases;
drop policy if exists plans_staff_write on public.plans;
drop policy if exists reviews_staff_access on public.plan_reviews;
drop policy if exists deliveries_staff_write on public.deliveries;

create policy reviews_staff_select on public.plan_reviews for select
using (public.has_household_role(household_id, array['educator','admin']::public.membership_role[]));

create or replace function public.staff_transition_case(
  target_household uuid,
  target_case uuid,
  next_status public.case_status,
  transition_reason text default null
) returns table(case_id uuid, previous_status public.case_status, current_status public.case_status, updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  service_case public.service_cases%rowtype;
  latest_plan public.plans%rowtype;
  allowed boolean := false;
begin
  if not public.has_household_role(target_household, array['educator','admin']::public.membership_role[]) then
    raise exception 'staff access required';
  end if;
  if transition_reason is not null and char_length(transition_reason) > 500 then raise exception 'transition reason is too long'; end if;

  select * into service_case from public.service_cases
  where id = target_case and household_id = target_household for update;
  if not found then raise exception 'case not found'; end if;

  allowed := case service_case.status
    when 'paid' then next_status in ('intake_pending','cancelled','refunded','chargeback')
    when 'intake_pending' then next_status in ('submitted','cancelled','refunded','chargeback')
    when 'submitted' then next_status in ('clarification','cancelled','refunded','chargeback')
    when 'triage' then next_status in ('clarification','assigned','on_hold','overdue')
    when 'clarification' then next_status in ('submitted','on_hold')
    when 'assigned' then next_status in ('drafting','on_hold','overdue')
    when 'drafting' then next_status in ('internal_review','on_hold','overdue')
    when 'internal_review' then next_status in ('drafting','published','on_hold')
    when 'published' then next_status = 'delivered'
    when 'delivered' then next_status in ('acknowledged','overdue')
    when 'acknowledged' then next_status in ('revision_requested','closed')
    when 'revision_requested' then next_status in ('revised','acknowledged','on_hold')
    when 'revised' then next_status in ('delivered','closed')
    when 'on_hold' then next_status in ('triage','assigned','drafting','internal_review','cancelled','refunded')
    when 'overdue' then next_status in ('triage','assigned','drafting','delivered','on_hold')
    else false
  end;
  if not allowed then raise exception 'invalid case transition from % to %', service_case.status, next_status; end if;

  if next_status = 'published' then
    select * into latest_plan from public.plans p where p.case_id=target_case order by p.version desc limit 1;
    if not found or latest_plan.status<>'internal_review' or not exists (
      select 1 from public.plan_reviews r where r.plan_id=latest_plan.id and r.approved_at is not null
        and r.curriculum_checked and r.safeguarding_checked and r.accessibility_checked and r.resource_rights_checked
    ) then raise exception 'approved internal review required'; end if;
    if exists(select 1 from public.resources r where r.plan_id=latest_plan.id and (
      (r.url is not null and (r.link_checked_at is null or r.privacy_reviewed_at is null)) or
      r.rights_reviewed_at is null or nullif(btrim(r.attribution),'') is null or nullif(btrim(r.region),'') is null or
      (r.access_type='paid' and r.estimated_cost_cents is null) or (r.requirement='required' and r.substitute_resource_id is null)
    )) then raise exception 'resource governance is incomplete'; end if;
    update public.plans p set status='archived' where p.case_id=target_case and p.status='published' and p.id<>latest_plan.id;
    update public.plans set status='published',published_at=now() where id=latest_plan.id;
  end if;

  update public.service_cases set status = next_status, updated_at = now() where id = target_case;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  values(target_household,auth.uid(),'case.transitioned','service_case',target_case,
    jsonb_build_object('from',service_case.status,'to',next_status,'reason',transition_reason));
  return query select target_case, service_case.status, next_status, now();
end $$;

create or replace function public.staff_assign_case(target_household uuid, target_case uuid, target_educator uuid)
returns table(case_id uuid, educator_user_id uuid, current_status public.case_status, updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare service_case public.service_cases%rowtype; capacity_limit integer; active_count integer;
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required'; end if;
  if not exists (
    select 1 from public.memberships where household_id=target_household and user_id=target_educator and role='educator'
  ) then raise exception 'assignee must be an educator in this household'; end if;
  select * into service_case from public.service_cases where id=target_case and household_id=target_household for update;
  if not found then raise exception 'case not found'; end if;
  if service_case.status not in ('triage','assigned','on_hold') then raise exception 'case is not assignable'; end if;
  select max_active_cases into capacity_limit from public.educator_capacities where household_id=target_household and educator_user_id=target_educator;
  if capacity_limit is null then raise exception 'educator capacity is not configured'; end if;
  select count(*) into active_count from public.service_cases where household_id=target_household and assigned_educator_id=target_educator and status in ('assigned','drafting','internal_review') and id<>target_case;
  if active_count >= capacity_limit then raise exception 'educator has reached active case capacity'; end if;
  update public.service_cases set assigned_educator_id=target_educator,status='assigned',updated_at=now() where id=target_case;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  values(target_household,auth.uid(),'case.assigned','service_case',target_case,jsonb_build_object('educatorUserId',target_educator));
  return query select target_case,target_educator,'assigned'::public.case_status,now();
end $$;

create or replace function public.staff_review_plan(
  target_household uuid, target_plan uuid,
  curriculum_checked boolean, safeguarding_checked boolean,
  accessibility_checked boolean, resource_rights_checked boolean,
  review_notes text default null
) returns table(review_id uuid, approved boolean, reviewed_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare plan_row public.plans%rowtype; new_review uuid; is_approved boolean;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required'; end if;
  if review_notes is not null and char_length(review_notes)>4000 then raise exception 'review notes are too long'; end if;
  select * into plan_row from public.plans where id=target_plan and household_id=target_household for update;
  if not found then raise exception 'plan not found'; end if;
  if plan_row.status not in ('draft','internal_review') then raise exception 'plan is not reviewable'; end if;
  is_approved := curriculum_checked and safeguarding_checked and accessibility_checked and resource_rights_checked;
  insert into public.plan_reviews(household_id,plan_id,reviewer_user_id,curriculum_checked,safeguarding_checked,accessibility_checked,resource_rights_checked,notes,approved_at)
  values(target_household,target_plan,auth.uid(),curriculum_checked,safeguarding_checked,accessibility_checked,resource_rights_checked,review_notes,case when is_approved then now() end)
  returning id into new_review;
  update public.plans set status='internal_review',reviewed_by=case when is_approved then auth.uid() else reviewed_by end where id=target_plan;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  values(target_household,auth.uid(),case when is_approved then 'plan_review.approved' else 'plan_review.saved' end,'plan_review',new_review,jsonb_build_object('planId',target_plan));
  return query select new_review,is_approved,now();
end $$;

create or replace function public.staff_decide_revision(target_household uuid,target_revision uuid,decision text,decision_reason text default null)
returns table(revision_id uuid,current_status text,decided_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare revision_row public.revision_requests%rowtype;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required'; end if;
  if decision not in ('accepted','declined') then raise exception 'decision must be accepted or declined'; end if;
  if decision='declined' and nullif(btrim(decision_reason),'') is null then raise exception 'decline reason is required'; end if;
  if decision_reason is not null and char_length(decision_reason)>2000 then raise exception 'decision reason is too long'; end if;
  select * into revision_row from public.revision_requests where id=target_revision and household_id=target_household and status='requested' for update;
  if not found then raise exception 'open revision not found'; end if;
  update public.revision_requests set status=decision,decided_by=auth.uid(),decided_at=now(),disposition_reason=nullif(btrim(decision_reason),'') where id=target_revision;
  if decision='declined' then update public.service_cases set status='acknowledged',updated_at=now() where id=revision_row.case_id and status='revision_requested'; end if;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  values(target_household,auth.uid(),'revision.'||decision,'revision',target_revision,jsonb_build_object('reason',decision_reason));
  return query select target_revision,decision,now();
end $$;

revoke all on function public.staff_transition_case(uuid,uuid,public.case_status,text) from public;
revoke all on function public.staff_assign_case(uuid,uuid,uuid) from public;
revoke all on function public.staff_review_plan(uuid,uuid,boolean,boolean,boolean,boolean,text) from public;
revoke all on function public.staff_decide_revision(uuid,uuid,text,text) from public;
grant execute on function public.staff_transition_case(uuid,uuid,public.case_status,text) to authenticated;
grant execute on function public.staff_assign_case(uuid,uuid,uuid) to authenticated;
grant execute on function public.staff_review_plan(uuid,uuid,boolean,boolean,boolean,boolean,text) to authenticated;
grant execute on function public.staff_decide_revision(uuid,uuid,text,text) to authenticated;
