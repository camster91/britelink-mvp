create or replace function public.export_guardian_household(target_household uuid)
returns jsonb language plpgsql security definer set search_path=public,auth
as $$
declare payload jsonb;
begin
  if auth.uid() is null or not public.has_household_role(target_household,array['guardian']::public.membership_role[]) then raise exception 'guardian access required' using errcode='42501'; end if;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  values(target_household,auth.uid(),'privacy.exported','household',target_household,jsonb_build_object('format','json','scope','household','schema_version',2));
  select jsonb_build_object(
    'schemaVersion',2,'exportedAt',now(),
    'manifest',jsonb_build_object(
      'scope','complete_household_portability','format','application/json',
      'included',jsonb_build_array('household','learners','profiles','consents','cases','plans','planWeeks','planDays','lessons','resources','lessonActivities','messages','attachmentMetadata','deliveries','revisions','privacyRequests'),
      'binaryAttachments',jsonb_build_object('included',false,'reason','Binary files require separate authenticated retrieval from private storage; attachmentMetadata contains identity, integrity, scan state, and object reference for reconciliation.'),
      'excluded',jsonb_build_array(jsonb_build_object('category','authentication_secrets','reason','Passwords, magic-link tokens, refresh tokens, and provider credentials are never exportable.'))
    ),
    'household',(select to_jsonb(h)-'deleted_at' from public.households h where h.id=target_household),
    'learners',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id,preferred_name,grade_label,jurisdiction,created_at,updated_at,deleted_at from public.learners where household_id=target_household)x),'[]'::jsonb),
    'profiles',coalesce((select jsonb_agg(to_jsonb(x) order by x.version) from (select id,learner_id,version,planning_context,submitted_at,created_at from public.learner_profiles where household_id=target_household)x),'[]'::jsonb),
    'consents',coalesce((select jsonb_agg(to_jsonb(x) order by x.consented_at) from (select id,learner_id,notice_version,purposes,consented_at,withdrawn_at from public.guardian_consents where household_id=target_household)x),'[]'::jsonb),
    'cases',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id,learner_id,package_code,status,intake_received_at,sla_due_at,acknowledged_at,closed_at,created_at,updated_at from public.service_cases where household_id=target_household)x),'[]'::jsonb),
    'plans',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id,case_id,learner_id,version,status,published_at,created_at from public.plans where household_id=target_household)x),'[]'::jsonb),
    'planWeeks',coalesce((select jsonb_agg(to_jsonb(x) order by x.plan_id,x.week_number) from (select id,plan_id,week_number,theme from public.plan_weeks where household_id=target_household)x),'[]'::jsonb),
    'planDays',coalesce((select jsonb_agg(to_jsonb(x) order by x.week_id,x.day_number) from (select id,week_id,day_number,planned_date from public.plan_days where household_id=target_household)x),'[]'::jsonb),
    'lessons',coalesce((select jsonb_agg(to_jsonb(x) order by x.day_id,x.position) from (select id,day_id,position,subject,title,objective,instructions,materials,accommodations,adult_help_minutes from public.lessons where household_id=target_household)x),'[]'::jsonb),
    'resources',coalesce((select jsonb_agg(to_jsonb(x) order by x.plan_id,x.lesson_id,x.id) from (select id,plan_id,lesson_id,title,url,requirement,access_type,estimated_cost_cents,region,edition,account_required,ads_present,privacy_reviewed_at,rights_reviewed_at,link_checked_at,attribution,substitute_resource_id from public.resources where household_id=target_household)x),'[]'::jsonb),
    'lessonActivities',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at) from (select id,learner_id,lesson_id,status,caregiver_note,schedule_reason,scheduled_for,updated_at from public.lesson_activities where household_id=target_household)x),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id,case_id,sender_user_id,kind,body,response_due_at,resolved_at,created_at from public.case_messages where household_id=target_household)x),'[]'::jsonb),
    'attachmentMetadata',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id,case_id,message_id,file_name,mime_type,size_bytes,sha256,status,object_path,uploaded_at,scanned_at,scan_provider,scan_result_code,created_at,false as binary_included,'separate_authenticated_retrieval'::text as binary_exclusion_reason from public.case_attachments where household_id=target_household)x),'[]'::jsonb),
    'deliveries',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id,case_id,plan_id,plan_version,channel,status,attempt_count,sent_at,acknowledged_at,created_at from public.deliveries where household_id=target_household)x),'[]'::jsonb),
    'revisions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id,case_id,reason,entitlement_index,status,disposition_reason,change_summary,created_at,completed_at from public.revision_requests where household_id=target_household)x),'[]'::jsonb),
    'privacyRequests',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id,kind,status,reason,created_at,resolved_at,resolution_note from public.privacy_requests where household_id=target_household)x),'[]'::jsonb)
  ) into payload;
  return payload;
end $$;

revoke all on function public.export_guardian_household(uuid) from public;
grant execute on function public.export_guardian_household(uuid) to authenticated;
