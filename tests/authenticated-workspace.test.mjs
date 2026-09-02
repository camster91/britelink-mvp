import assert from "node:assert/strict";
import test from "node:test";
import { activityMap, caseForLearner, latestPublishedPlan, messageIsUnread, orderedPlanWeeks } from "../src/authenticated-workspace.js";

test("latest plan selection ignores drafts and chooses the newest published version",()=>{
  const plan=latestPublishedPlan([{id:"draft",version:4,status:"draft"},{id:"v1",version:1,status:"published"},{id:"v3",version:3,status:"published"}]);
  assert.equal(plan.id,"v3");
  assert.equal(latestPublishedPlan([]),null);
});

test("weeks, days, and lessons are presented in authored order without mutating source",()=>{
  const source={plan_weeks:[{week_number:2,plan_days:[]},{week_number:1,plan_days:[{day_number:2,lessons:[]},{day_number:1,lessons:[{id:"second",position:2},{id:"first",position:1}]}]}]};
  const ordered=orderedPlanWeeks(source);
  assert.deepEqual(ordered.map(item=>item.week_number),[1,2]);
  assert.deepEqual(ordered[0].plan_days.map(item=>item.day_number),[1,2]);
  assert.deepEqual(ordered[0].plan_days[0].lessons.map(item=>item.id),["first","second"]);
  assert.equal(source.plan_weeks[0].week_number,2);
});

test("activity and message helpers remain learner and user specific",()=>{
  assert.equal(activityMap([{lesson_id:"lesson-a",status:"paused"}])["lesson-a"].status,"paused");
  const message={sender_user_id:"educator-a",case_message_reads:[{user_id:"guardian-b"}]};
  assert.equal(messageIsUnread(message,"guardian-a"),true);
  assert.equal(messageIsUnread(message,"guardian-b"),false);
  assert.equal(messageIsUnread({...message,sender_user_id:"guardian-a"},"guardian-a"),false);
});

test("case selection never falls through to another learner",()=>{
  const cases=[{id:"case-a",learner_id:"learner-a"},{id:"case-b",learner_id:"learner-b"}];
  assert.equal(caseForLearner(cases,"learner-b").id,"case-b");
  assert.equal(caseForLearner(cases,"learner-c"),null);
});
