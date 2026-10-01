import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseBriteLinkRepository } from "../src/supabase-repository.js";

test("workspace access uses the verified account's roles across households, not another member's first role", async () => {
  const roster = [
    {user_id:"administrator-a",household_id:"household-a",role:"admin"},
    {user_id:"signed-in-user",household_id:"household-a",role:"guardian"},
    {user_id:"signed-in-user",household_id:"household-b",role:"educator"},
  ];
  let filter;
  const query = {
    select(){return this;},
    eq(column,value){filter=[column,value];return this;},
    async order(){return {data:filter?roster.filter(row=>row[filter[0]]===filter[1]):roster};},
  };
  const client={auth:{getUser:async()=>({data:{user:{id:"signed-in-user"}}})},from:()=>query};
  const result=await new SupabaseBriteLinkRepository(client).listMemberships();
  assert.deepEqual(result,roster.slice(1));
});

test("missing signed-in account cannot load workspace memberships", async () => {
  const client={auth:{getUser:async()=>({data:{user:null}})},from(){throw new Error("membership query must not run");}};
  await assert.rejects(()=>new SupabaseBriteLinkRepository(client).listMemberships(),/Signed-in user ID/);
});

test("failed account verification cannot load workspace memberships", async () => {
  const client={auth:{getUser:async()=>({error:{message:"session rejected"}})},from(){throw new Error("membership query must not run");}};
  await assert.rejects(()=>new SupabaseBriteLinkRepository(client).listMemberships(),/Read signed-in account: session rejected/);
});

function mockClient(result = { data: [] }) {
  const calls = [];
  const query = new Proxy({}, {
    get(_target, name) {
      if (name === "then") return (resolve) => resolve(result);
      return (...args) => {
        calls.push([name, ...args]);
        return query;
      };
    },
  });
  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        return query;
      },
    },
  };
}

test("learner and case reads include an explicit household scope", async () => {
  for (const method of ["listLearners", "listCases"]) {
    const { client, calls } = mockClient();
    await new SupabaseBriteLinkRepository(client)[method]("household-a");
    assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "household_id" && call[2] === "household-a"));
  }
});

test("published plans are scoped to household and learner", async () => {
  const { client, calls } = mockClient();
  await new SupabaseBriteLinkRepository(client).loadPublishedPlans("household-a", "learner-a");
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "household_id" && call[2] === "household-a"));
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "learner_id" && call[2] === "learner-a"));
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "status" && call[2] === "published"));
});

test("latest intake read is household and learner scoped",async()=>{
  const {client,calls}=mockClient({data:[{id:"profile-a",version:2}]});
  const profile=await new SupabaseBriteLinkRepository(client).loadLatestProfile("household-a","learner-a");
  assert.equal(profile.version,2); assert.ok(calls.some(call=>call[0]==="eq"&&call[1]==="household_id"&&call[2]==="household-a")); assert.ok(calls.some(call=>call[0]==="eq"&&call[1]==="learner_id"&&call[2]==="learner-a"));
});

test("guardian intake uses the atomic RPC with fixed purpose and validated context",async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return{data:[{profile_version:2}]}}};
  const result=await new SupabaseBriteLinkRepository(client).submitGuardianIntake({householdId:"household-a",learnerId:"learner-a",noticeVersion:"notice-v1",guardianConsent:true,planningStructure:"plan_every_day",subjects:["Language"],priorAttainment:"Reads short passages",strengthsInterests:"Enjoys machines",goals:"Build fluency",learningSupports:"Short directions",language:"English",weeklySchedule:"Weekday mornings",caregiverAvailability:"Thirty minutes daily",deviceAccess:"computer_printer",resourceBudget:"free_only",contentConstraints:"",accessibilityNeeds:""});
  assert.equal(result.profile_version,2);assert.equal(calls[0][0],"submit_guardian_intake");assert.deepEqual(calls[0][1].consent_purposes,["personalized_learning_plan"]);assert.equal(calls[0][1].target_household,"household-a");assert.equal(calls[0][1].context.goals,"Build fluency");
});

