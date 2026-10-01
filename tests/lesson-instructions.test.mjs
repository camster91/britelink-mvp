import assert from 'node:assert/strict';
import test from 'node:test';
import {lessonInstructionTexts,printableDays} from '../src/authenticated-workspace.js';
import {planToAuthoringWeeks} from '../src/staff-drafts.js';

test('current strings and stored structured lesson steps have identical display text without changing stored records',()=>{
  const structured=[{step:1,text:'Gather counters'},{step:2,text:'Sort by colour'}];
  const original=structuredClone(structured);
  assert.deepEqual(lessonInstructionTexts(structured),['Gather counters','Sort by colour']);
  assert.deepEqual(lessonInstructionTexts(['Gather counters','Sort by colour']),lessonInstructionTexts(structured));
  assert.deepEqual(structured,original);
});
test('absent or incomplete instruction values do not become React object children',()=>{
  assert.deepEqual(lessonInstructionTexts(null),[]);
  assert.deepEqual(lessonInstructionTexts([null,{},7,'',{step:1,text:'Read aloud'}]),['Read aloud']);
});
test('printed plans retain text from stored structured instructions',()=>{
  const weeks=[{week_number:1,plan_days:[{id:'day',day_number:1,lessons:[{id:'lesson',instructions:[{step:1,text:'Gather counters'}]}]}]}];
  assert.deepEqual(printableDays(weeks)[0].lessons[0].instructions,['Gather counters']);
});
test('editing a stored structured plan retains instruction text instead of object stringification',()=>{
  const plan={plan_weeks:[{plan_days:[{lessons:[{instructions:[{step:1,text:'Read aloud'},{step:2,text:'Describe the picture'}]}]}]}]};
  const original=structuredClone(plan);
  assert.equal(planToAuthoringWeeks(plan)[0].days[0].lessons[0].instructions,'Read aloud\nDescribe the picture');
  assert.deepEqual(plan,original);
});
