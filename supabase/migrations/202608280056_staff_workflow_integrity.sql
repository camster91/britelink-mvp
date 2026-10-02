-- 056: staff workflow fixes from the 2026-10-02 full-app review.
--
-- 1. A revision can only end the real way.
--    staff_transition_case (006) let staff move revision_requested -> revised or -> acknowledged
--    directly. "revised" then let the OLD published plan be delivered again as if it were the
--    revision, and "acknowledged" skipped the decline reason, leaving the family's request open
--    and still counted against their included revisions. Now:
--      - -> revised needs a completed revision request whose new plan is the published plan
--        (staff_complete_revision marks the request completed before it moves the case);
--      - -> acknowledged needs the latest revision request to be declined
--        (staff_decide_revision records the decline, with its reason, before it moves the case).
--
-- 2. Overdue marking flags the cases that are actually late.
--    staff_mark_overdue_cases (008) included 'delivered', so a plan delivered on time was flagged
--    overdue (a critical alert) once its SLA date passed, and left out 'internal_review', so a plan
--    stuck in review was never flagged. Delivered cases are no longer marked; internal review is.

-- 1 ---------------------------------------------------------------------------------------------
create or replace function public.enforce_revision_outcome()
returns trigger
language plpgsql set search_path = public
as $function$
begin
  if old.status = 'revision_requested' and new.status = 'revised' and not exists (
    select 1 from public.revision_requests rr join public.plans p on p.id = rr.completed_plan_id
    where rr.case_id = new.id and rr.status = 'completed' and p.status = 'published'
  ) then
    raise exception 'complete the revision with a new approved plan first';
  end if;
  if old.status = 'revision_requested' and new.status = 'acknowledged' and not exists (
    select 1 from (
      select rr.status from public.revision_requests rr
      where rr.case_id = new.id order by rr.created_at desc, rr.id desc limit 1
    ) latest where latest.status = 'declined'
  ) then
    raise exception 'decline the revision request with a reason first';
  end if;
  return new;
end $function$;
revoke all on function public.enforce_revision_outcome() from public, anon, authenticated;

drop trigger if exists service_cases_revision_outcome on public.service_cases;
create trigger service_cases_revision_outcome
  before update of status on public.service_cases
  for each row execute function public.enforce_revision_outcome();

-- 2 ---------------------------------------------------------------------------------------------
create or replace function public.staff_mark_overdue_cases(target_household uuid,evaluated_at timestamptz default now())
returns table(case_id uuid,previous_status public.case_status,current_status public.case_status,sla_due_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare item record;
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;if evaluated_at>now()+interval '5 minutes' then raise exception 'evaluation time cannot be in the future';end if;
  for item in select sc.id,sc.status,sc.sla_due_at from public.service_cases sc where sc.household_id=target_household and sc.sla_due_at is not null and sc.sla_due_at<evaluated_at and sc.status in ('triage','assigned','drafting','internal_review') for update loop
    update public.service_cases set status='overdue',previous_operational_status=item.status,status_reason='SLA due time passed',updated_at=now() where id=item.id;
    insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'case.marked_overdue','service_case',item.id,jsonb_build_object('from',item.status,'slaDueAt',item.sla_due_at,'evaluatedAt',evaluated_at));
    case_id:=item.id;previous_status:=item.status;current_status:='overdue';sla_due_at:=item.sla_due_at;return next;
  end loop;
end $$;
revoke all on function public.staff_mark_overdue_cases(uuid,timestamptz) from public;
grant execute on function public.staff_mark_overdue_cases(uuid,timestamptz) to authenticated;
