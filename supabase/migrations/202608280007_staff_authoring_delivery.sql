-- Atomic plan authoring, resource governance, and delivery/retry operations.

drop policy if exists weeks_staff_write on public.plan_weeks;
drop policy if exists days_staff_write on public.plan_days;
drop policy if exists lessons_staff_write on public.lessons;
drop policy if exists resources_staff_write on public.resources;

create or replace function public.staff_create_plan_version(target_household uuid,target_case uuid,plan_document jsonb)
returns table(plan_id uuid,plan_version integer,week_count integer,lesson_count integer)
language plpgsql security definer set search_path=public
as $$
declare service_case public.service_cases%rowtype; new_plan uuid; next_version integer; week_item jsonb; day_item jsonb; lesson_item jsonb; new_week uuid; new_day uuid; weeks_total integer; lessons_total integer:=0;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required'; end if;
  select * into service_case from public.service_cases where id=target_case and household_id=target_household for update;
  if not found then raise exception 'case not found'; end if;
  if service_case.status not in ('drafting','internal_review','revision_requested') then raise exception 'case is not ready for plan authoring'; end if;
  if service_case.status='revision_requested' and not exists(select 1 from public.revision_requests where case_id=target_case and status='accepted') then raise exception 'revision must be accepted before authoring'; end if;
  if jsonb_typeof(plan_document->'weeks')<>'array' then raise exception 'plan weeks must be an array'; end if;
  weeks_total:=jsonb_array_length(plan_document->'weeks');if weeks_total<1 or weeks_total>52 then raise exception 'plan requires 1 to 52 weeks'; end if;
  select coalesce(max(version),0)+1 into next_version from public.plans where case_id=target_case;
  insert into public.plans(household_id,case_id,learner_id,version,status,authored_by) values(target_household,target_case,service_case.learner_id,next_version,'draft',auth.uid()) returning id into new_plan;
  for week_item in select value from jsonb_array_elements(plan_document->'weeks') loop
    if (week_item->>'number')::integer not between 1 and 52 or char_length(btrim(week_item->>'theme')) not between 1 and 200 then raise exception 'invalid week'; end if;
    if jsonb_typeof(week_item->'days')<>'array' or jsonb_array_length(week_item->'days')<1 then raise exception 'each week requires at least one day'; end if;
    insert into public.plan_weeks(household_id,plan_id,week_number,theme) values(target_household,new_plan,(week_item->>'number')::integer,btrim(week_item->>'theme')) returning id into new_week;
    for day_item in select value from jsonb_array_elements(week_item->'days') loop
      if (day_item->>'number')::integer not between 1 and 7 then raise exception 'invalid day'; end if;
      if jsonb_typeof(day_item->'lessons')<>'array' or jsonb_array_length(day_item->'lessons')<1 then raise exception 'each day requires at least one lesson'; end if;
      insert into public.plan_days(household_id,week_id,day_number,planned_date) values(target_household,new_week,(day_item->>'number')::integer,nullif(day_item->>'plannedDate','')::date) returning id into new_day;
      for lesson_item in select value from jsonb_array_elements(day_item->'lessons') loop
        if (lesson_item->>'position')::integer<1 or char_length(btrim(lesson_item->>'subject')) not between 1 and 100 or char_length(btrim(lesson_item->>'title')) not between 1 and 200 or char_length(btrim(lesson_item->>'objective')) not between 1 and 1000 then raise exception 'invalid lesson'; end if;
        if jsonb_typeof(lesson_item->'instructions')<>'array' or jsonb_array_length(lesson_item->'instructions')<1 then raise exception 'lesson instructions are required'; end if;
        insert into public.lessons(household_id,day_id,position,subject,title,objective,instructions,materials,accommodations,adult_help_minutes)
        values(target_household,new_day,(lesson_item->>'position')::integer,btrim(lesson_item->>'subject'),btrim(lesson_item->>'title'),btrim(lesson_item->>'objective'),lesson_item->'instructions',coalesce(lesson_item->'materials','[]'::jsonb),coalesce(lesson_item->'accommodations','[]'::jsonb),nullif(lesson_item->>'adultHelpMinutes','')::integer);
        lessons_total:=lessons_total+1;
      end loop;
    end loop;
  end loop;
  update public.service_cases set status=case when service_case.status='revision_requested' then 'revision_requested'::public.case_status else 'drafting'::public.case_status end,updated_at=now() where id=target_case;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'plan.version_created','plan',new_plan,jsonb_build_object('version',next_version,'weeks',weeks_total,'lessons',lessons_total));
  return query select new_plan,next_version,weeks_total,lessons_total;
end $$;

