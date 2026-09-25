import assert from "node:assert/strict";
import test from "node:test";
import { requireDate, requireEmail, requireHttpUrl, requireIdentifier, requireIsoTimestamp, validateAttachmentFile, validateDeletionRequest, validateGuardianIntake, validateLearningCapture, validateLessonActivityInput, validateMessageInput, validateMessageReadInput, validateRevisionRequest, validateStaffPlanDocument, validateStaffResource } from "../src/input-validation.js";

test("identifiers reject empty, control, path, and oversized values",()=>{
  for(const value of ["","../house","house a","house\nadmin","a".repeat(129)]) assert.throws(()=>requireIdentifier(value),/invalid/);
  assert.equal(requireIdentifier("household_01-a"),"household_01-a");
});

test("attachment validation allows only bounded scan-compatible files",()=>{
  const file={name:"lesson-plan.pdf",type:"application/pdf",size:1024,arrayBuffer:async()=>new ArrayBuffer(1)};assert.equal(validateAttachmentFile(file).name,"lesson-plan.pdf");
  for(const invalid of [{...file,name:"../plan.pdf"},{...file,type:"application/zip"},{...file,size:0},{...file,size:10485761},{...file,arrayBuffer:null}])assert.throws(()=>validateAttachmentFile(invalid),/Attachment/);
});

test("emails are normalized and bounded",()=>{
  assert.equal(requireEmail(" Guardian@Example.ca "),"guardian@example.ca");
  for(const value of ["guardian","@example.ca",`${"a".repeat(250)}@x.ca`]) assert.throws(()=>requireEmail(value),/valid email/);
});

test("redirect URLs reject executable schemes and embedded credentials",()=>{
  assert.equal(requireHttpUrl("https://app.britelink.org/auth"),"https://app.britelink.org/auth");
  for(const value of ["javascript:alert(1)","data:text/html,test","https://user:secret@example.ca/"]) assert.throws(()=>requireHttpUrl(value),/invalid/);
});

test("timestamps require a real ISO instant with an explicit timezone",()=>{
  assert.equal(requireIsoTimestamp("2026-08-28T11:00:00-04:00"),"2026-08-28T15:00:00.000Z");
  for(const value of ["2026-08-28","2026-08-28T15:00:00","not-a-date","2026-02-30T15:00:00Z"]) assert.throws(()=>requireIsoTimestamp(value),/invalid/);
});

test("calendar dates reject rollover and non-ISO values",()=>{
  assert.equal(requireDate("2026-09-14"),"2026-09-14");
  for(const value of ["2026-9-14","2026-02-30","tomorrow"])assert.throws(()=>requireDate(value),/invalid/);
});

test("lesson activity input enforces scope status and note limits",()=>{
  const valid=validateLessonActivityInput({householdId:"house-a",learnerId:"learner-a",lessonId:"lesson-1",userId:"guardian-a",status:"paused",note:" Resume tomorrow ",scheduleReason:"illness",scheduledFor:"2026-09-14"});
  assert.equal(valid.note,"Resume tomorrow");
  assert.equal(valid.scheduleReason,"illness"); assert.equal(valid.scheduledFor,"2026-09-14");
  assert.throws(()=>validateLessonActivityInput({...valid,status:"deleted"}),/status is invalid/);
  assert.throws(()=>validateLessonActivityInput({...valid,note:"x".repeat(2001)}),/Caregiver note/);
  assert.throws(()=>validateLessonActivityInput({...valid,scheduledFor:""}),/provided together/);
  assert.throws(()=>validateLessonActivityInput({...valid,scheduleReason:"weather"}),/Schedule reason/);
});

