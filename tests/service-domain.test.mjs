import assert from "node:assert/strict";
import test from "node:test";
import { AccessDeniedError, InMemoryBriteLinkRepository, InvalidTransitionError, createServiceSeed } from "../src/service-domain.js";

const actors = { guardianA:{id:"guardian-a"}, guardianB:{id:"guardian-b"}, educatorA:{id:"educator-a"}, educatorB:{id:"educator-b"}, adminA:{id:"admin-a"} };
const createRepo = () => new InMemoryBriteLinkRepository(createServiceSeed(), { clock: () => new Date("2026-08-28T15:00:00Z") });

test("every private read denies a user from another household", () => {
  const repo=createRepo();
  assert.throws(()=>repo.listLearners(actors.guardianB,"house-a"),AccessDeniedError);
  assert.throws(()=>repo.listCases(actors.educatorB,"house-a"),AccessDeniedError);
  assert.throws(()=>repo.getCase(actors.guardianB,"case-a"),AccessDeniedError);
  assert.throws(()=>repo.listMessages(actors.guardianB,"case-a"),AccessDeniedError);
  assert.throws(()=>repo.exportHousehold(actors.guardianB,"house-a"),AccessDeniedError);
});

test("cross-household writes and privacy actions are denied", () => {
  const repo=createRepo();
  assert.throws(()=>repo.saveProfile(actors.guardianB,"house-a","learner-a",{goals:"x"},{noticeVersion:"v1",purposes:["planning"]}),AccessDeniedError);
  assert.throws(()=>repo.saveLessonActivity(actors.guardianB,"house-a","learner-a","lesson-1","completed"),AccessDeniedError);
  assert.throws(()=>repo.transitionCase(actors.educatorB,"case-a","intake_pending"),AccessDeniedError);
  assert.throws(()=>repo.deleteHousehold(actors.guardianB,"house-a"),AccessDeniedError);
});

test("guardian saves versioned consent and receives a household-only export", () => {
  const repo=createRepo();
  const profile=repo.saveProfile(actors.guardianA,"house-a","learner-a",{goals:"Independent reading"},{noticeVersion:"2026-08-28",purposes:["curriculum_planning"]});
  assert.equal(profile.version,1);
  const exported=repo.exportHousehold(actors.guardianA,"house-a");
  assert.equal(exported.learners.length,1); assert.equal(exported.learners[0].id,"learner-a"); assert.ok(exported.audits.some((event)=>event.eventType==="profile.saved"));
  assert.ok(Object.values(exported).flat().every((record)=>!record.householdId||record.householdId==="house-a"));
});

test("case workflow enforces staff roles and valid transitions", () => {
  const repo=createRepo();
  assert.throws(()=>repo.transitionCase(actors.guardianA,"case-a","intake_pending"),AccessDeniedError);
  assert.equal(repo.transitionCase(actors.educatorA,"case-a","intake_pending").status,"intake_pending");
  assert.equal(repo.transitionCase(actors.educatorA,"case-a","submitted").status,"submitted");
  assert.throws(()=>repo.transitionCase(actors.educatorA,"case-a","published"),InvalidTransitionError);
  for (const state of ["triage","assigned","drafting","internal_review"]) repo.transitionCase(actors.educatorA,"case-a",state);
  assert.throws(()=>repo.transitionCase(actors.educatorA,"case-a","published"),/approved internal review/);
  repo.savePlanReview(actors.educatorA,"case-a",{curriculum:true,safeguarding:true,accessibility:true,resourceRights:true});
  repo.transitionCase(actors.educatorA,"case-a","published");
  assert.equal(repo.getCase(actors.guardianA,"case-a").status,"published");
});

test("SLA starts only after a complete consented intake is accepted",()=>{
  const repo=createRepo();repo.transitionCase(actors.educatorA,"case-a","intake_pending");repo.transitionCase(actors.educatorA,"case-a","submitted");
  assert.throws(()=>repo.acceptUsableIntake(actors.educatorA,"case-a"),/not usable/);assert.equal(repo.getCase(actors.guardianA,"case-a").slaDueAt,undefined);
  repo.saveProfile(actors.guardianA,"house-a","learner-a",{grade:"4",jurisdiction:"Ontario",interests:"Machines",goals:"Reading"},{noticeVersion:"v1",purposes:["planning"]});
  const accepted=repo.acceptUsableIntake(actors.educatorA,"case-a");assert.equal(accepted.status,"triage");assert.equal(accepted.intakeReceivedAt,"2026-08-28T15:00:00.000Z");assert.equal(accepted.slaDueAt,"2026-09-08T15:00:00.000Z");
});