create or replace function public.staff_add_plan_resource(target_household uuid,target_plan uuid,target_lesson uuid,resource_document jsonb)
returns table(resource_id uuid,created_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare new_resource uuid; resource_url text:=nullif(btrim(resource_document->>'url'),''); access_value text:=resource_document->>'accessType'; requirement_value text:=resource_document->>'requirement';
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required'; end if;
  if not exists(select 1 from public.plans p join public.plan_weeks w on w.plan_id=p.id join public.plan_days d on d.week_id=w.id join public.lessons l on l.day_id=d.id where p.id=target_plan and l.id=target_lesson and p.household_id=target_household and p.status in ('draft','internal_review')) then raise exception 'editable plan lesson not found'; end if;
  if char_length(btrim(resource_document->>'title')) not between 1 and 200 then raise exception 'resource title is required'; end if;
  if resource_url is not null and resource_url !~ '^https://' then raise exception 'resource URL must use HTTPS'; end if;
  if requirement_value not in ('required','optional','substitute') or access_value not in ('free','paid','library','household') then raise exception 'invalid resource classification'; end if;
  if access_value='paid' and (resource_document->>'estimatedCostCents') is null then raise exception 'paid resource cost is required'; end if;
  insert into public.resources(household_id,plan_id,lesson_id,title,url,requirement,access_type,estimated_cost_cents,region,edition,account_required,ads_present,privacy_reviewed_at,rights_reviewed_at,link_checked_at,attribution,substitute_resource_id)
  values(target_household,target_plan,target_lesson,btrim(resource_document->>'title'),resource_url,requirement_value,access_value,nullif(resource_document->>'estimatedCostCents','')::integer,nullif(btrim(resource_document->>'region'),''),nullif(btrim(resource_document->>'edition'),''),coalesce((resource_document->>'accountRequired')::boolean,false),coalesce((resource_document->>'adsPresent')::boolean,false),nullif(resource_document->>'privacyReviewedAt','')::timestamptz,nullif(resource_document->>'rightsReviewedAt','')::timestamptz,nullif(resource_document->>'linkCheckedAt','')::timestamptz,nullif(btrim(resource_document->>'attribution'),''),nullif(resource_document->>'substituteResourceId','')::uuid)
  returning id into new_resource;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'resource.saved','resource',new_resource,jsonb_build_object('planId',target_plan,'lessonId',target_lesson));
  return query select new_resource,now();
end $$;

create or replace function public.staff_record_delivery(target_household uuid,target_case uuid,delivery_channel text default 'secure_portal')
returns table(delivery_id uuid,plan_id uuid,plan_version integer,delivery_status text,sent_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare service_case public.service_cases%rowtype; latest_plan public.plans%rowtype; new_delivery uuid;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required'; end if;
  if delivery_channel not in ('secure_portal','email_notice') then raise exception 'invalid delivery channel'; end if;
  select * into service_case from public.service_cases where id=target_case and household_id=target_household for update;if not found then raise exception 'case not found';end if;
  if service_case.status not in ('published','revised') then raise exception 'case is not ready for delivery'; end if;
  select * into latest_plan from public.plans where case_id=target_case and status='published' order by version desc limit 1;if not found then raise exception 'published plan not found';end if;
  insert into public.deliveries(household_id,case_id,plan_id,plan_version,channel,status,attempt_count,sent_at) values(target_household,target_case,latest_plan.id,latest_plan.version,delivery_channel,'sent',1,now()) returning id into new_delivery;
  update public.service_cases set status='delivered',updated_at=now() where id=target_case;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'delivery.sent','delivery',new_delivery,jsonb_build_object('caseId',target_case,'planVersion',latest_plan.version,'channel',delivery_channel));
  return query select new_delivery,latest_plan.id,latest_plan.version,'sent'::text,now();
end $$;

create or replace function public.staff_retry_delivery(target_household uuid,target_delivery uuid)
returns table(delivery_id uuid,delivery_status text,attempt_count integer,sent_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare delivery_row public.deliveries%rowtype;
begin
  if not public.has_household_role(target_household,array['educator','admin']::public.membership_role[]) then raise exception 'staff access required'; end if;
  select * into delivery_row from public.deliveries where id=target_delivery and household_id=target_household and status in ('failed','bounced') for update;if not found then raise exception 'retryable delivery not found';end if;
  update public.deliveries d set status='sent',attempt_count=d.attempt_count+1,last_error_code=null,sent_at=now() where d.id=target_delivery;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'delivery.retried','delivery',target_delivery,jsonb_build_object('attemptCount',delivery_row.attempt_count+1));
  return query select target_delivery,'sent'::text,delivery_row.attempt_count+1,now();
end $$;

revoke all on function public.staff_create_plan_version(uuid,uuid,jsonb) from public;
revoke all on function public.staff_add_plan_resource(uuid,uuid,uuid,jsonb) from public;
revoke all on function public.staff_record_delivery(uuid,uuid,text) from public;
revoke all on function public.staff_retry_delivery(uuid,uuid) from public;
grant execute on function public.staff_create_plan_version(uuid,uuid,jsonb) to authenticated;
grant execute on function public.staff_add_plan_resource(uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.staff_record_delivery(uuid,uuid,text) to authenticated;
grant execute on function public.staff_retry_delivery(uuid,uuid) to authenticated;
