import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ids={houseA:"10000000-0000-0000-0000-000000000001",houseB:"10000000-0000-0000-0000-000000000002",guardianA:"20000000-0000-0000-0000-000000000001",guardianB:"20000000-0000-0000-0000-000000000002",educatorA:"20000000-0000-0000-0000-000000000003",adminA:"20000000-0000-0000-0000-000000000004",adminB:"20000000-0000-0000-0000-000000000005",learnerA:"30000000-0000-0000-0000-000000000001",learnerB:"30000000-0000-0000-0000-000000000002",caseA:"40000000-0000-0000-0000-000000000001",planA:"50000000-0000-0000-0000-000000000001",weekA:"60000000-0000-0000-0000-000000000001",dayA:"70000000-0000-0000-0000-000000000001",lessonA:"80000000-0000-0000-0000-000000000001"};

async function database(){
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role authenticated nologin; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for(const file of ["202608280001_core.sql","202608280002_operations.sql","202608280003_lesson_scheduling.sql","202608280004_guardian_intake.sql","202608280005_guardian_service_privacy.sql","202608280006_staff_operations.sql","202608280007_staff_authoring_delivery.sql","202608280008_staff_revision_messaging_exceptions.sql","202608280009_usable_intake_sla.sql","202608280010_payment_integrity.sql","202608280011_operational_controls.sql","202608280012_deletion_safeguards.sql","202608280013_secure_attachments.sql","202608280014_authenticated_privileges.sql","202608280015_operational_health.sql","202608280016_independent_plan_review.sql","202608280017_tenant_reference_integrity.sql","202608280018_operational_metadata_privacy.sql","202608280019_attachment_retry.sql","202608280020_portable_export_manifest.sql","202608280021_recent_authentication.sql"])await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),"utf8"));
  await db.exec(`grant usage on schema public,auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated; grant usage,select on all sequences in schema public to authenticated;`);
  await db.query(`insert into auth.users(id) values ($1),($2),($3),($4),($5)`,[ids.guardianA,ids.guardianB,ids.educatorA,ids.adminA,ids.adminB]);
  await db.query(`insert into public.households(id,display_name) values ($1,'Morgan'),($2,'Taylor')`,[ids.houseA,ids.houseB]);
  await db.query(`insert into public.memberships(household_id,user_id,role) values ($1,$2,'guardian'),($1,$3,'educator'),($1,$4,'admin'),($5,$6,'guardian'),($5,$7,'admin')`,[ids.houseA,ids.guardianA,ids.educatorA,ids.adminA,ids.houseB,ids.guardianB,ids.adminB]);
  await db.query(`insert into public.learners(id,household_id,preferred_name,grade_label,jurisdiction) values ($1,$2,'Riley','Grade 4','Ontario'),($3,$4,'Sam','Grade 5','Ontario')`,[ids.learnerA,ids.houseA,ids.learnerB,ids.houseB]);
  await db.query(`insert into public.service_cases(id,household_id,learner_id,package_code) values ($1,$2,$3,'complete')`,[ids.caseA,ids.houseA,ids.learnerA]);
  await db.query(`insert into public.plans(id,household_id,case_id,learner_id,status,authored_by) values ($1,$2,$3,$4,'published',$5)`,[ids.planA,ids.houseA,ids.caseA,ids.learnerA,ids.educatorA]);
  await db.query(`insert into public.plan_weeks(id,household_id,plan_id,week_number,theme) values ($1,$2,$3,1,'Patterns')`,[ids.weekA,ids.houseA,ids.planA]);
  await db.query(`insert into public.plan_days(id,household_id,week_id,day_number) values ($1,$2,$3,1)`,[ids.dayA,ids.houseA,ids.weekA]);
  await db.query(`insert into public.lessons(id,household_id,day_id,position,subject,title,objective,instructions) values ($1,$2,$3,1,'Math','Patterns','Notice patterns','[]')`,[ids.lessonA,ids.houseA,ids.dayA]);
  await db.query(`insert into public.guardian_consents(household_id,learner_id,guardian_user_id,notice_version,purposes) values ($1,$2,$3,'v1',array['planning'])`,[ids.houseA,ids.learnerA,ids.guardianA]);
  await db.query(`insert into public.learner_profiles(household_id,learner_id,planning_context,submitted_at,created_by) values ($1,$2,'{"goals":"Reading"}',now(),$3)`,[ids.houseA,ids.learnerA,ids.guardianA]);
  await db.query(`insert into public.lesson_activities(household_id,learner_id,lesson_id,status,updated_by) values ($1,$2,$3,'completed',$4)`,[ids.houseA,ids.learnerA,ids.lessonA,ids.guardianA]);
  await db.query(`insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id) values ($1,$2,'seed.created','household',$1)`,[ids.houseA,ids.adminA]);
  await db.query(`insert into public.orders(household_id,external_checkout_id,package_code,payment_status,amount_cents) values ($1,'checkout-a','complete','paid',19900)`,[ids.houseA]);
  await db.query(`insert into public.payment_events(household_id,case_id,order_id,provider_event_key,external_checkout_id,payment_status,package_code,currency,amount_cents,occurred_at) select $1,$2,id,'evt_seed_0001','checkout-a','paid','complete','CAD',19900,'2026-08-28T14:00:00Z' from public.orders where external_checkout_id='checkout-a'`,[ids.houseA,ids.caseA]);
  await db.query(`insert into public.operation_rate_windows(household_id,actor_user_id,action_key,window_started_at,attempt_count) values($1,$2,'seed.action',date_trunc('minute',now()),1)`,[ids.houseA,ids.adminA]);
  await db.query(`insert into public.operational_events(household_id,actor_user_id,component,severity,event_code,correlation_key,metadata,occurred_at) values($1,$2,'seed','info','seed.ready','seed-correlation-1','{}',now())`,[ids.houseA,ids.adminA]);
  await db.query(`insert into public.educator_capacities(household_id,educator_user_id,max_active_cases) values ($1,$2,2)`,[ids.houseA,ids.educatorA]);
  const seededMessage=(await db.query(`insert into public.case_messages(household_id,case_id,sender_user_id,kind,body,response_owner_user_id) values ($1,$2,$3,'clarification','Question',$4) returning id`,[ids.houseA,ids.caseA,ids.guardianA,ids.educatorA])).rows[0];
  await db.query(`insert into public.case_message_reads(household_id,message_id,user_id) values($1,$2,$3)`,[ids.houseA,seededMessage.id,ids.adminA]);
  await db.query(`insert into public.case_attachments(household_id,case_id,message_id,uploaded_by,object_path,file_name,mime_type,size_bytes,sha256,status,uploaded_at,scanned_at,scan_provider,scan_result_code) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,concat($1::text,'/',$2::text,'/',$3::text,'/seed-attachment'),'seed.pdf','application/pdf',100,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','clean',now(),now(),'seed-scanner','clean')`,[ids.houseA,ids.caseA,seededMessage.id,ids.guardianA]);
  await db.query(`insert into public.plan_reviews(household_id,plan_id,reviewer_user_id,curriculum_checked,safeguarding_checked,accessibility_checked,resource_rights_checked,approved_at) values ($1,$2,$3,true,true,true,true,now())`,[ids.houseA,ids.planA,ids.adminA]);
  await db.query(`insert into public.resources(household_id,plan_id,lesson_id,title,requirement,access_type,region,privacy_reviewed_at,rights_reviewed_at,link_checked_at,attribution) values ($1,$2,$3,'Workbook','optional','free','Canada',now(),now(),now(),'Original')`,[ids.houseA,ids.planA,ids.lessonA]);
  await db.query(`insert into public.deliveries(household_id,case_id,plan_id,plan_version,channel,status,attempt_count,sent_at) values ($1,$2,$3,1,'secure_portal','sent',1,now())`,[ids.houseA,ids.caseA,ids.planA]);
  await db.query(`insert into public.revision_requests(household_id,case_id,requested_by,reason,entitlement_index,status) values ($1,$2,$3,'Adjust reading',1,'requested')`,[ids.houseA,ids.caseA,ids.guardianA]);
  await db.query(`insert into public.privacy_requests(household_id,requested_by,kind,status,reason) values ($1,$2,'deletion','cancelled','Seeded closed request')`,[ids.houseA,ids.guardianA]);
  const seededPrivacy=(await db.query(`select id from public.privacy_requests where household_id=$1 limit 1`,[ids.houseA])).rows[0];
  await db.query(`insert into public.deletion_jobs(household_id,privacy_request_id,status,eligible_at,approved_by,approval_basis,identity_verified,co_guardian_reviewed) values($1,$2,'scheduled',now()+interval '30 days',$3,'Synthetic retention approval for isolation testing',true,true)`,[ids.houseA,seededPrivacy.id,ids.adminA]);
  return db;
}