test("triage queue prioritizes overdue then earliest due cases",()=>{
  const repo=createRepo();repo.data.cases.push({id:"case-a2",householdId:"house-a",learnerId:"learner-a",packageCode:"complete",status:"triage",slaDueAt:"2026-09-01T00:00:00Z"},{id:"case-a3",householdId:"house-a",learnerId:"learner-a",packageCode:"complete",status:"overdue",slaDueAt:"2026-09-03T00:00:00Z"},{id:"case-a4",householdId:"house-a",learnerId:"learner-a",packageCode:"complete",status:"triage",slaDueAt:"2026-08-31T00:00:00Z"});
  assert.deepEqual(repo.triageQueue(actors.educatorA,"house-a").map((item)=>item.id),["case-a3","case-a4","case-a2"]);assert.throws(()=>repo.triageQueue(actors.guardianA,"house-a"),AccessDeniedError);
});

test("assignment enforces household membership and educator capacity",()=>{
  const repo=createRepo();repo.data.educatorCapacities[0].maxActiveCases=1;repo.data.cases.push({id:"case-a2",householdId:"house-a",learnerId:"learner-a",packageCode:"complete",status:"assigned",assignedEducatorId:"educator-a"},{id:"case-a3",householdId:"house-a",learnerId:"learner-a",packageCode:"complete",status:"assigned"});
  assert.throws(()=>repo.assignCase(actors.adminA,"case-a3","educator-a"),/capacity/);assert.throws(()=>repo.assignCase(actors.adminA,"case-a3","educator-b"),AccessDeniedError);
});

test("case messaging preserves household context and audit history", () => {
  const repo=createRepo(); repo.sendMessage(actors.guardianA,"case-a","Could we clarify the reading level?","clarification"); repo.sendMessage(actors.educatorA,"case-a","Yes, I added a follow-up question.");
  assert.equal(repo.listMessages(actors.guardianA,"case-a").length,2); assert.throws(()=>repo.sendMessage(actors.guardianB,"case-a","intrusion"),AccessDeniedError);
  assert.equal(repo.data.audits.filter((event)=>event.eventType==="message.sent").length,2);
});

test("case messaging assigns response ownership and tracks unread and overdue state", () => {
  const repo=createRepo(); const message=repo.sendMessage(actors.guardianA,"case-a","Could we clarify the reading level?","clarification");
  assert.equal(message.responseOwnerId,"educator-a"); assert.equal(message.readBy.includes("guardian-a"),true);
  let inbox=repo.messageInbox(actors.educatorA,"house-a",new Date("2026-08-31T15:00:01Z")); assert.equal(inbox[0].unread,true); assert.equal(inbox[0].responseOverdue,true);
  repo.markMessageRead(actors.educatorA,message.id); inbox=repo.messageInbox(actors.educatorA,"house-a"); assert.equal(inbox[0].unread,false);
  repo.resolveMessage(actors.educatorA,message.id); assert.equal(repo.messageInbox(actors.educatorA,"house-a",new Date("2026-09-01T00:00:00Z"))[0].responseOverdue,false);
  assert.throws(()=>repo.markMessageRead(actors.guardianB,message.id),AccessDeniedError);
});

test("delivery acknowledgement and package revision entitlement are enforced", () => {
  const repo=createRepo(); for (const state of ["intake_pending","submitted","triage","assigned","drafting","internal_review"]) repo.transitionCase(actors.educatorA,"case-a",state);
  repo.savePlanReview(actors.educatorA,"case-a",{curriculum:true,safeguarding:true,accessibility:true,resourceRights:true}); repo.transitionCase(actors.educatorA,"case-a","published");
  const delivery=repo.recordDelivery(actors.educatorA,"case-a","secure_portal",1); assert.equal(repo.getCase(actors.guardianA,"case-a").status,"delivered");
  repo.acknowledgeDelivery(actors.guardianA,delivery.id); assert.equal(repo.getCase(actors.guardianA,"case-a").status,"acknowledged");
  const revision=repo.requestRevision(actors.guardianA,"case-a","Please adjust the reading load."); assert.equal(revision.status,"requested");
  assert.throws(()=>repo.requestRevision(actors.guardianA,"case-a","Another change"),/Delivery must be acknowledged|No included revisions remain/);
});

