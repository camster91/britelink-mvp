import assert from "node:assert/strict";
import test from "node:test";
import { activityMap, caseForLearner, dayMovedTo, latestPublishedPlan, lessonFit, lessonFitSummary, localDateString, messageIsUnread, planDayDates, withDayOff, withoutDayOff, nextLessonForToday, orderedPlanWeeks, dueLessonsForToday, planDayMove, planSubjects, printableDays, weekBounds, weeklyStory } from "../src/authenticated-workspace.js";

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

test("moving a day carries only unfinished lessons and keeps their status and note",()=>{
  const day={lessons:[{id:"done"},{id:"skipped"},{id:"started"},{id:"fresh"}]};
  const activities={done:{status:"completed"},skipped:{status:"skipped"},started:{status:"in_progress",caregiver_note:"Halfway through"}};
  assert.deepEqual(planDayMove(day,activities,{reason:"illness",scheduledFor:"2026-09-28"}),[
    {lessonId:"started",status:"in_progress",note:"Halfway through",scheduleReason:"illness",scheduledFor:"2026-09-28"},
    {lessonId:"fresh",status:"not_started",note:"",scheduleReason:"illness",scheduledFor:"2026-09-28"},
  ]);
  assert.deepEqual(planDayMove({lessons:[{id:"done"}]},{done:{status:"completed"}},{reason:"travel",scheduledFor:"2026-09-28"}),[]);
  assert.throws(()=>planDayMove(day,activities,{reason:"illness"}),/reason and a new date/);
  assert.throws(()=>planDayMove(day,activities,{scheduledFor:"2026-09-28"}),/reason and a new date/);
});

test("a day reports its new date only when every unfinished lesson shares it",()=>{
  const day={lessons:[{id:"a"},{id:"b"},{id:"c"}]};
  assert.equal(dayMovedTo(day,{a:{scheduled_for:"2026-09-28"},b:{scheduled_for:"2026-09-28"},c:{status:"completed"}}),"2026-09-28");
  assert.equal(dayMovedTo(day,{a:{scheduled_for:"2026-09-28"},b:{scheduled_for:"2026-09-29"}}),null);
  assert.equal(dayMovedTo(day,{a:{scheduled_for:"2026-09-28"}}),null);
  assert.equal(dayMovedTo(day,{a:{status:"completed"},b:{status:"skipped"},c:{status:"completed"}}),null);
});

test("today's next lesson skips work moved to a later date and never reports moved work as done",()=>{
  const weeks=[{week_number:1,plan_days:[{day_number:1,lessons:[{id:"a"},{id:"b"}]},{day_number:2,lessons:[{id:"c"}]}]}];
  const pick=(activities,today)=>{const r=nextLessonForToday(weeks,activities,today);return r.kind==="done"?"done":`${r.kind}:${r.lesson.id}${r.resumesOn?`@${r.resumesOn}`:""}`};
  assert.equal(pick({},"2026-09-10"),"due:a");
  // a is moved ahead: b is next today.
  assert.equal(pick({a:{scheduled_for:"2026-09-15"}},"2026-09-10"),"due:b");
  // Moved to today, or to a day already past, is due now and keeps plan order.
  assert.equal(pick({a:{scheduled_for:"2026-09-10"}},"2026-09-10"),"due:a");
  assert.equal(pick({a:{scheduled_for:"2026-09-01"}},"2026-09-10"),"due:a");
  // Everything left is moved ahead: report the earliest resume date, not "done".
  assert.equal(pick({a:{scheduled_for:"2026-09-20"},b:{scheduled_for:"2026-09-15"},c:{status:"completed"}},"2026-09-10"),"later:b@2026-09-15");
  assert.equal(pick({a:{status:"completed"},b:{status:"skipped"},c:{status:"completed"}},"2026-09-10"),"done");
  assert.throws(()=>nextLessonForToday(weeks,{},"10/09/2026"),/YYYY-MM-DD/);
});

test("local date string uses the family's own calendar day",()=>{
  assert.equal(localDateString(new Date(2026,0,5,23,59)),"2026-01-05");
  assert.equal(localDateString(new Date(2026,11,31,0,0)),"2026-12-31");
});

test("the family calendar places plan days on school days, around days off and fixed dates",()=>{
  const weeks=[{plan_days:[{id:"d1"},{id:"d2"},{id:"d3",planned_date:"2026-10-08"},{id:"d4"},{id:"d5"}]}];
  // 2026-10-05 is a Monday. School Mon/Tue/Thu/Fri; Tue 6th is off; Thu 8th is an educator-fixed day.
  assert.deepEqual(planDayDates(weeks,{start_date:"2026-10-05",school_days:[1,2,4,5],days_off:["2026-10-06"]}),
    {d1:"2026-10-05",d2:"2026-10-09",d3:"2026-10-08",d4:"2026-10-12",d5:"2026-10-13"});
  // Own pace: only educator-set dates exist.
  assert.deepEqual(planDayDates(weeks,{start_date:null,school_days:[1]}),{d1:null,d2:null,d3:"2026-10-08",d4:null,d5:null});
  assert.deepEqual(planDayDates(weeks,null).d3,"2026-10-08");
  // A start date that is not a school day rolls forward to the first one (Sat 10th -> Mon 12th).
  assert.equal(planDayDates([{plan_days:[{id:"x"}]}],{start_date:"2026-10-10",school_days:[1,2,3,4,5],days_off:[]}).x,"2026-10-12");
  assert.throws(()=>planDayDates(weeks,{start_date:"2026-10-05",school_days:[]}),/at least one school day/);
});