async function asUser(db,userId,operation,{issuedAt=Math.floor(Date.now()/1000)}={}){await db.exec(`set role authenticated; set request.jwt.claim.sub='${userId}'; set request.jwt.claim.iat='${issuedAt}';`);try{return await operation()}finally{await db.exec("reset role; reset request.jwt.claim.sub; reset request.jwt.claim.iat;")}}

// The fixture loads migrations 001-021 only. It does not load 022-040: those depend on a fuller
// Supabase surface (roles anon/service_role, and the staff-write policy split in 007) and several
// later tests still assert pre-hardening behaviour, so loading them here fails for reasons unrelated
// to this test. Migration 040 has its own targeted regression test
// (tests/lesson-activity-readback.test.mjs) with the migrations it actually needs.
test("the core migrations execute in PostgreSQL and RLS isolates household reads",async()=>{
  const db=await database();try{
    const rows=await asUser(db,ids.guardianA,()=>db.query(`select preferred_name from public.learners order by preferred_name`));assert.deepEqual(rows.rows.map((row)=>row.preferred_name),["Riley"]);
    const cases=await asUser(db,ids.guardianB,()=>db.query(`select id from public.service_cases`));assert.equal(cases.rows.length,0);
  }finally{await db.close()}
});

test("RLS denies cross-household writes and limits lesson activity writes to guardians",async()=>{
  const db=await database();try{
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.learners(household_id,preferred_name,grade_label,jurisdiction) values ($1,'Intrusion','4','Ontario')`,[ids.houseB])),/row-level security/);
    const result=await asUser(db,ids.educatorA,()=>db.query(`update public.lesson_activities set status='skipped',updated_by=$1 where household_id=$2`,[ids.educatorA,ids.houseA]));assert.equal(result.affectedRows,0);
    await asUser(db,ids.guardianA,()=>db.query(`update public.lesson_activities set schedule_reason='illness',scheduled_for='2026-09-14',updated_by=$1 where household_id=$2`,[ids.guardianA,ids.houseA]));
    const status=await asUser(db,ids.guardianA,()=>db.query(`select status,schedule_reason,scheduled_for::text from public.lesson_activities`));assert.deepEqual(status.rows[0],{status:"completed",schedule_reason:"illness",scheduled_for:"2026-09-14"});
  }finally{await db.close()}
});

test("direct-write records cannot mix foreign tenant learner lesson or message references",async()=>{
  const db=await database();try{
    const caseB="40000000-0000-0000-0000-000000000002",planB="50000000-0000-0000-0000-000000000002",weekB="60000000-0000-0000-0000-000000000002",dayB="70000000-0000-0000-0000-000000000002",lessonB="80000000-0000-0000-0000-000000000002";
    await db.query(`insert into public.service_cases(id,household_id,learner_id,package_code) values($1,$2,$3,'complete')`,[caseB,ids.houseB,ids.learnerB]);
    await db.query(`insert into public.plans(id,household_id,case_id,learner_id,status,authored_by) values($1,$2,$3,$4,'published',$5)`,[planB,ids.houseB,caseB,ids.learnerB,ids.adminB]);
    await db.query(`insert into public.plan_weeks(id,household_id,plan_id,week_number,theme) values($1,$2,$3,1,'Tenant B')`,[weekB,ids.houseB,planB]);
    await db.query(`insert into public.plan_days(id,household_id,week_id,day_number) values($1,$2,$3,1)`,[dayB,ids.houseB,weekB]);
    await db.query(`insert into public.lessons(id,household_id,day_id,position,subject,title,objective,instructions) values($1,$2,$3,1,'Math','Private B','Private B objective','[]')`,[lessonB,ids.houseB,dayB]);
    const messageB=(await db.query(`insert into public.case_messages(household_id,case_id,sender_user_id,kind,body) values($1,$2,$3,'service','Private B message') returning id`,[ids.houseB,caseB,ids.adminB])).rows[0].id;
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.lesson_activities(household_id,learner_id,lesson_id,status,updated_by) values($1,$2,$3,'not_started',$4)`,[ids.houseA,ids.learnerA,lessonB,ids.guardianA])),/foreign key constraint/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.lesson_activities(household_id,learner_id,lesson_id,status,updated_by) values($1,$2,$3,'not_started',$4)`,[ids.houseA,ids.learnerB,ids.lessonA,ids.guardianA])),/foreign key constraint/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.case_message_reads(household_id,message_id,user_id) values($1,$2,$3)`,[ids.houseA,messageB,ids.guardianA])),/foreign key constraint/);
  }finally{await db.close()}
});

test("lesson schedule fields require a valid reason and date pair",async()=>{
  const db=await database();try{
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`update public.lesson_activities set schedule_reason='travel',scheduled_for=null,updated_by=$1 where household_id=$2`,[ids.guardianA,ids.houseA])),/lesson_activity_schedule_pair/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`update public.lesson_activities set schedule_reason='medical_details',scheduled_for='2026-09-14',updated_by=$1 where household_id=$2`,[ids.guardianA,ids.houseA])),/check constraint/);
  }finally{await db.close()}
});