test("accepted revision is versioned reviewed summarized and re-delivered",()=>{
  const repo=createRepo();for(const state of ["intake_pending","submitted","triage","assigned","drafting"])repo.transitionCase(actors.educatorA,"case-a",state);
  const original=repo.createPlanVersion(actors.educatorA,"case-a",{weeks:[{number:1,theme:"Original"}]});repo.transitionCase(actors.educatorA,"case-a","internal_review");repo.savePlanReview(actors.educatorA,"case-a",{curriculum:true,safeguarding:true,accessibility:true,resourceRights:true});repo.transitionCase(actors.educatorA,"case-a","published");
  const firstDelivery=repo.recordDelivery(actors.educatorA,"case-a","secure_portal",1);repo.acknowledgeDelivery(actors.guardianA,firstDelivery.id);const request=repo.requestRevision(actors.guardianA,"case-a","Reduce reading load");
  assert.equal(repo.decideRevision(actors.educatorA,request.id,"accepted","Within package scope").status,"accepted");const revised=repo.createPlanVersion(actors.educatorA,"case-a",{weeks:[{number:1,theme:"Reduced reading load"}]});assert.equal(repo.data.plans.find((plan)=>plan.id===original.id).status,"published");
  repo.savePlanReview(actors.educatorA,"case-a",{curriculum:true,safeguarding:true,accessibility:true,resourceRights:true});const completed=repo.completeRevision(actors.educatorA,request.id,"Shortened passages and added audio alternatives");
  assert.equal(completed.completedPlanId,revised.id);assert.equal(repo.data.plans.find((plan)=>plan.id===original.id).status,"archived");assert.equal(repo.getCase(actors.guardianA,"case-a").status,"revised");
  const secondDelivery=repo.recordDelivery(actors.educatorA,"case-a","secure_portal",2);assert.equal(secondDelivery.artifactVersion,2);repo.acknowledgeDelivery(actors.guardianA,secondDelivery.id);assert.equal(repo.getCase(actors.guardianA,"case-a").status,"acknowledged");
});

test("declined revision requires a reason and restores acknowledged state",()=>{
  const repo=createRepo();repo.data.cases[0].status="acknowledged";const request=repo.requestRevision(actors.guardianA,"case-a","Add a new subject");assert.throws(()=>repo.decideRevision(actors.educatorA,request.id,"declined",""),/decline reason/);const declined=repo.decideRevision(actors.educatorA,request.id,"declined","Outside package scope");assert.equal(declined.status,"declined");assert.equal(repo.getCase(actors.guardianA,"case-a").status,"acknowledged");
});

test("payment ingestion handles refunds and chargebacks as audited terminal states", () => {
  const repo=createRepo();
  assert.throws(()=>repo.ingestPaymentStatus(actors.educatorA,"case-a","order-a","refunded"),AccessDeniedError);
  const order=repo.ingestPaymentStatus(actors.adminA,"case-a","order-a","chargeback");
  assert.equal(order.paymentStatus,"chargeback"); assert.equal(repo.getCase(actors.guardianA,"case-a").status,"chargeback");
  assert.ok(repo.data.audits.some((event)=>event.eventType==="payment.status_ingested"));
});

test("educator absence removes the assignment and preserves the resumable state", () => {
  const repo=createRepo(); for (const state of ["intake_pending","submitted","triage","assigned"]) repo.transitionCase(actors.educatorA,"case-a",state);
  repo.assignCase(actors.adminA,"case-a","educator-a");
  const held=repo.recordEducatorAbsence(actors.adminA,"case-a","Unexpected leave");
  assert.equal(held.status,"on_hold"); assert.equal(held.previousOperationalStatus,"assigned"); assert.equal(held.assignedEducatorId,null);
  assert.ok(repo.data.audits.some((event)=>event.eventType==="educator.absence_recorded"));
});

test("overdue evaluation only changes eligible due cases visible to the admin", () => {
  const repo=createRepo(); for (const state of ["intake_pending","submitted","triage"]) repo.transitionCase(actors.educatorA,"case-a",state);
  repo.data.cases[0].slaDueAt="2026-08-27T15:00:00Z";
  const changed=repo.markOverdueCases(actors.adminA,new Date("2026-08-28T15:00:00Z"));
  assert.equal(changed.length,1); assert.equal(repo.getCase(actors.guardianA,"case-a").status,"overdue");
  assert.ok(repo.data.audits.some((event)=>event.eventType==="case.marked_overdue"));
});

test("failed and bounced deliveries can be retried with an audited attempt count", () => {
  const repo=createRepo(); for (const state of ["intake_pending","submitted","triage","assigned","drafting","internal_review"]) repo.transitionCase(actors.educatorA,"case-a",state);
  repo.savePlanReview(actors.educatorA,"case-a",{curriculum:true,safeguarding:true,accessibility:true,resourceRights:true}); repo.transitionCase(actors.educatorA,"case-a","published");
  const delivery=repo.recordDelivery(actors.educatorA,"case-a","secure_portal",1);
  assert.equal(repo.recordDeliveryFailure(actors.educatorA,delivery.id,"bounced","Mailbox unavailable").status,"bounced");
  const retried=repo.retryDelivery(actors.educatorA,delivery.id); assert.equal(retried.status,"sent"); assert.equal(retried.attemptCount,2); assert.equal(retried.lastError,null);
  assert.ok(repo.data.audits.some((event)=>event.eventType==="delivery.retried"));
});