test("guardian service and privacy actions use scoped reads and named RPCs",async()=>{
  const calls=[];const query=new Proxy({}, {get(_target,name){if(name==="then")return resolve=>resolve({data:[]});return(...args)=>{calls.push([name,...args]);return query}}});
  const client={from(table){calls.push(["from",table]);return query},rpc:async(name,args)=>{calls.push(["rpc",name,args]);return{data:name==="export_guardian_household"?{household:{id:"household-a"}}:[{id:"result-a"}]}}};const repository=new SupabaseBriteLinkRepository(client);
  await repository.listActiveConsents("household-a","learner-a","guardian-a");await repository.listDeliveries("household-a","case-a");await repository.listRevisions("household-a","case-a");await repository.listPrivacyRequests("household-a");
  for(const field of [["household_id","household-a"],["learner_id","learner-a"],["case_id","case-a"],["guardian_user_id","guardian-a"]])assert.ok(calls.some(call=>call[0]==="eq"&&call[1]===field[0]&&call[2]===field[1]));
  await repository.withdrawConsent("household-a","consent-a");await repository.acknowledgeDelivery("household-a","delivery-a");await repository.requestRevision({householdId:"household-a",caseId:"case-a",reason:"Reduce reading"});const exported=await repository.exportHousehold("household-a");await repository.requestDeletion({householdId:"household-a",reason:"Finished",confirmed:true});
  assert.equal(exported.household.id,"household-a");for(const name of ["withdraw_guardian_consent","acknowledge_guardian_delivery","request_guardian_revision","export_guardian_household","request_guardian_household_deletion"])assert.ok(calls.some(call=>call[0]==="rpc"&&call[1]===name));
});

test("staff workbench reads stay household scoped and lifecycle writes use attributed RPCs",async()=>{
  const calls=[];const query=new Proxy({}, {get(_target,name){if(name==="then")return resolve=>resolve({data:[]});return(...args)=>{calls.push([name,...args]);return query}}});
  const client={from(table){calls.push(["from",table]);return query},rpc:async(name,args)=>{calls.push(["rpc",name,args]);return{data:[{id:"result-a"}]}}};const repository=new SupabaseBriteLinkRepository(client);
  for(const method of ["listStaffProfiles","listStaffPlans","listStaffReviews","listStaffRevisions","listEducatorCapacities","listStaffOrders","listStaffPaymentEvents","listAdminOperationalEvents","listAdminDeletionJobs"])await repository[method]("household-a");
  assert.equal(calls.filter(call=>call[0]==="eq"&&call[1]==="household_id"&&call[2]==="household-a").length,9);
  await repository.transitionStaffCase({householdId:"household-a",caseId:"case-a",status:"drafting",reason:"Assigned educator started"});
  await repository.assignStaffCase({householdId:"household-a",caseId:"case-a",educatorId:"educator-a"});
  await repository.reviewStaffPlan({householdId:"household-a",planId:"plan-a",checks:{curriculum:true,safeguarding:true,accessibility:true,resourceRights:true},notes:"Approved"});
  await repository.decideStaffRevision({householdId:"household-a",revisionId:"revision-a",decision:"accepted",reason:"Within scope"});
  for(const name of ["staff_transition_case","staff_assign_case","staff_review_plan","staff_decide_revision"])assert.ok(calls.some(call=>call[0]==="rpc"&&call[1]===name));
  const review=calls.find(call=>call[0]==="rpc"&&call[1]==="staff_review_plan")[2];assert.equal(review.curriculum_checked,true);assert.equal(review.review_notes,"Approved");
});