test("guardian intake RPC atomically self-attributes consent and appends an immutable profile version",async()=>{
  const db=await database();try{
    const context={subjects:["Language","Math"],priorAttainment:"Reads short paragraphs",strengthsInterests:"Enjoys machines",goals:"Build fluency",learningSupports:"Short directions",language:"English",weeklySchedule:"Weekday mornings",caregiverAvailability:"Thirty minutes daily",deviceAccess:"computer_printer",resourceBudget:"free_only",contentConstraints:"",accessibilityNeeds:""};
    const submitted=await asUser(db,ids.guardianA,()=>db.query(`select * from public.submit_guardian_intake($1,$2,'notice-v1',array['personalized_learning_plan'],$3::jsonb)`,[ids.houseA,ids.learnerA,JSON.stringify(context)]));
    assert.equal(submitted.rows[0].profile_version,2);
    const profiles=await asUser(db,ids.guardianA,()=>db.query(`select version,planning_context->>'goals' as goals from public.learner_profiles where learner_id=$1 order by version`,[ids.learnerA]));assert.deepEqual(profiles.rows.map(row=>row.version),[1,2]);assert.equal(profiles.rows[1].goals,"Build fluency");
    const consents=await asUser(db,ids.guardianA,()=>db.query(`select guardian_user_id,notice_version,purposes from public.guardian_consents where learner_id=$1 order by consented_at`,[ids.learnerA]));assert.equal(consents.rows.at(-1).guardian_user_id,ids.guardianA);assert.equal(consents.rows.at(-1).notice_version,"notice-v1");assert.deepEqual(consents.rows.at(-1).purposes,["personalized_learning_plan"]);
  }finally{await db.close()}
});

test("intake policies reject cross-household submission and forged attribution",async()=>{
  const db=await database();try{
    const context={subjects:["Language"],priorAttainment:"Reads words",strengthsInterests:"Drawing",goals:"Fluency",learningSupports:"",language:"English",weeklySchedule:"Mornings",caregiverAvailability:"Daily",deviceAccess:"tablet",resourceBudget:"free_only",contentConstraints:"",accessibilityNeeds:""};
    await assert.rejects(()=>asUser(db,ids.guardianB,()=>db.query(`select * from public.submit_guardian_intake($1,$2,'notice-v1',array['personalized_learning_plan'],$3::jsonb)`,[ids.houseA,ids.learnerA,JSON.stringify(context)])),/guardian access required/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.guardian_consents(household_id,learner_id,guardian_user_id,notice_version,purposes) values($1,$2,$3,'notice-v1',array['personalized_learning_plan'])`,[ids.houseA,ids.learnerA,ids.guardianB])),/row-level security/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.learner_profiles(household_id,learner_id,version,planning_context,created_by) values($1,$2,99,'{}',$3)`,[ids.houseA,ids.learnerA,ids.educatorA])),/row-level security/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.guardian_consents(household_id,learner_id,guardian_user_id,notice_version,purposes) values($1,$2,$3,'fake-notice',array['unbounded'])`,[ids.houseA,ids.learnerA,ids.guardianA])),/row-level security/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.learner_profiles(household_id,learner_id,version,planning_context,created_by) values($1,$2,99,'{"unsupported":"data"}',$3)`,[ids.houseA,ids.learnerA,ids.guardianA])),/row-level security/);
  }finally{await db.close()}
});

test("consent withdrawal RPC changes only an active self-attributed consent and audits it",async()=>{
  const db=await database();try{
    const consent=await db.query(`select id from public.guardian_consents where guardian_user_id=$1 limit 1`,[ids.guardianA]);const consentId=consent.rows[0].id;
    const educatorBefore=await asUser(db,ids.educatorA,()=>db.query(`select id from public.learner_profiles where learner_id=$1`,[ids.learnerA]));assert.equal(educatorBefore.rows.length,1);
    await assert.rejects(()=>asUser(db,ids.guardianB,()=>db.query(`select public.withdraw_guardian_consent($1,$2)`,[ids.houseA,consentId])),/guardian access required/);
    const result=await asUser(db,ids.guardianA,()=>db.query(`select public.withdraw_guardian_consent($1,$2) as withdrawn_at`,[ids.houseA,consentId]));assert.ok(result.rows[0].withdrawn_at);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select public.withdraw_guardian_consent($1,$2)`,[ids.houseA,consentId])),/active self-attributed consent not found/);
    const record=await db.query(`select notice_version,purposes,withdrawn_at from public.guardian_consents where id=$1`,[consentId]);assert.equal(record.rows[0].notice_version,"v1");assert.deepEqual(record.rows[0].purposes,["planning"]);assert.ok(record.rows[0].withdrawn_at);
    const audit=await db.query(`select metadata from public.audit_events where event_type='consent.withdrawn' and subject_id=$1`,[consentId]);assert.equal(audit.rows.length,1);assert.equal(audit.rows[0].metadata.held_cases,1);
    const held=await asUser(db,ids.guardianA,()=>db.query(`select status from public.service_cases where id=$1`,[ids.caseA]));assert.equal(held.rows[0].status,"on_hold");
    const educatorProfiles=await asUser(db,ids.educatorA,()=>db.query(`select id from public.learner_profiles where learner_id=$1`,[ids.learnerA]));assert.equal(educatorProfiles.rows.length,0);
    const guardianProfiles=await asUser(db,ids.guardianA,()=>db.query(`select id from public.learner_profiles where learner_id=$1`,[ids.learnerA]));assert.equal(guardianProfiles.rows.length,1);
  }finally{await db.close()}
});

test("guardian delivery acknowledgement is household-scoped, one-time, and updates its case",async()=>{
  const db=await database();try{
    await db.query(`update public.service_cases set status='delivered' where id=$1`,[ids.caseA]);const delivery=(await db.query(`select id from public.deliveries where case_id=$1`,[ids.caseA])).rows[0].id;
    await assert.rejects(()=>asUser(db,ids.guardianB,()=>db.query(`select * from public.acknowledge_guardian_delivery($1,$2)`,[ids.houseA,delivery])),/guardian access required/);
    const direct=await asUser(db,ids.guardianA,()=>db.query(`update public.deliveries set status='acknowledged' where id=$1`,[delivery]));assert.equal(direct.affectedRows,0);
    const result=await asUser(db,ids.guardianA,()=>db.query(`select * from public.acknowledge_guardian_delivery($1,$2)`,[ids.houseA,delivery]));assert.equal(result.rows[0].delivery_id,delivery);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select * from public.acknowledge_guardian_delivery($1,$2)`,[ids.houseA,delivery])),/sent delivery not found/);
    const state=await db.query(`select d.status,d.acknowledged_at,c.status as case_status from public.deliveries d join public.service_cases c on c.id=d.case_id where d.id=$1`,[delivery]);assert.equal(state.rows[0].status,"acknowledged");assert.equal(state.rows[0].case_status,"acknowledged");assert.ok(state.rows[0].acknowledged_at);
  }finally{await db.close()}
});

