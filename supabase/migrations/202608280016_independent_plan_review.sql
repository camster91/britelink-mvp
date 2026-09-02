-- Enforce separation of duties for the safeguarding and curriculum publication gate.

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
  if plan_row.authored_by=auth.uid() then raise exception 'plan author cannot review their own plan'; end if;
  is_approved := curriculum_checked and safeguarding_checked and accessibility_checked and resource_rights_checked;
  insert into public.plan_reviews(household_id,plan_id,reviewer_user_id,curriculum_checked,safeguarding_checked,accessibility_checked,resource_rights_checked,notes,approved_at)
  values(target_household,target_plan,auth.uid(),curriculum_checked,safeguarding_checked,accessibility_checked,resource_rights_checked,review_notes,case when is_approved then now() end)
  returning id into new_review;
  update public.plans set status='internal_review',reviewed_by=case when is_approved then auth.uid() else reviewed_by end where id=target_plan;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  values(target_household,auth.uid(),case when is_approved then 'plan_review.approved' else 'plan_review.saved' end,'plan_review',new_review,jsonb_build_object('planId',target_plan,'authorId',plan_row.authored_by));
  return query select new_review,is_approved,now();
end $$;

revoke all on function public.staff_review_plan(uuid,uuid,boolean,boolean,boolean,boolean,text) from public;
grant execute on function public.staff_review_plan(uuid,uuid,boolean,boolean,boolean,boolean,text) to authenticated;