test("admin deletion controls validate safeguards and use audited RPC boundaries",async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return{data:[{job_status:name.includes("schedule")?"scheduled":"cancelled"}]}}};const repository=new SupabaseBriteLinkRepository(client);
  await assert.rejects(()=>repository.scheduleAdminDeletion({householdId:"household-a",requestId:"request-a",eligibleAt:"invalid",retentionBasis:"Approved retention schedule",identityVerified:true,coGuardianReviewed:true}),/eligibility time/);
  await assert.rejects(()=>repository.scheduleAdminDeletion({householdId:"household-a",requestId:"request-a",eligibleAt:"2027-01-01T00:00:00Z",retentionBasis:"Approved retention schedule",identityVerified:false,coGuardianReviewed:true}),/safeguards/);
  const scheduled=await repository.scheduleAdminDeletion({householdId:"household-a",requestId:"request-a",eligibleAt:"2027-01-01T00:00:00Z",retentionBasis:"Approved retention schedule v1",identityVerified:true,coGuardianReviewed:true});assert.equal(scheduled.job_status,"scheduled");
  const cancelled=await repository.cancelAdminDeletion({householdId:"household-a",jobId:"job-a",reason:"Guardian withdrew the request"});assert.equal(cancelled.job_status,"cancelled");
  assert.deepEqual(calls.map(call=>call[0]),["admin_schedule_household_deletion","admin_cancel_household_deletion"]);assert.equal(calls[0][1].identity_verified,true);assert.equal(calls[1][1].target_job,"job-a");
});

test("admin operational health uses a scoped aggregate RPC and strict timestamp",async()=>{const calls=[];const repository=new SupabaseBriteLinkRepository({rpc:async(name,args)=>{calls.push([name,args]);return{data:[{signal_code:"delivery.failed",severity:"error",entity_count:1}]}}});await assert.rejects(()=>repository.getAdminOperationalHealth("household-a","not-a-time"),/evaluation time/);const rows=await repository.getAdminOperationalHealth("household-a","2026-08-28T15:00:00Z");assert.equal(rows[0].signal_code,"delivery.failed");assert.equal(calls[0][0],"admin_operational_health_snapshot");assert.equal(calls[0][1].target_household,"household-a");assert.equal(calls[0][1].evaluated_at,"2026-08-28T15:00:00.000Z")});

test("retention dry run is a read-only scoped RPC mirroring the in-memory candidate shape",async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return{data:[{candidate_type:"household",candidate_id:"household-a"},{candidate_type:"case",candidate_id:"case-a"},{candidate_type:"case",candidate_id:"case-b"}]}},from(){throw new Error("the dry run must not read tables directly")}};const repository=new SupabaseBriteLinkRepository(client);
  assert.deepEqual(await repository.retentionCandidates({householdId:"household-a"}),{household:["household-a"],cases:["case-a","case-b"]});
  assert.equal(calls[0][0],"admin_retention_candidates");assert.equal(calls[0][1].target_household,"household-a");
  assert.equal(calls[0][1].deleted_household_days,30);assert.equal(calls[0][1].closed_case_days,365);
  const explicit=await repository.retentionCandidates({householdId:"household-a",deletedHouseholdDays:90,closedCaseDays:730,asOf:"2026-09-01T00:00:00Z"});
  assert.equal(calls[1][1].deleted_household_days,90);assert.equal(calls[1][1].closed_case_days,730);assert.equal(calls[1][1].as_of,"2026-09-01T00:00:00.000Z");assert.deepEqual(explicit.household,["household-a"]);
  await assert.rejects(()=>repository.retentionCandidates({householdId:"household-a",asOf:"not-a-time"}),/evaluation time/);
  await assert.rejects(()=>repository.retentionCandidates({householdId:"household-a",deletedHouseholdDays:0}),/Deleted-household window/);
  await assert.rejects(()=>repository.retentionCandidates({householdId:"household-a",closedCaseDays:3651}),/Closed-case window/);
  assert.equal(calls.length,2);
});