test("guardian revision RPC enforces acknowledgement, package entitlement, and self-attribution",async()=>{
  const db=await database();try{
    await db.query(`update public.service_cases set status='acknowledged' where id=$1`,[ids.caseA]);await db.query(`update public.revision_requests set status='declined' where case_id=$1`,[ids.caseA]);
    await assert.rejects(()=>asUser(db,ids.guardianB,()=>db.query(`select * from public.request_guardian_revision($1,$2,'Change reading load')`,[ids.houseA,ids.caseA])),/guardian access required/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.revision_requests(household_id,case_id,requested_by,reason,entitlement_index,status) values($1,$2,$3,'Bypass',99,'requested')`,[ids.houseA,ids.caseA,ids.guardianA])),/row-level security/);
    const result=await asUser(db,ids.guardianA,()=>db.query(`select * from public.request_guardian_revision($1,$2,'Reduce the reading load')`,[ids.houseA,ids.caseA]));assert.equal(result.rows[0].entitlement_index,1);assert.equal(result.rows[0].remaining_revisions,0);
    const created=await db.query(`select requested_by,reason,status from public.revision_requests where id=$1`,[result.rows[0].revision_id]);assert.equal(created.rows[0].requested_by,ids.guardianA);assert.equal(created.rows[0].status,"requested");
    await db.query(`update public.service_cases set status='acknowledged' where id=$1`,[ids.caseA]);await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select * from public.request_guardian_revision($1,$2,'Second request')`,[ids.houseA,ids.caseA])),/no included revisions remain/);
  }finally{await db.close()}
});

test("guardian export is household-isolated, complete enough for portability, and audited",async()=>{
  const db=await database();try{
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select public.export_guardian_household($1)`,[ids.houseA]),{issuedAt:Math.floor(Date.now()/1000)-3600}),/recent authentication required/);
    await assert.rejects(()=>asUser(db,ids.guardianB,()=>db.query(`select public.export_guardian_household($1)`,[ids.houseA])),/guardian access required/);
    const result=await asUser(db,ids.guardianA,()=>db.query(`select public.export_guardian_household($1) as payload`,[ids.houseA]));const payload=result.rows[0].payload;
    assert.equal(payload.schemaVersion,2);assert.equal(payload.manifest.scope,"complete_household_portability");assert.equal(payload.manifest.binaryAttachments.included,false);assert.match(payload.manifest.binaryAttachments.reason,/authenticated retrieval/);assert.equal(payload.household.id,ids.houseA);assert.deepEqual(payload.learners.map(item=>item.id),[ids.learnerA]);assert.equal(payload.profiles.length,1);assert.equal(payload.consents.length,1);assert.equal(payload.plans.length,1);assert.equal(payload.planWeeks.length,1);assert.equal(payload.planDays.length,1);assert.equal(payload.lessons.length,1);assert.equal(payload.resources.length,1);assert.equal(payload.lessonActivities.length,1);assert.equal(payload.messages.length,1);assert.equal(payload.attachmentMetadata.length,1);assert.equal(payload.attachmentMetadata[0].binary_included,false);assert.equal(payload.deliveries.length,1);assert.equal(payload.revisions.length,1);assert.equal(payload.privacyRequests.length,1);
    assert.equal(JSON.stringify(payload).includes(ids.learnerB),false);const audit=await db.query(`select count(*)::int as count from public.audit_events where event_type='privacy.exported' and household_id=$1`,[ids.houseA]);assert.equal(audit.rows[0].count,1);
  }finally{await db.close()}
});

test("deletion request is idempotent and accountable without deleting data",async()=>{
  const db=await database();try{
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select * from public.request_guardian_household_deletion($1,'Request')`,[ids.houseA]),{issuedAt:Math.floor(Date.now()/1000)-3600}),/recent authentication required/);
    await assert.rejects(()=>asUser(db,ids.guardianB,()=>db.query(`select * from public.request_guardian_household_deletion($1,'Request')`,[ids.houseA])),/guardian access required/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.privacy_requests(household_id,requested_by,kind,status) values($1,$2,'deletion','pending')`,[ids.houseA,ids.guardianA])),/row-level security/);
    const first=await asUser(db,ids.guardianA,()=>db.query(`select * from public.request_guardian_household_deletion($1,'No longer using service')`,[ids.houseA]));
    const second=await asUser(db,ids.guardianA,()=>db.query(`select * from public.request_guardian_household_deletion($1,'Duplicate')`,[ids.houseA]));
    assert.equal(first.rows[0].request_id,second.rows[0].request_id);assert.equal(first.rows[0].request_status,"pending");
    const request=await db.query(`select requested_by,reason from public.privacy_requests where id=$1`,[first.rows[0].request_id]);assert.equal(request.rows[0].requested_by,ids.guardianA);assert.equal(request.rows[0].reason,"No longer using service");const household=await db.query(`select deleted_at from public.households where id=$1`,[ids.houseA]);assert.equal(household.rows[0].deleted_at,null);
  }finally{await db.close()}
});

test("staff lifecycle actions are household-scoped, self-attributed, and cannot be bypassed by direct writes",async()=>{
  const db=await database();try{
    const directCase=await asUser(db,ids.educatorA,()=>db.query(`update public.service_cases set status='closed' where id=$1`,[ids.caseA]));assert.equal(directCase.affectedRows,0);
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select * from public.staff_transition_case($1,$2,'intake_pending',null)`,[ids.houseA,ids.caseA])),/staff access required/);
    const moved=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_transition_case($1,$2,'intake_pending','Begin intake')`,[ids.houseA,ids.caseA]));assert.equal(moved.rows[0].previous_status,"paid");assert.equal(moved.rows[0].current_status,"intake_pending");
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_transition_case($1,$2,'published',null)`,[ids.houseA,ids.caseA])),/invalid case transition/);

    await db.query(`update public.plans set status='draft',reviewed_by=null where id=$1`,[ids.planA]);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`insert into public.plan_reviews(household_id,plan_id,reviewer_user_id) values($1,$2,$3)`,[ids.houseA,ids.planA,ids.adminA])),/row-level security/);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_review_plan($1,$2,true,true,true,true,'Self approval')`,[ids.houseA,ids.planA])),/author cannot review their own plan/);
    const reviewed=await asUser(db,ids.adminA,()=>db.query(`select * from public.staff_review_plan($1,$2,true,true,true,true,'Ready')`,[ids.houseA,ids.planA]));assert.equal(reviewed.rows[0].approved,true);
    const reviewActor=await db.query(`select reviewer_user_id from public.plan_reviews where id=$1`,[reviewed.rows[0].review_id]);assert.equal(reviewActor.rows[0].reviewer_user_id,ids.adminA);

    const revision=(await db.query(`select id from public.revision_requests where case_id=$1`,[ids.caseA])).rows[0].id;
    const decided=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_decide_revision($1,$2,'accepted','Within package scope')`,[ids.houseA,revision]));assert.equal(decided.rows[0].current_status,"accepted");
    const decisionActor=await db.query(`select decided_by from public.revision_requests where id=$1`,[revision]);assert.equal(decisionActor.rows[0].decided_by,ids.educatorA);
    const audit=await db.query(`select event_type,actor_user_id from public.audit_events where subject_id in ($1,$2) order by id`,[ids.caseA,revision]);assert.ok(audit.rows.some(row=>row.event_type==="case.transitioned"&&row.actor_user_id===ids.educatorA));assert.ok(audit.rows.some(row=>row.event_type==="revision.accepted"&&row.actor_user_id===ids.educatorA));
  }finally{await db.close()}
});