test("message input trims content and rejects unknown kinds or oversized bodies",()=>{
  const valid=validateMessageInput({householdId:"house-a",caseId:"case-a",userId:"guardian-a",kind:"clarification",body:" Question ",responseDueAt:"2026-08-28T11:00:00-04:00"}); assert.equal(valid.body,"Question"); assert.equal(valid.responseDueAt,"2026-08-28T15:00:00.000Z");
  assert.throws(()=>validateMessageInput({...valid,kind:"broadcast"}),/kind is invalid/);
  assert.throws(()=>validateMessageInput({...valid,body:"x".repeat(4001)}),/Message body/);
  assert.throws(()=>validateMessageInput({...valid,responseDueAt:"tomorrow"}),/Response due time/);
});

test("message read acknowledgement validates scope and normalizes its timestamp",()=>{
  const valid=validateMessageReadInput({householdId:"house-a",messageId:"message-a",userId:"user-a"},()=>"2026-08-28T15:00:00Z");
  assert.equal(valid.readAt,"2026-08-28T15:00:00.000Z");
  assert.throws(()=>validateMessageReadInput({...valid,readAt:"soon"}),/Read time/);
});

const intake={householdId:"house-a",learnerId:"learner-a",noticeVersion:"notice-v1",guardianConsent:true,planningStructure:"weekly_goals",subjects:["Language","Math"],priorAttainment:"Reads short paragraphs and counts to 100.",strengthsInterests:"Enjoys machines and drawing.",goals:"Build reading fluency.",learningSupports:"Short instructions and movement breaks.",language:"English",weeklySchedule:"Weekday mornings",caregiverAvailability:"Thirty minutes after breakfast",deviceAccess:"computer_printer",resourceBudget:"free_only",contentConstraints:"Avoid frightening content",accessibilityNeeds:"Large type when possible"};

test("guardian intake is bounded, purpose-limited, and normalized",()=>{
  const valid=validateGuardianIntake({...intake,subjects:["Language","Language","Math"]});
  assert.deepEqual(valid.purposes,["personalized_learning_plan"]); assert.deepEqual(valid.context.subjects,["Language","Math"]); assert.equal(valid.context.goals,"Build reading fluency.");
});

test("guardian intake rejects missing consent, invented subjects, invalid options, and oversized text",()=>{
  assert.throws(()=>validateGuardianIntake({...intake,guardianConsent:false}),/consent is required/);
  assert.throws(()=>validateGuardianIntake({...intake,subjects:["Diagnosis"]}),/valid subject/);
  assert.throws(()=>validateGuardianIntake({...intake,deviceAccess:"always_online"}),/Device access/);
  assert.equal(validateGuardianIntake(intake).context.planningStructure,"weekly_goals");
  assert.throws(()=>validateGuardianIntake({...intake,planningStructure:"school_at_home"}),/How you like to plan/);
  assert.throws(()=>validateGuardianIntake({...intake,planningStructure:""}),/How you like to plan/);
  assert.throws(()=>validateGuardianIntake({...intake,goals:"x".repeat(1001)}),/Learning goals/);
});

test("revision and deletion requests are bounded and explicitly confirmed",()=>{
  assert.equal(validateRevisionRequest({householdId:"house-a",caseId:"case-a",reason:" Reduce reading load "}).reason,"Reduce reading load");
  assert.throws(()=>validateRevisionRequest({householdId:"house-a",caseId:"case-a",reason:""}),/Revision reason/);assert.throws(()=>validateRevisionRequest({householdId:"house-a",caseId:"case-a",reason:"x".repeat(2001)}),/Revision reason/);
  assert.deepEqual(validateDeletionRequest({householdId:"house-a",reason:" Finished service ",confirmed:true}),{householdId:"house-a",reason:"Finished service"});assert.throws(()=>validateDeletionRequest({householdId:"house-a",confirmed:false}),/Confirm/);
});