test("attachment upload hashes content uses private storage and remains pending scan",async()=>{
  const calls=[];const file={name:"plan.pdf",type:"application/pdf",size:4,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer};const client={
    rpc:async(name,args)=>{calls.push(["rpc",name,args]);if(name==="create_message_attachment_upload")return{data:[{attachment_id:"attachment-a",object_path:"household-a/case-a/message-a/attachment-a",attachment_status:"pending_upload"}]};return{data:[{attachment_id:"attachment-a",attachment_status:args.upload_succeeded?"pending_scan":"upload_failed"}]};},
    storage:{from(bucket){calls.push(["bucket",bucket]);return{upload:async(path,value,options)=>{calls.push(["upload",path,value,options]);return{data:{path}}},createSignedUrl:async(path,seconds,options)=>{calls.push(["signed",path,seconds,options]);return{data:{signedUrl:"https://example.test/signed"}}}}}},
  };const repository=new SupabaseBriteLinkRepository(client);const uploaded=await repository.uploadMessageAttachment({householdId:"household-a",messageId:"message-a",file});assert.equal(uploaded.attachment_status,"pending_scan");assert.equal(calls.find(call=>call[0]==="bucket")[1],"case-attachments");assert.equal(calls.find(call=>call[0]==="upload")[3].upsert,false);const complete=calls.find(call=>call[0]==="rpc"&&call[1]==="complete_message_attachment_upload")[2];assert.equal(complete.content_sha256.length,64);assert.equal(complete.upload_succeeded,true);
  await assert.rejects(()=>repository.createAttachmentDownloadUrl({...uploaded,status:"pending_scan"}),/security scan/);const url=await repository.createAttachmentDownloadUrl({...uploaded,status:"clean",object_path:"household-a/case-a/message-a/attachment-a",file_name:"plan.pdf"});assert.equal(url,"https://example.test/signed");
});

test("failed binary upload records a recoverable failed attachment state",async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return name==="create_message_attachment_upload"?{data:[{attachment_id:"attachment-a",object_path:"household-a/case-a/message-a/attachment-a"}]}:{data:[{attachment_status:"upload_failed"}]}},storage:{from(){return{upload:async()=>({error:{message:"network interrupted"}})}}}};const repository=new SupabaseBriteLinkRepository(client);const file={name:"plan.pdf",type:"application/pdf",size:1,arrayBuffer:async()=>new Uint8Array([1]).buffer};await assert.rejects(()=>repository.uploadMessageAttachment({householdId:"household-a",messageId:"message-a",file}),error=>{assert.match(error.message,/network interrupted/);assert.equal(error.attachmentRetry.attachmentId,"attachment-a");assert.equal(error.attachmentRetry.file,file);return true});const failed=calls.find(call=>call[0]==="complete_message_attachment_upload")[1];assert.equal(failed.upload_succeeded,false);assert.equal(failed.content_sha256,null);
});

test("failed attachment retry reuses the existing server-owned path",async()=>{const calls=[];const file={name:"plan.pdf",type:"application/pdf",size:1,arrayBuffer:async()=>new Uint8Array([1]).buffer};const client={rpc:async(name,args)=>{calls.push(["rpc",name,args]);if(name==="retry_message_attachment_upload")return{data:[{attachment_id:"attachment-a",object_path:"household-a/case-a/message-a/attachment-a",attachment_status:"pending_upload"}]};return{data:[{attachment_id:"attachment-a",attachment_status:"pending_scan"}]}},storage:{from(){return{upload:async(path,value,options)=>{calls.push(["upload",path,value,options]);return{data:{path}}}}}}};const saved=await new SupabaseBriteLinkRepository(client).retryMessageAttachmentUpload({householdId:"household-a",attachmentId:"attachment-a",file});assert.equal(saved.attachment_id,"attachment-a");assert.equal(saved.attachment_status,"pending_scan");assert.equal(calls.filter(call=>call[0]==="upload").length,1);assert.equal(calls.find(call=>call[0]==="upload")[1],"household-a/case-a/message-a/attachment-a");assert.equal(calls.find(call=>call[0]==="rpc"&&call[1]==="complete_message_attachment_upload")[2].upload_succeeded,true)});