test("staff authoring atomically versions nested plans and gates governed publication and delivery",async()=>{
  const db=await database();try{
    await db.query(`update public.service_cases set status='drafting' where id=$1`,[ids.caseA]);
    const document={weeks:[{number:1,theme:"Sound and number patterns",days:[{number:1,plannedDate:"2026-09-01",lessons:[{position:1,subject:"Language",title:"Build a sound map",objective:"Connect sounds to familiar words",instructions:["Choose five familiar words","Sort them by opening sound"],materials:["Paper","Pencil"],accommodations:["Read instructions aloud"],adultHelpMinutes:10}]}]}]};
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select * from public.staff_create_plan_version($1,$2,$3)`,[ids.houseA,ids.caseA,document])),/staff access required/);
    const authored=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_create_plan_version($1,$2,$3)`,[ids.houseA,ids.caseA,document]));assert.equal(authored.rows[0].plan_version,2);assert.equal(authored.rows[0].week_count,1);assert.equal(authored.rows[0].lesson_count,1);
    const planId=authored.rows[0].plan_id;const lessonId=(await db.query(`select l.id from public.lessons l join public.plan_days d on d.id=l.day_id join public.plan_weeks w on w.id=d.week_id where w.plan_id=$1`,[planId])).rows[0].id;
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`insert into public.plan_weeks(household_id,plan_id,week_number,theme) values($1,$2,2,'Bypass')`,[ids.houseA,planId])),/row-level security/);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`insert into public.resources(household_id,plan_id,lesson_id,title,requirement,access_type) values($1,$2,$3,'Bypass','optional','free')`,[ids.houseA,planId,lessonId])),/row-level security/);
    const resource={title:"Original sound cards",url:"https://example.test/cards",requirement:"optional",accessType:"free",region:"Canada",privacyReviewedAt:"2026-08-28T15:00:00Z",rightsReviewedAt:"2026-08-28T15:00:00Z",linkCheckedAt:"2026-08-28T15:00:00Z",attribution:"BriteLink original"};
    const savedResource=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_add_plan_resource($1,$2,$3,$4)`,[ids.houseA,planId,lessonId,resource]));assert.ok(savedResource.rows[0].resource_id);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_review_plan($1,$2,true,true,true,true,'Self approval')`,[ids.houseA,planId])),/author cannot review their own plan/);
    await asUser(db,ids.adminA,()=>db.query(`select * from public.staff_review_plan($1,$2,true,true,true,true,'Approved')`,[ids.houseA,planId]));
    await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_transition_case($1,$2,'internal_review',null)`,[ids.houseA,ids.caseA]));
    await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_transition_case($1,$2,'published',null)`,[ids.houseA,ids.caseA]));
    const published=await db.query(`select status,published_at from public.plans where id=$1`,[planId]);assert.equal(published.rows[0].status,"published");assert.ok(published.rows[0].published_at);
    const delivered=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_record_delivery($1,$2,'secure_portal')`,[ids.houseA,ids.caseA]));assert.equal(delivered.rows[0].plan_version,2);assert.equal(delivered.rows[0].delivery_status,"sent");
    await db.query(`update public.deliveries set status='bounced',last_error_code='mailbox' where id=$1`,[delivered.rows[0].delivery_id]);const retried=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_retry_delivery($1,$2)`,[ids.houseA,delivered.rows[0].delivery_id]));assert.equal(retried.rows[0].delivery_status,"sent");assert.equal(retried.rows[0].attempt_count,2);
    const audits=await db.query(`select event_type,actor_user_id from public.audit_events where event_type in ('plan.version_created','resource.saved','delivery.sent','delivery.retried')`);for(const event of ["plan.version_created","resource.saved","delivery.sent","delivery.retried"])assert.ok(audits.rows.some(row=>row.event_type===event&&row.actor_user_id===ids.educatorA));
  }finally{await db.close()}
});