test("staff plan documents validate nested weeks days lessons and bounded learning content",()=>{
  const document={weeks:[{number:1,theme:" Patterns ",days:[{number:1,plannedDate:"2026-09-01",lessons:[{subject:" Math ",title:"Find patterns",objective:"Explain a repeating pattern",instructions:["Choose three objects"],materials:["Blocks"],accommodations:["Use larger pieces"],adultHelpMinutes:10}]}]}]};const valid=validateStaffPlanDocument(document);assert.equal(valid.weeks[0].theme,"Patterns");assert.equal(valid.weeks[0].days[0].lessons[0].position,1);assert.equal(valid.weeks[0].days[0].lessons[0].subject,"Math");
  assert.throws(()=>validateStaffPlanDocument({weeks:[]}),/1 to 52 weeks/);assert.throws(()=>validateStaffPlanDocument({weeks:[{number:1,theme:"Week",days:[{number:1,lessons:[{subject:"Math",title:"Title",objective:"Goal",instructions:[]}]}]}]}),/instructions/);assert.throws(()=>validateStaffPlanDocument({...document,weeks:[{...document.weeks[0],days:[{...document.weeks[0].days[0],plannedDate:"2026-02-30"}]}]}),/Planned date/);
});

test("staff resources require safe classifications HTTPS and review evidence fields",()=>{
  const valid=validateStaffResource({title:" Cards ",url:"https://example.test/cards",requirement:"optional",accessType:"free",region:"Canada",privacyReviewedAt:"2026-08-28T15:00:00Z",rightsReviewedAt:"2026-08-28T15:00:00Z",linkCheckedAt:"2026-08-28T15:00:00Z",attribution:"Original"});assert.equal(valid.title,"Cards");assert.equal(valid.url,"https://example.test/cards");assert.equal(valid.privacyReviewedAt,"2026-08-28T15:00:00.000Z");assert.throws(()=>validateStaffResource({...valid,url:"http://example.test"}),/HTTPS/);assert.throws(()=>validateStaffResource({...valid,accessType:"subscription"}),/Resource access/);
});

test("lesson fit tags are optional, bounded, and never guessed", () => {
  const plan = (lesson) => ({ weeks: [{ number: 1, theme: "Week", days: [{ number: 1, lessons: [{ subject: "Math", title: "Title", objective: "Goal", instructions: ["Do it"], ...lesson }] }] }] });
  const first = (lesson) => validateStaffPlanDocument(plan(lesson)).weeks[0].days[0].lessons[0];
  assert.deepEqual([first({}).estimatedMinutes, first({}).helpLevel, first({}).needsScreen], [null, null, null]);
  assert.deepEqual([first({ estimatedMinutes: "25", helpLevel: "independent", needsScreen: "false" }).estimatedMinutes, first({ helpLevel: "together" }).helpLevel, first({ needsScreen: "false" }).needsScreen, first({ needsScreen: true }).needsScreen], [25, "together", false, true]);
  assert.throws(() => first({ estimatedMinutes: 4 }), /5 to 240/);
  assert.throws(() => first({ estimatedMinutes: 241 }), /5 to 240/);
  assert.throws(() => first({ estimatedMinutes: 12.5 }), /5 to 240/);
  assert.throws(() => first({ helpLevel: "mostly" }), /Help level/);
  assert.throws(() => first({ needsScreen: "maybe" }), /screen/);
});

test("a learning capture is bounded to known kinds and subjects, with a required short note", () => {
  const base = { householdId: "house-a", learnerId: "learner-a", capturedOn: "2026-09-20", kind: "outing", subjects: ["Science", "Science"], note: " Pond walk " };
  const valid = validateLearningCapture(base);
  assert.deepEqual([valid.kind, valid.subjects, valid.note], ["outing", ["Science"], "Pond walk"]);
  assert.throws(() => validateLearningCapture({ ...base, kind: "therapy" }), /What kind of learning/);
  assert.throws(() => validateLearningCapture({ ...base, subjects: ["Diagnosis"] }), /valid subjects/);
  assert.throws(() => validateLearningCapture({ ...base, note: "" }), /What happened/);
  assert.throws(() => validateLearningCapture({ ...base, note: "x".repeat(1001) }), /What happened/);
  assert.throws(() => validateLearningCapture({ ...base, capturedOn: "yesterday" }), /Date/);
});