test("staff authoring resource and delivery actions use validated atomic RPCs",async()=>{
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return{data:[{id:"result-a"}]}}};const repository=new SupabaseBriteLinkRepository(client);const document={weeks:[{number:1,theme:"Patterns",days:[{number:1,lessons:[{subject:"Math",title:"Find patterns",objective:"Explain a pattern",instructions:["Choose objects"]}]}]}]};
  await repository.createStaffPlanVersion({householdId:"household-a",caseId:"case-a",document});await repository.addStaffPlanResource({householdId:"household-a",planId:"plan-a",lessonId:"lesson-a",resource:{title:"Cards",url:"https://example.test/cards",requirement:"optional",accessType:"free",region:"Canada"}});await repository.recordStaffDelivery({householdId:"household-a",caseId:"case-a"});await repository.retryStaffDelivery({householdId:"household-a",deliveryId:"delivery-a"});
  for(const name of ["staff_create_plan_version","staff_add_plan_resource","staff_record_delivery","staff_retry_delivery"])assert.ok(calls.some(call=>call[0]===name));assert.equal(calls.find(call=>call[0]==="staff_create_plan_version")[1].plan_document.weeks[0].days[0].lessons[0].position,1);assert.equal(calls.find(call=>call[0]==="staff_record_delivery")[1].delivery_channel,"secure_portal");
  await assert.rejects(()=>repository.addStaffPlanResource({householdId:"household-a",planId:"plan-a",lessonId:"lesson-a",resource:{title:"Unsafe",url:"http://example.test",requirement:"optional",accessType:"free",region:"Canada"}}),/HTTPS/);
});

test("lesson activity reads are explicitly scoped to household and learner", async () => {
  const { client, calls } = mockClient();
  await new SupabaseBriteLinkRepository(client).listLessonActivities("household-a", "learner-a");
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "household_id" && call[2] === "household-a"));
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "learner_id" && call[2] === "learner-a"));
});

test("lesson activity writes preserve progress while recording a paired schedule exception", async () => {
  const mock=mockClient({data:{id:"activity-a"}});
  await new SupabaseBriteLinkRepository(mock.client).saveLessonActivity({householdId:"household-a",learnerId:"learner-a",lessonId:"lesson-a",userId:"guardian-a",status:"paused",note:"Resume here",scheduleReason:"travel",scheduledFor:"2026-09-14"});
  const row=mock.calls.find(call=>call[0]==="upsert")[1];
  assert.equal(row.status,"paused"); assert.equal(row.caregiver_note,"Resume here"); assert.equal(row.schedule_reason,"travel"); assert.equal(row.scheduled_for,"2026-09-14");
});

test("message reads and writes preserve household and case scope", async () => {
  let mock = mockClient();
  await new SupabaseBriteLinkRepository(mock.client).listMessages("household-a", "case-a");
  assert.ok(mock.calls.some((call) => call[0] === "eq" && call[1] === "household_id" && call[2] === "household-a"));
  assert.ok(mock.calls.some((call) => call[0] === "eq" && call[1] === "case_id" && call[2] === "case-a"));

  const calls=[];const messageRepository=new SupabaseBriteLinkRepository({rpc:async(name,args)=>{calls.push([name,args]);return{data:[{message_id:"message-a",response_owner_user_id:"educator-a",created_at:"2026-08-28T15:00:00Z"}]}}});
  const sent=await messageRepository.sendMessage({
    householdId: "household-a", caseId: "case-a", userId: "user-a", body: "Question",
  });
  assert.equal(calls[0][0],"send_case_message");assert.equal(calls[0][1].target_household,"household-a");assert.equal(calls[0][1].target_case,"case-a");assert.equal(sent.id,"message-a");assert.equal(sent.body,"Question");
});