test("revision completion messaging ownership and operational exceptions are enforced and audited",async()=>{
  const db=await database();try{
    await db.query(`update public.service_cases set assigned_educator_id=$1 where id=$2`,[ids.educatorA,ids.caseA]);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.case_messages(household_id,case_id,sender_user_id,body) values($1,$2,$3,'Bypass')`,[ids.houseA,ids.caseA,ids.guardianA])),/row-level security/);
    const sent=await asUser(db,ids.guardianA,()=>db.query(`select * from public.send_case_message($1,$2,'clarification','Could you clarify the reading level?')`,[ids.houseA,ids.caseA]));assert.equal(sent.rows[0].response_owner_user_id,ids.educatorA);assert.ok(sent.rows[0].response_due_at);
    await assert.rejects(()=>asUser(db,ids.guardianB,()=>db.query(`select * from public.staff_resolve_case_message($1,$2)`,[ids.houseA,sent.rows[0].message_id])),/staff access required/);const resolved=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_resolve_case_message($1,$2)`,[ids.houseA,sent.rows[0].message_id]));assert.ok(resolved.rows[0].resolved_at);

    const revision=(await db.query(`select id from public.revision_requests where case_id=$1`,[ids.caseA])).rows[0].id;await db.query(`update public.service_cases set status='revision_requested' where id=$1`,[ids.caseA]);await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_decide_revision($1,$2,'accepted','Within scope')`,[ids.houseA,revision]));
    const document={weeks:[{number:1,theme:"Revised reading",days:[{number:1,lessons:[{position:1,subject:"Language",title:"Short sound map",objective:"Practise sounds with less reading",instructions:["Choose three words"]}]}]}]};const authored=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_create_plan_version($1,$2,$3)`,[ids.houseA,ids.caseA,document]));const caseDuringRevision=await db.query(`select status from public.service_cases where id=$1`,[ids.caseA]);assert.equal(caseDuringRevision.rows[0].status,"revision_requested");await asUser(db,ids.adminA,()=>db.query(`select * from public.staff_review_plan($1,$2,true,true,true,true,'Revision approved')`,[ids.houseA,authored.rows[0].plan_id]));
    const completed=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_complete_revision($1,$2,'Shortened passages and added oral alternatives')`,[ids.houseA,revision]));assert.equal(completed.rows[0].plan_version,2);const revisionState=await db.query(`select status,change_summary from public.revision_requests where id=$1`,[revision]);assert.equal(revisionState.rows[0].status,"completed");assert.match(revisionState.rows[0].change_summary,/Shortened passages/);const redelivery=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_record_delivery($1,$2,'secure_portal')`,[ids.houseA,ids.caseA]));assert.equal(redelivery.rows[0].plan_version,2);

    const absenceCase="40000000-0000-0000-0000-000000000010",overdueCase="40000000-0000-0000-0000-000000000011";await db.query(`insert into public.service_cases(id,household_id,learner_id,package_code,status,assigned_educator_id,sla_due_at) values($1,$2,$3,'complete','drafting',$4,now()+interval '1 day'),($5,$2,$3,'complete','triage',null,now()-interval '1 day')`,[absenceCase,ids.houseA,ids.learnerA,ids.educatorA,overdueCase]);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_record_educator_absence($1,$2,'Unavailable')`,[ids.houseA,absenceCase])),/admin access required/);const held=await asUser(db,ids.adminA,()=>db.query(`select * from public.staff_record_educator_absence($1,$2,'Educator illness; reassign required')`,[ids.houseA,absenceCase]));assert.equal(held.rows[0].previous_status,"drafting");const heldState=await db.query(`select status,previous_operational_status,assigned_educator_id from public.service_cases where id=$1`,[absenceCase]);assert.equal(heldState.rows[0].status,"on_hold");assert.equal(heldState.rows[0].previous_operational_status,"drafting");assert.equal(heldState.rows[0].assigned_educator_id,null);
    const overdue=await asUser(db,ids.adminA,()=>db.query(`select * from public.staff_mark_overdue_cases($1,now())`,[ids.houseA]));assert.ok(overdue.rows.some(row=>row.case_id===overdueCase));
    const audits=await db.query(`select event_type from public.audit_events where event_type in ('message.sent','message.resolved','revision.completed','educator.absence_recorded','case.marked_overdue')`);for(const event of ["message.sent","message.resolved","revision.completed","educator.absence_recorded","case.marked_overdue"])assert.ok(audits.rows.some(row=>row.event_type===event));
  }finally{await db.close()}
});

test("usable intake acceptance is the only path to triage and atomically starts the package SLA",async()=>{
  const db=await database();try{
    await db.query(`update public.service_cases set status='submitted',intake_received_at=null,sla_due_at=null where id=$1`,[ids.caseA]);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_transition_case($1,$2,'triage',null)`,[ids.houseA,ids.caseA])),/invalid case transition/);
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select * from public.staff_accept_usable_intake($1,$2)`,[ids.houseA,ids.caseA])),/staff access required/);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_accept_usable_intake($1,$2)`,[ids.houseA,ids.caseA])),/missing required planning context/);
    const context={subjects:["Language","Math"],priorAttainment:"Reads short paragraphs",strengthsInterests:"Enjoys machines",goals:"Build reading fluency",language:"English",weeklySchedule:"Weekday mornings",caregiverAvailability:"Thirty minutes daily",deviceAccess:"computer_printer",resourceBudget:"free_only"};await db.query(`update public.learner_profiles set planning_context=$1 where learner_id=$2`,[context,ids.learnerA]);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_accept_usable_intake($1,$2)`,[ids.houseA,ids.caseA])),/active personalized-learning consent/);
    await db.query(`update public.guardian_consents set purposes=array['personalized_learning_plan'] where learner_id=$1`,[ids.learnerA]);const accepted=await asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_accept_usable_intake($1,$2)`,[ids.houseA,ids.caseA]));assert.equal(accepted.rows[0].current_status,"triage");assert.equal(accepted.rows[0].profile_version,1);assert.ok(accepted.rows[0].intake_received_at);assert.ok(accepted.rows[0].sla_due_at);
    const caseState=await db.query(`select status,intake_received_at,sla_due_at from public.service_cases where id=$1`,[ids.caseA]);assert.equal(caseState.rows[0].status,"triage");assert.equal(new Date(caseState.rows[0].sla_due_at).getUTCDay()===0||new Date(caseState.rows[0].sla_due_at).getUTCDay()===6,false);
    const friday=(await db.query(`select public.add_business_days('2026-08-28T15:00:00Z',5) as due`)).rows[0].due;assert.equal(new Date(friday).toISOString(),"2026-09-04T15:00:00.000Z");await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.staff_accept_usable_intake($1,$2)`,[ids.houseA,ids.caseA])),/does not have a submitted intake/);
    const audit=await db.query(`select actor_user_id,metadata from public.audit_events where event_type='intake.accepted' and subject_id=$1`,[ids.caseA]);assert.equal(audit.rows.length,1);assert.equal(audit.rows[0].actor_user_id,ids.educatorA);assert.equal(audit.rows[0].metadata.profileVersion,1);assert.equal(audit.rows[0].metadata.businessDays,7);
  }finally{await db.close()}
});

test("payment ingestion is idempotent case-bound and terminal-state safe",async()=>{
  const db=await database();try{
    const directOrder=await asUser(db,ids.adminA,()=>db.query(`update public.orders set amount_cents=1 where external_checkout_id='checkout-a'`));assert.equal(directOrder.affectedRows,0);await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`insert into public.payment_events(household_id,case_id,order_id,provider_event_key,external_checkout_id,payment_status,package_code,currency,amount_cents,occurred_at) select $1,$2,id,'evt_bypass_1','checkout-a','paid','complete','CAD',1,now() from public.orders where external_checkout_id='checkout-a'`,[ids.houseA,ids.caseA])),/row-level security/);
    const paidAt=new Date(Date.now()-180000).toISOString();const refundAt=new Date(Date.now()-120000).toISOString();const chargebackAt=new Date(Date.now()-60000).toISOString();const args=[ids.houseA,ids.caseA,"evt_checkout_new_0001","checkout-new-1","complete","paid","CAD",24900,paidAt];
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select * from public.admin_ingest_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9)`,args)),/admin access required/);await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`select * from public.admin_ingest_payment_event($1,$2,$3,$4,'annual',$5,$6,$7,$8)`,[ids.houseA,ids.caseA,"evt_checkout_wrong_package_1","checkout-new-1","paid","CAD",24900,paidAt])),/package does not match case/);
    const paid=await asUser(db,ids.adminA,()=>db.query(`select * from public.admin_ingest_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9)`,args));assert.equal(paid.rows[0].payment_status,"paid");assert.equal(paid.rows[0].already_processed,false);const replay=await asUser(db,ids.adminA,()=>db.query(`select * from public.admin_ingest_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9)`,args));assert.equal(replay.rows[0].already_processed,true);assert.equal(replay.rows[0].payment_event_id,paid.rows[0].payment_event_id);
    await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`select * from public.admin_ingest_payment_event($1,$2,$3,$4,$5,$6,$7,1,$8)`,[ids.houseA,ids.caseA,"evt_checkout_new_0001","checkout-new-1","complete","paid","CAD",paidAt])),/replay mismatch/);const bound=await db.query(`select order_id from public.service_cases where id=$1`,[ids.caseA]);assert.equal(bound.rows[0].order_id,paid.rows[0].order_id);
    const refunded=await asUser(db,ids.adminA,()=>db.query(`select * from public.admin_ingest_payment_event($1,$2,'evt_checkout_refund_1',$3,$4,'refunded',$5,$6,$7)`,[ids.houseA,ids.caseA,"checkout-new-1","complete","CAD",24900,refundAt]));assert.equal(refunded.rows[0].case_status,"refunded");await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`select * from public.admin_ingest_payment_event($1,$2,'evt_checkout_charge_1',$3,$4,'chargeback',$5,$6,$7)`,[ids.houseA,ids.caseA,"checkout-new-1","complete","CAD",24900,chargebackAt])),/terminal payment state cannot change/);
    const events=await db.query(`select count(*)::int as count from public.payment_events where external_checkout_id='checkout-new-1'`);assert.equal(events.rows[0].count,2);const audit=await db.query(`select count(*)::int as count from public.audit_events where event_type='payment.status_ingested' and metadata->>'caseId'=$1`,[ids.caseA]);assert.equal(audit.rows[0].count,2);
  }finally{await db.close()}
});

