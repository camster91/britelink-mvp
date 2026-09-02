-- A case enters triage only after a usable, actively consented intake starts its SLA.

create or replace function public.add_business_days(start_at timestamptz,business_days integer)
returns timestamptz language plpgsql immutable set search_path=public
as $$
declare result_at timestamptz:=start_at;added integer:=0;
begin
  if business_days<0 or business_days>60 then raise exception 'business day count is invalid';end if;
  while added<business_days loop result_at:=result_at+interval '1 day';if extract(isodow from result_at)<6 then added:=added+1;end if;end loop;return result_at;
end $$;

create or replace function public.staff_accept_usable_intake(target_household uuid,target_case uuid)
returns table(case_id uuid,profile_id uuid,profile_version integer,intake_received_at timestamptz,sla_due_at timestamptz,current_status public.case_status)
language plpgsql security definer set search_path=public
as $$
declare service_case public.service_cases%rowtype;learner_row public.learners%rowtype;profile_row public.learner_profiles%rowtype;accepted_at timestamptz:=now();due_at timestamptz;days integer;context jsonb;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required';end if;
  select * into service_case from public.service_cases where id=target_case and household_id=target_household for update;if not found then raise exception 'case not found';end if;
  if service_case.status not in ('submitted','clarification') then raise exception 'case does not have a submitted intake';end if;
  select * into learner_row from public.learners where id=service_case.learner_id and household_id=target_household and deleted_at is null;if not found then raise exception 'active learner not found';end if;
  select * into profile_row from public.learner_profiles where household_id=target_household and learner_id=service_case.learner_id and submitted_at is not null order by version desc limit 1;if not found then raise exception 'submitted learner profile is required';end if;context:=profile_row.planning_context;
  if nullif(btrim(coalesce(learner_row.grade_label,'')),'') is null or nullif(btrim(coalesce(learner_row.jurisdiction,'')),'') is null then raise exception 'learner grade and jurisdiction are required';end if;
  if jsonb_typeof(context->'subjects')<>'array' or jsonb_array_length(context->'subjects')<1 or
    nullif(btrim(coalesce(context->>'priorAttainment','')),'') is null or nullif(btrim(coalesce(context->>'strengthsInterests','')),'') is null or
    nullif(btrim(coalesce(context->>'goals','')),'') is null or nullif(btrim(coalesce(context->>'language','')),'') is null or
    nullif(btrim(coalesce(context->>'weeklySchedule','')),'') is null or nullif(btrim(coalesce(context->>'caregiverAvailability','')),'') is null or
    nullif(btrim(coalesce(context->>'deviceAccess','')),'') is null or nullif(btrim(coalesce(context->>'resourceBudget','')),'') is null
  then raise exception 'latest learner profile is missing required planning context';end if;
  if not exists(select 1 from public.guardian_consents gc where gc.household_id=target_household and gc.learner_id=service_case.learner_id and gc.withdrawn_at is null and gc.purposes@>array['personalized_learning_plan']::text[]) then raise exception 'active personalized-learning consent is required';end if;
  days:=case service_case.package_code when 'essentials' then 5 when 'complete' then 7 when 'annual' then 7 else 7 end;due_at:=public.add_business_days(accepted_at,days);
  update public.service_cases set status='triage',intake_received_at=accepted_at,sla_due_at=due_at,status_reason=null,updated_at=accepted_at where id=target_case;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'intake.accepted','service_case',target_case,jsonb_build_object('from',service_case.status,'profileId',profile_row.id,'profileVersion',profile_row.version,'packageCode',service_case.package_code,'businessDays',days,'slaDueAt',due_at));
  return query select target_case,profile_row.id,profile_row.version,accepted_at,due_at,'triage'::public.case_status;
end $$;

revoke all on function public.add_business_days(timestamptz,integer) from public;revoke all on function public.staff_accept_usable_intake(uuid,uuid) from public;
grant execute on function public.staff_accept_usable_intake(uuid,uuid) to authenticated;