test("staff completion messaging exception and intake controls use scoped RPCs",async()=>{const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return{data:[{id:"result-a"}]}}};const repository=new SupabaseBriteLinkRepository(client);await repository.resolveStaffMessage({householdId:"household-a",messageId:"message-a"});await repository.completeStaffRevision({householdId:"household-a",revisionId:"revision-a",changeSummary:"Reduced reading and added audio choices"});await repository.recordStaffAbsence({householdId:"household-a",caseId:"case-a",reason:"Educator unavailable"});await repository.markStaffOverdue("household-a","2026-08-28T15:00:00Z");await repository.acceptStaffIntake({householdId:"household-a",caseId:"case-a"});for(const name of ["staff_resolve_case_message","staff_complete_revision","staff_record_educator_absence","staff_mark_overdue_cases","staff_accept_usable_intake"])assert.ok(calls.some(call=>call[0]===name));assert.equal(calls.find(call=>call[0]==="staff_complete_revision")[1].revision_change_summary,"Reduced reading and added audio choices");assert.equal(calls.find(call=>call[0]==="staff_mark_overdue_cases")[1].evaluated_at,"2026-08-28T15:00:00.000Z")});

test("database errors are surfaced with operation context", async () => {
  const { client } = mockClient({ data: null, error: { message: "permission denied", code: "PGRST301", status: 401, details: "expired" } });
  await assert.rejects(() => new SupabaseBriteLinkRepository(client).listCases("household-a"), (error)=>{
    assert.match(error.message,/Load cases: permission denied/);
    assert.equal(error.code,"PGRST301"); assert.equal(error.status,401); assert.equal(error.details,"expired");
    return true;
  });
});

test("message read acknowledgement is a user-scoped idempotent upsert", async () => {
  const mock = mockClient({ data: { message_id: "message-a" } });
  await new SupabaseBriteLinkRepository(mock.client).markMessageRead({householdId:"household-a",messageId:"message-a",userId:"user-a",readAt:"2026-08-28T15:00:00Z"});
  assert.deepEqual(mock.calls.find((call)=>call[0]==="upsert").slice(1),[{household_id:"household-a",message_id:"message-a",user_id:"user-a",read_at:"2026-08-28T15:00:00.000Z"},{onConflict:"message_id,user_id"}]);
});

test("authentication rejects unsafe redirect URLs before calling Supabase", async () => {
  const calls=[];
  const client={auth:{signInWithOtp:async(input)=>{calls.push(input);return{data:{}}}}};
  const repository=new SupabaseBriteLinkRepository(client);
  await assert.rejects(()=>repository.signInWithEmail("guardian@example.ca","javascript:alert(1)"),/redirect URL is invalid/);
  assert.equal(calls.length,0);
  await repository.signInWithEmail(" Guardian@Example.ca ","https://app.britelink.org/auth");
  assert.equal(calls[0].email,"guardian@example.ca");
  assert.equal(calls[0].options.emailRedirectTo,"https://app.britelink.org/auth");
  assert.equal(calls[0].options.shouldCreateUser,false);
  await repository.requestFreshSignIn("guardian@example.ca","https://app.britelink.org");
  assert.equal(calls[1].email,"guardian@example.ca");assert.equal(calls[1].options.shouldCreateUser,false);
});

test("the family calendar is saved through its RPC with validated, de-duplicated input", async () => {
  const calls = [];
  const repository = new SupabaseBriteLinkRepository({ rpc: async (name, args) => { calls.push([name, args]); return { data: [{ plan_id: "plan-a" }] }; } });
  const saved = await repository.setPlanSchedule({ householdId: "10000000-0000-4000-8000-000000000001", planId: "50000000-0000-4000-8000-000000000001", startDate: "2026-10-05", schoolDays: [1, 3, 3, 5], daysOff: ["2026-10-09"] });
  assert.deepEqual(saved, { plan_id: "plan-a" });
  assert.deepEqual(calls, [["set_plan_schedule", { target_household: "10000000-0000-4000-8000-000000000001", target_plan: "50000000-0000-4000-8000-000000000001", schedule_start: "2026-10-05", schedule_school_days: [1, 3, 5], schedule_days_off: ["2026-10-09"] }]]);
  const ids = { householdId: "10000000-0000-4000-8000-000000000001", planId: "50000000-0000-4000-8000-000000000001" };
  await assert.rejects(() => repository.setPlanSchedule({ ...ids, schoolDays: [] }), /at least one school day/);
  await assert.rejects(() => repository.setPlanSchedule({ ...ids, schoolDays: [8] }), /at least one school day/);
  await assert.rejects(() => repository.setPlanSchedule({ ...ids, startDate: "05/10/2026", schoolDays: [1] }), /Start date/);
  await assert.rejects(() => repository.setPlanSchedule({ ...ids, schoolDays: [1], daysOff: ["tomorrow"] }), /Days off/);
  assert.equal(calls.length, 1, "invalid input never reaches the database");
});