test("operational controls rate-limit sensitive actions and isolate bounded monitoring signals",async()=>{
  const db=await database();try{
    for(let index=0;index<12;index+=1){const sent=await asUser(db,ids.guardianA,()=>db.query(`select * from public.send_case_message($1,$2,'general',$3)`,[ids.houseA,ids.caseA,`Quota message ${index+1}`]));assert.ok(sent.rows[0].message_id)}
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select * from public.send_case_message($1,$2,'general','Quota message 13')`,[ids.houseA,ids.caseA])),/operation rate limit exceeded for message\.send/);
    const window=await asUser(db,ids.adminA,()=>db.query(`select attempt_count from public.operation_rate_windows where household_id=$1 and actor_user_id=$2 and action_key='message.send'`,[ids.houseA,ids.guardianA]));assert.equal(window.rows[0].attempt_count,12);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.operational_events(household_id,actor_user_id,component,severity,event_code,metadata,occurred_at) values($1,$2,'client','error','client.failed','{}',now())`,[ids.houseA,ids.guardianA])),/row-level security/);
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select public.admin_record_operational_event($1,'database','error','database.failed','correlation-0001','{}',now())`,[ids.houseA])),/admin access required/);
    await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`select public.admin_record_operational_event($1,'database','error','database.failed','correlation-0001',$2::jsonb,now())`,[ids.houseA,{detail:"x".repeat(5000)}])),/operational metadata is invalid/);
    for(const metadata of [{learnerName:"Private learner"},{messageBody:"Private message"},{operation:{name:"case-list"}},{operation:["case-list"]},{operation:"x".repeat(121)}])await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`select public.admin_record_operational_event($1,'database','error','database.failed','correlation-0001',$2::jsonb,now())`,[ids.houseA,metadata])),/operational metadata is invalid/);
    const event=await asUser(db,ids.adminA,()=>db.query(`select public.admin_record_operational_event($1,'database','warning','database.slow_query','correlation-0001',$2::jsonb,now()) as id`,[ids.houseA,{durationBucket:"1-5s",operation:"case-list"}]));assert.ok(event.rows[0].id);
    const own=await asUser(db,ids.adminA,()=>db.query(`select component,severity,event_code,metadata from public.operational_events where id=$1`,[event.rows[0].id]));assert.equal(own.rows[0].event_code,"database.slow_query");assert.equal(own.rows[0].metadata.operation,"case-list");
    const other=await asUser(db,ids.adminB,()=>db.query(`select id from public.operational_events where id=$1`,[event.rows[0].id]));assert.equal(other.rows.length,0);
  }finally{await db.close()}
});

test("operational health snapshot emits aggregate actionable signals without household leakage",async()=>{
  const db=await database();try{
    await db.query(`update public.case_attachments set status='pending_scan',created_at=now()-interval '20 minutes',scanned_at=null,scan_provider=null,scan_result_code=null where household_id=$1`,[ids.houseA]);
    await db.query(`update public.deliveries set status='bounced',last_error_code='synthetic_bounce' where household_id=$1`,[ids.houseA]);
    await db.query(`update public.case_messages set response_due_at=now()-interval '1 hour',resolved_at=null where household_id=$1`,[ids.houseA]);
    await db.query(`update public.service_cases set status='overdue',sla_due_at=now()-interval '1 hour' where id=$1`,[ids.caseA]);
    await db.query(`update public.deletion_jobs set eligible_at=now()-interval '1 hour' where household_id=$1`,[ids.houseA]);
    await db.query(`insert into public.orders(household_id,external_checkout_id,package_code,payment_status,currency,amount_cents,created_at) values($1,'checkout-stale','complete','pending','CAD',19900,now()-interval '2 hours')`,[ids.houseA]);
    await db.query(`insert into public.operational_events(household_id,actor_user_id,component,severity,event_code,correlation_key,metadata,occurred_at) values($1,$2,'database','error','database.synthetic','health-check-0001','{}',now())`,[ids.houseA,ids.adminA]);
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select * from public.admin_operational_health_snapshot($1,now())`,[ids.houseA])),/admin access required/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select * from public.admin_operational_health_snapshot($1,now())`,[ids.houseA])),/admin access required/);
    await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`select * from public.admin_operational_health_snapshot($1,now()+interval '1 hour')`,[ids.houseA])),/health evaluation time is invalid/);
    const snapshot=await asUser(db,ids.adminA,()=>db.query(`select * from public.admin_operational_health_snapshot($1,now())`,[ids.houseA]));const codes=snapshot.rows.map(row=>row.signal_code);for(const code of ["attachment.scan_stale","delivery.failed","message.response_overdue","case.sla_overdue","deletion.job_due","payment.pending_stale","payment.case_binding_missing","operations.recent_error"])assert.ok(codes.includes(code),`${code} was not emitted`);assert.equal(snapshot.rows[0].severity,"critical");for(const row of snapshot.rows){assert.ok(row.entity_count>0);assert.deepEqual(Object.keys(row).sort(),["entity_count","oldest_at","severity","signal_code","threshold_seconds"])}
  }finally{await db.close()}
});

test("deletion scheduling requires independent safeguards and remains cancellable and audited",async()=>{
  const db=await database();try{
    const requested=await asUser(db,ids.guardianA,()=>db.query(`select * from public.request_guardian_household_deletion($1,'Family requested closure')`,[ids.houseA]));const requestId=requested.rows[0].request_id;const eligible=new Date(Date.now()+48*60*60*1000).toISOString();
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select * from public.admin_schedule_household_deletion($1,$2,$3,'Approved 30-day account closure schedule',true,true)`,[ids.houseA,requestId,eligible])),/admin access required/);
    await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`select * from public.admin_schedule_household_deletion($1,$2,$3,'Approved 30-day account closure schedule',false,true)`,[ids.houseA,requestId,eligible])),/identity and co-guardian safeguards are required/);
    await assert.rejects(()=>asUser(db,ids.adminA,()=>db.query(`select * from public.admin_schedule_household_deletion($1,$2,now(),'Approved 30-day account closure schedule',true,true)`,[ids.houseA,requestId])),/deletion eligibility time is invalid/);
    const scheduled=await asUser(db,ids.adminA,()=>db.query(`select * from public.admin_schedule_household_deletion($1,$2,$3,'Approved 30-day account closure schedule',true,true)`,[ids.houseA,requestId,eligible]));assert.equal(scheduled.rows[0].job_status,"scheduled");
    const direct=await asUser(db,ids.adminA,()=>db.query(`update public.deletion_jobs set status='completed' where id=$1`,[scheduled.rows[0].deletion_job_id]));assert.equal(direct.affectedRows,0);
    const cancelled=await asUser(db,ids.adminA,()=>db.query(`select * from public.admin_cancel_household_deletion($1,$2,'Guardian withdrew request')`,[ids.houseA,scheduled.rows[0].deletion_job_id]));assert.equal(cancelled.rows[0].job_status,"cancelled");
    const audits=await db.query(`select event_type from public.audit_events where subject_id=$1 order by created_at`,[scheduled.rows[0].deletion_job_id]);assert.deepEqual(audits.rows.map(row=>row.event_type),["privacy.deletion_scheduled","privacy.deletion_cancelled"]);
  }finally{await db.close()}
});