test("taking a day off shifts the rest of the plan by one school day and can be undone",()=>{
  const schedule={start_date:"2026-10-05",school_days:[1,2,3,4,5],days_off:[]};
  const weeks=[{plan_days:[{id:"a"},{id:"b"},{id:"c"}]}];
  const off=withDayOff(schedule,"2026-10-06");
  assert.deepEqual(off,["2026-10-06"]);
  assert.deepEqual(planDayDates(weeks,{...schedule,days_off:off}),{a:"2026-10-05",b:"2026-10-07",c:"2026-10-08"});
  assert.deepEqual(withoutDayOff({...schedule,days_off:off},"2026-10-06"),[]);
  assert.equal(withDayOff(schedule,"2026-10-10"),null,"a Saturday is not a school day");
  assert.equal(withDayOff({...schedule,days_off:["2026-10-06"]},"2026-10-06"),null,"already off");
  assert.equal(withDayOff(schedule,"2026-10-02"),null,"before the plan starts");
  assert.equal(withDayOff({...schedule,start_date:null},"2026-10-06"),null,"own pace has no days to take off");
});

test("today's next lesson follows the family calendar",()=>{
  const weeks=[{week_number:1,plan_days:[{id:"d1",day_number:1,lessons:[{id:"a"}]},{id:"d2",day_number:2,lessons:[{id:"b"}]}]}];
  const dates={d1:"2026-10-05",d2:"2026-10-06"};
  const r=nextLessonForToday(weeks,{a:{status:"completed"}},"2026-10-05",dates);
  assert.deepEqual([r.kind,r.lesson.id,r.resumesOn],["later","b","2026-10-06"]);
  assert.equal(nextLessonForToday(weeks,{},"2026-10-07",dates).lesson.id,"a","yesterday's unfinished work is still due, in order");
  assert.equal(nextLessonForToday(weeks,{a:{scheduled_for:"2026-10-01"}},"2026-10-02",dates).lesson.id,"a","a lesson's own move beats the calendar");
});

test("what fits today picks a fitting lesson, never assumes an untagged one fits, and falls back honestly",()=>{
  const tagged=(id,minutes,help,screen)=>({id,estimated_minutes:minutes,help_level:help,needs_screen:screen});
  const weeks=[{week_number:1,plan_days:[{id:"d",day_number:1,lessons:[tagged("long",60,"together",true),{id:"untagged"},tagged("short",15,"independent",false)]}]}];
  const pick=(filters)=>{const r=nextLessonForToday(weeks,{},"2026-10-05",{},filters);return `${r.lesson.id}${r.fit?`:${r.fit}`:""}`};
  assert.equal(pick({}),"long","no filters keeps plan order");
  assert.equal(pick({maxMinutes:30}),"short:fits");
  assert.equal(pick({alone:true,offline:true}),"short:fits");
  // Nothing tagged fits 10 minutes: the untagged lesson is offered as unknown before "nothing fits".
  assert.equal(pick({maxMinutes:10}),"untagged:unknown");
  const onlyTagged=[{week_number:1,plan_days:[{id:"d",day_number:1,lessons:[tagged("long",60,"together",true),tagged("mid",30,"some_help",true)]}]}];
  const r=nextLessonForToday(onlyTagged,{},"2026-10-05",{},{maxMinutes:10});
  assert.deepEqual([r.lesson.id,r.fit],["mid","none"],"nothing fits: offer the shortest");
  assert.equal(lessonFit({},{alone:true}),"unknown");
  assert.equal(lessonFit(tagged("x",20,"independent",true),{offline:true}),"no");
  assert.equal(lessonFitSummary(tagged("x",20,"independent",false)),"About 20 min · child can do it alone · no screen needed");
  assert.equal(lessonFitSummary({}),"");
});