test("versioned plan authoring records named authors and immutable history", () => {
  const repo=createRepo(); for (const state of ["intake_pending","submitted","triage","assigned","drafting"]) repo.transitionCase(actors.educatorA,"case-a",state);
  const first=repo.createPlanVersion(actors.educatorA,"case-a",{weeks:[{number:1,theme:"Patterns"}]});
  const second=repo.createPlanVersion(actors.educatorA,"case-a",{weeks:[{number:1,theme:"Revised patterns"}]});
  assert.equal(first.version,1); assert.equal(second.version,2); assert.equal(second.authoredBy,"educator-a"); assert.equal(repo.data.plans[0].content.weeks[0].theme,"Patterns");
  assert.throws(()=>repo.createPlanVersion(actors.guardianA,"case-a",{weeks:[{}]}),AccessDeniedError);
});

test("resource governance blocks publication until rights privacy links region and substitutes pass", () => {
  const repo=createRepo(); for (const state of ["intake_pending","submitted","triage","assigned","drafting"]) repo.transitionCase(actors.educatorA,"case-a",state);
  const plan=repo.createPlanVersion(actors.educatorA,"case-a",{weeks:[{number:1,theme:"Patterns"}]});
  repo.addResource(actors.educatorA,plan.id,{lessonId:"lesson-1",title:"Pattern cards",url:"https://example.test/cards",requirement:"required",accessType:"free",region:"Canada"});
  repo.transitionCase(actors.educatorA,"case-a","internal_review"); repo.savePlanReview(actors.educatorA,"case-a",{curriculum:true,safeguarding:true,accessibility:true,resourceRights:true});
  assert.throws(()=>repo.transitionCase(actors.educatorA,"case-a","published"),/Resource governance is incomplete/);
  Object.assign(repo.data.resources[0],{privacyReviewedAt:"2026-08-28",rightsReviewedAt:"2026-08-28",linkCheckedAt:"2026-08-28",attribution:"BriteLink original",substituteResourceId:"resource-household-cards"});
  assert.equal(repo.checkResourceGovernance(actors.guardianA,plan.id).ready,true);
  assert.equal(repo.transitionCase(actors.educatorA,"case-a","published").status,"published");
  assert.equal(repo.data.plans[0].status,"published");
});

test("deletion request soft-deletes household and learners with an audit event", () => {
  const repo=createRepo(); const result=repo.deleteHousehold(actors.guardianA,"house-a"); assert.equal(result.deletedAt,"2026-08-28T15:00:00.000Z");
  assert.equal(repo.listLearners(actors.adminA,"house-a").length,0); assert.ok(repo.data.audits.some((event)=>event.eventType==="privacy.deletion_requested"));
});

test("profile corrections create a new version and preserve the original", () => {
  const repo=createRepo(); const first=repo.saveProfile(actors.guardianA,"house-a","learner-a",{goals:"Reading"},{noticeVersion:"v1",purposes:["planning"]});
  const corrected=repo.correctProfile(actors.guardianA,"house-a",first.id,{goals:"Reading and writing"},"Guardian clarified the goal");
  assert.equal(corrected.version,2); assert.equal(corrected.correctsProfileId,first.id); assert.equal(repo.data.profiles[0].planningContext.goals,"Reading");
  assert.ok(repo.data.audits.some((event)=>event.eventType==="profile.corrected"));
});

test("retention evaluation is deterministic and does not itself delete records", () => {
  const repo=createRepo(); repo.deleteHousehold(actors.guardianA,"house-a");
  const candidates=repo.retentionCandidates(actors.adminA,"house-a",{deletedHouseholdDays:30},new Date("2026-09-28T15:00:00Z"));
  assert.deepEqual(candidates.household,["house-a"]); assert.equal(repo.data.households.some((item)=>item.id==="house-a"),true);
  assert.throws(()=>repo.retentionCandidates(actors.guardianA,"house-a"),AccessDeniedError);
});

test("staff offboarding removes access and places assigned work safely on hold", () => {
  const repo=createRepo(); for (const state of ["intake_pending","submitted","triage","assigned"]) repo.transitionCase(actors.educatorA,"case-a",state); repo.assignCase(actors.adminA,"case-a","educator-a");
  repo.offboardMember(actors.adminA,"house-a","educator-a","Contract ended");
  assert.throws(()=>repo.getCase(actors.educatorA,"case-a"),AccessDeniedError); assert.equal(repo.getCase(actors.adminA,"case-a").status,"on_hold");
  assert.throws(()=>repo.offboardMember(actors.adminA,"house-a","guardian-a","Requested"),/last guardian/);
});