test("weekly notes, shared activities and calendar feeds call their RPCs with the migration's argument names", async () => {
  const calls=[];const query=new Proxy({}, {get(_target,name){if(name==="then")return resolve=>resolve({data:[{id:"row-a"}]});return(...args)=>{calls.push([name,...args]);return query}}});
  const client={from(table){calls.push(["from",table]);return query},rpc:async(name,args)=>{calls.push(["rpc",name,args]);return{data:[{id:"result-a",token:"f".repeat(64)}]}}};
  const repository=new SupabaseBriteLinkRepository(client);
  await repository.setWeeklyNote({ householdId:"household-a", learnerId:"learner-a", weekStart:"2026-09-21", note:"  Great week  " });
  assert.deepEqual(calls.at(-1), ["rpc","staff_set_weekly_note",{ target_household:"household-a", target_learner:"learner-a", target_week:"2026-09-21", note_body:"Great week" }]);
  await assert.rejects(() => repository.setWeeklyNote({ householdId:"household-a", learnerId:"learner-a", weekStart:"2026-09-22", note:"Tuesday" }), /Monday/);
  await repository.clearWeeklyNote({ householdId:"household-a", learnerId:"learner-a", weekStart:"2026-09-21" });
  assert.equal(calls.at(-1)[1], "staff_clear_weekly_note");

  await repository.createSharedActivity({ householdId:"household-a", title:"Pond", description:" ", subjects:["Science","Science"], date:"2026-10-01", outcomes:[{learnerId:"l1",outcome:"Sketch"},{learnerId:"l2",outcome:"Point"}] });
  assert.deepEqual(calls.at(-1), ["rpc","staff_create_shared_activity",{ target_household:"household-a", activity_title:"Pond", activity_description:null, activity_subjects:["Science"], activity_date:"2026-10-01", learner_outcomes:[{learnerId:"l1",outcome:"Sketch"},{learnerId:"l2",outcome:"Point"}] }]);
  await assert.rejects(() => repository.createSharedActivity({ householdId:"household-a", title:"Pond", outcomes:[{learnerId:"l1",outcome:"Sketch"}] }), /at least two learners/);
  await assert.rejects(() => repository.createSharedActivity({ householdId:"household-a", title:"Pond", outcomes:[{learnerId:"l1",outcome:"a"},{learnerId:"l1",outcome:"b"}] }), /once/);
  await repository.moveSharedActivity({ householdId:"household-a", activityId:"act-a", date:"2026-10-02", learnerId:"l2" });
  assert.deepEqual(calls.at(-1)[2], { target_household:"household-a", target_shared_activity:"act-a", new_date:"2026-10-02", target_learner:"l2" });
  await repository.setSharedActivityDone({ householdId:"household-a", activityId:"act-a", learnerId:"l1", done:"yes" });
  assert.equal(calls.at(-1)[2].done, false, "only a literal true marks done");

  const feed = await repository.createCalendarFeed({ householdId:"household-a", learnerId:"learner-a", includeTitles:true });
  assert.equal(feed.token, "f".repeat(64));
  assert.deepEqual(calls.at(-1), ["rpc","create_calendar_feed",{ target_household:"household-a", target_learner:"learner-a", include_titles:true }]);
  await repository.getCalendarFeed("household-a", "learner-a");
  assert.ok(calls.some((call) => call[0]==="select" && !String(call[1]).includes("token")), "the feed row is read without any token column");
  assert.ok(calls.some((call) => call[0]==="is" && call[1]==="revoked_at" && call[2]===null));
});