test("a printed week or day carries dates, steps, and what is already done",()=>{
  const weeks=[{week_number:2,plan_days:[{id:"d1",day_number:1,lessons:[{id:"a",subject:"Math",title:"Count",objective:"Count to 20",instructions:["Count"],materials:["Beans"],estimated_minutes:15}]},{id:"d2",day_number:2,lessons:[{id:"b",subject:"Art",title:"Draw",objective:"Draw a leaf",instructions:["Look","Draw"]}]}]}];
  const week=printableDays(weeks,{scope:"week",weekIndex:0},{d1:"2026-10-05"},{a:{status:"completed"},b:{scheduled_for:"2026-10-09"}});
  assert.deepEqual(week.map(day=>[day.heading,day.date]),[["Week 2 · Day 1","2026-10-05"],["Week 2 · Day 2",null]]);
  assert.deepEqual([week[0].lessons[0].done,week[0].lessons[0].fit,week[1].lessons[0].movedTo,week[1].lessons[0].materials],["completed","About 15 min","2026-10-09",[]]);
  assert.deepEqual(printableDays(weeks,{scope:"day",weekIndex:0,dayIndex:1}).map(day=>day.id),["d2"]);
  assert.deepEqual(printableDays(weeks,{scope:"week",weekIndex:5}),[]);
});

test("the weekly story counts what happened in the family's Monday-to-Sunday week, without judgement",()=>{
  assert.deepEqual(weekBounds("2026-10-07"),{start:"2026-10-05",end:"2026-10-11"},"a Wednesday belongs to the week starting Monday");
  assert.deepEqual(weekBounds("2026-10-11"),{start:"2026-10-05",end:"2026-10-11"},"Sunday closes the week");
  assert.deepEqual(weekBounds("2026-10-07",-1),{start:"2026-09-28",end:"2026-10-04"});
  const weeks=[{plan_days:[{lessons:[{id:"a",title:"Count",subject:"Math"},{id:"b",title:"Read",subject:"Language"},{id:"c",title:"Old",subject:"Arts"}]}]}];
  const local=(iso)=>iso.slice(0,10);
  const story=weeklyStory({weeks,today:"2026-10-07",toLocalDate:local,
    activities:[{lesson_id:"a",status:"completed",updated_at:"2026-10-06T15:00:00Z"},{lesson_id:"c",status:"completed",updated_at:"2026-09-30T15:00:00Z"},{lesson_id:"b",status:"not_started",scheduled_for:"2026-10-09",updated_at:"2026-10-06T15:00:00Z"}],
    captures:[{captured_on:"2026-10-05",subjects:["Science","Math"]},{captured_on:"2026-10-12",subjects:["Arts"]}],
    schedule:{days_off:["2026-10-08","2026-09-01"]}});
  assert.deepEqual(story.completed.map(item=>item.id),["a"],"only work finished this week");
  assert.equal(story.notes.length,1);
  assert.deepEqual(story.subjects,["Math","Science"]);
  assert.deepEqual(story.daysOff,["2026-10-08"]);
  assert.equal(story.moved,1);
  assert.equal(story.isEmpty,false);
  assert.equal(weeklyStory({weeks,today:"2026-10-07",offsetWeeks:3,toLocalDate:local}).isEmpty,true);
});

test("the student list is today's unfinished work, in order, and short",()=>{
  const weeks=[{plan_days:[{id:"d1",lessons:[{id:"a"},{id:"b"}]},{id:"d2",lessons:[{id:"c"}]},{id:"d3",lessons:[{id:"d"},{id:"e"},{id:"f"},{id:"g"}]}]}];
  const dates={d1:"2026-10-05",d2:"2026-10-06",d3:"2026-10-07"};
  assert.deepEqual(dueLessonsForToday(weeks,{a:{status:"completed"}},"2026-10-06",dates).map(l=>l.id),["b","c"],"yesterday's leftovers and today's, not tomorrow's");
  assert.deepEqual(dueLessonsForToday(weeks,{b:{scheduled_for:"2026-10-09"}},"2026-10-06",dates).map(l=>l.id),["a","c"],"moved-ahead work waits");
  assert.equal(dueLessonsForToday(weeks,{},"2026-10-07",dates).length,5,"capped at five");
  assert.deepEqual(dueLessonsForToday(weeks,{},"2026-10-06",{},2).map(l=>l.id),["a","b"],"own pace: the next few in order");
});

test("a paused subject is passed over by the next lesson and the student list, and resumes cleanly",()=>{
  const weeks=[{week_number:1,plan_days:[{id:"d",day_number:1,lessons:[{id:"fr",subject:"French"},{id:"ma",subject:"Math"},{id:"fr2",subject:"French"}]}]}];
  assert.deepEqual(planSubjects(weeks),["French","Math"]);
  assert.equal(nextLessonForToday(weeks,{},"2026-10-05",{},{paused:["French"]}).lesson.id,"ma");
  assert.equal(nextLessonForToday(weeks,{},"2026-10-05",{},{}).lesson.id,"fr");
  assert.deepEqual(dueLessonsForToday(weeks,{},"2026-10-05",{},5,["French"]).map(l=>l.id),["ma"]);
  assert.deepEqual(nextLessonForToday(weeks,{ma:{status:"completed"}},"2026-10-05",{},{paused:["French"]}),{kind:"paused",subjects:["French"]},"paused work is never reported as done");
});