test("message attachments remain quarantined until an authorized clean scan",async()=>{
  const db=await database();try{
    const messageId=(await db.query(`select id from public.case_messages where household_id=$1 and sender_user_id=$2 order by created_at limit 1`,[ids.houseA,ids.guardianA])).rows[0].id;
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`insert into public.case_attachments(household_id,case_id,message_id,uploaded_by,object_path,file_name,mime_type,size_bytes) values($1,$2,$3,$4,'forged/path','forged.pdf','application/pdf',10)`,[ids.houseA,ids.caseA,messageId,ids.guardianA])),/row-level security/);
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select * from public.create_message_attachment_upload($1,$2,'plan.pdf','application/pdf',100)`,[ids.houseA,messageId])),/household membership required/);
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select * from public.create_message_attachment_upload($1,$2,'plan.exe','application/octet-stream',100)`,[ids.houseA,messageId])),/attachment type or size is invalid/);
    const created=await asUser(db,ids.guardianA,()=>db.query(`select * from public.create_message_attachment_upload($1,$2,'plan.pdf','application/pdf',100)`,[ids.houseA,messageId]));assert.equal(created.rows[0].attachment_status,"pending_upload");assert.match(created.rows[0].object_path,new RegExp(`^${ids.houseA}/${ids.caseA}/${messageId}/`));
    await assert.rejects(()=>asUser(db,ids.guardianA,()=>db.query(`select * from public.complete_message_attachment_upload($1,$2,'bad',true)`,[ids.houseA,created.rows[0].attachment_id])),/attachment checksum is invalid/);
    await assert.rejects(()=>asUser(db,ids.adminB,()=>db.query(`select * from public.complete_message_attachment_upload($1,$2,$3,true)`,[ids.houseA,created.rows[0].attachment_id,"b".repeat(64)])),/household membership required/);
    const failedCreated=await asUser(db,ids.guardianA,()=>db.query(`select * from public.create_message_attachment_upload($1,$2,'retry.txt','text/plain',20)`,[ids.houseA,messageId]));await asUser(db,ids.guardianA,()=>db.query(`select * from public.complete_message_attachment_upload($1,$2,null,false)`,[ids.houseA,failedCreated.rows[0].attachment_id]));
    await assert.rejects(()=>asUser(db,ids.guardianB,()=>db.query(`select * from public.retry_message_attachment_upload($1,$2)`,[ids.houseA,failedCreated.rows[0].attachment_id])),/household membership required/);
    const retriedOnce=await asUser(db,ids.guardianA,()=>db.query(`select * from public.retry_message_attachment_upload($1,$2)`,[ids.houseA,failedCreated.rows[0].attachment_id]));assert.equal(retriedOnce.rows[0].object_path,failedCreated.rows[0].object_path);assert.equal(retriedOnce.rows[0].attachment_status,"pending_upload");
    await asUser(db,ids.guardianA,()=>db.query(`select * from public.complete_message_attachment_upload($1,$2,null,false)`,[ids.houseA,failedCreated.rows[0].attachment_id]));const retriedTwice=await asUser(db,ids.guardianA,()=>db.query(`select * from public.retry_message_attachment_upload($1,$2)`,[ids.houseA,failedCreated.rows[0].attachment_id]));assert.equal(retriedTwice.rows[0].attachment_id,failedCreated.rows[0].attachment_id);const retryCount=await db.query(`select count(*)::int as count from public.case_attachments where id=$1`,[failedCreated.rows[0].attachment_id]);assert.equal(retryCount.rows[0].count,1);
    await asUser(db,ids.guardianA,()=>db.query(`select * from public.complete_message_attachment_upload($1,$2,$3,true)`,[ids.houseA,failedCreated.rows[0].attachment_id,"c".repeat(64)]));
    const uploaded=await asUser(db,ids.guardianA,()=>db.query(`select * from public.complete_message_attachment_upload($1,$2,$3,true)`,[ids.houseA,created.rows[0].attachment_id,"b".repeat(64)]));assert.equal(uploaded.rows[0].attachment_status,"pending_scan");
    const pendingStaff=await asUser(db,ids.educatorA,()=>db.query(`select status from public.case_attachments where id=$1`,[created.rows[0].attachment_id]));assert.equal(pendingStaff.rows[0].status,"pending_scan");const pendingOther=await asUser(db,ids.adminB,()=>db.query(`select id from public.case_attachments where id=$1`,[created.rows[0].attachment_id]));assert.equal(pendingOther.rows.length,0);
    await assert.rejects(()=>asUser(db,ids.educatorA,()=>db.query(`select * from public.admin_review_message_attachment($1,$2,'clean','scanner','clean')`,[ids.houseA,created.rows[0].attachment_id])),/admin access required/);
    const clean=await asUser(db,ids.adminA,()=>db.query(`select * from public.admin_review_message_attachment($1,$2,'clean','clamav','clean')`,[ids.houseA,created.rows[0].attachment_id]));assert.equal(clean.rows[0].attachment_status,"clean");
    const visible=await asUser(db,ids.guardianA,()=>db.query(`select status,sha256 from public.case_attachments where id=$1`,[created.rows[0].attachment_id]));assert.equal(visible.rows[0].status,"clean");assert.equal(visible.rows[0].sha256,"b".repeat(64));
    const audit=await db.query(`select event_type from public.audit_events where subject_id=$1 order by created_at`,[created.rows[0].attachment_id]);assert.deepEqual(audit.rows.map(row=>row.event_type),["attachment.upload_created","attachment.uploaded","attachment.scan_reviewed"]);
  }finally{await db.close()}
});

test("every household-scoped private table denies an equally privileged user from another household",async()=>{
  const db=await database();try{
    const tables=["memberships","learners","guardian_consents","learner_profiles","service_cases","plans","plan_weeks","plan_days","lessons","lesson_activities","audit_events","orders","payment_events","operation_rate_windows","operational_events","deletion_jobs","educator_capacities","case_messages","case_message_reads","case_attachments","plan_reviews","resources","deliveries","revision_requests","privacy_requests"];
    for(const table of tables){
      const own=await asUser(db,ids.adminA,()=>db.query(`select count(*)::int as count from public.${table} where household_id=$1`,[ids.houseA]));assert.ok(own.rows[0].count>0,`${table} should be visible to household A admin`);
      const other=await asUser(db,ids.adminB,()=>db.query(`select count(*)::int as count from public.${table} where household_id=$1`,[ids.houseA]));assert.equal(other.rows[0].count,0,`${table} leaked to household B admin`);
    }
    const ownHouse=await asUser(db,ids.adminA,()=>db.query(`select count(*)::int as count from public.households where id=$1`,[ids.houseA]));assert.equal(ownHouse.rows[0].count,1);
    const otherHouse=await asUser(db,ids.adminB,()=>db.query(`select count(*)::int as count from public.households where id=$1`,[ids.houseA]));assert.equal(otherHouse.rows[0].count,0);
  }finally{await db.close()}
});
