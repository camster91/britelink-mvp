-- 055: a case can only become "revised" from an open revision request (2026-10-02 review).
--
-- staff_complete_revision (008) set the case to 'revised' without looking at the case's own
-- status, so it could restart a case that was on hold because the guardian withdrew consent (054),
-- or one in chargeback/cancelled/refunded, publish a new plan, and let it be delivered again.
-- During a real revision the case stays 'revision_requested' (submit_revision_request, 005;
-- staff_create_plan_version keeps it there, 007/044), so that is the only status a case may move
-- to 'revised' from. A trigger covers both paths (staff_complete_revision and
-- staff_transition_case) without rewriting either; the RPC's earlier writes roll back with it.
create or replace function public.enforce_revision_from_request()
returns trigger
language plpgsql set search_path = public
as $function$
begin
  if new.status = 'revised' and old.status is distinct from 'revised' and old.status <> 'revision_requested' then
    raise exception 'only a case with an open revision request can be marked revised';
  end if;
  return new;
end $function$;
revoke all on function public.enforce_revision_from_request() from public, anon, authenticated;

drop trigger if exists service_cases_revision_from_request on public.service_cases;
create trigger service_cases_revision_from_request
  before update of status on public.service_cases
  for each row execute function public.enforce_revision_from_request();
