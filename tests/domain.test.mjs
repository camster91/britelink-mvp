import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateProgress,
  createDemoPlan,
  findNextLesson,
  getLessonStatus,
  safeParseStored,
  statusLabel,
  updateLessonActivity,
  updateLessonSchedule,
  validateProfile,
} from "../src/domain.js";

test("demo plan contains eight distinct weeks and five distinct days per week", () => {
  const plan = createDemoPlan();
  assert.equal(plan.weeks.length, 8);
  assert.ok(plan.weeks.every((week) => week.days.length === 5));
  const ids = plan.weeks.flatMap((week) => week.days.flatMap((day) => day.lessons.map((lesson) => lesson.id)));
  assert.equal(ids.length, 160);
  assert.equal(new Set(ids).size, 160);
});

test("lesson activity is scoped by lesson id and does not leak across weeks", () => {
  const plan = createDemoPlan();
  const first = plan.weeks[0].days[0].lessons[0].id;
  const secondWeek = plan.weeks[1].days[0].lessons[0].id;
  const activity = updateLessonActivity({}, first, "completed", "Finished after lunch");
  assert.equal(getLessonStatus(activity, first), "completed");
  assert.equal(getLessonStatus(activity, secondWeek), "not_started");
  assert.equal(activity[first].note, "Finished after lunch");
});

test("progress counts completed lessons across the full plan", () => {
  const plan = createDemoPlan();
  const ids = plan.weeks[0].days[0].lessons.map((lesson) => lesson.id);
  const activity = ids.reduce((state, id) => updateLessonActivity(state, id, "completed"), {});
  assert.deepEqual(calculateProgress(plan, activity), { completed: 4, total: 160, percent: 3 });
});

test("rescheduling records a real exception without losing lesson work", () => {
  const lessonId = createDemoPlan().weeks[0].days[0].lessons[0].id;
  const started = updateLessonActivity({}, lessonId, "paused", "Resume after chapter two");
  const moved = updateLessonSchedule(started, lessonId, "illness", "2026-09-14");
  assert.equal(moved[lessonId].status, "paused");
  assert.equal(moved[lessonId].note, "Resume after chapter two");
  assert.equal(moved[lessonId].scheduleReason, "illness");
  assert.equal(moved[lessonId].scheduledFor, "2026-09-14");
  assert.throws(() => updateLessonSchedule(started, lessonId, "unknown", "2026-09-14"), /Unknown schedule reason/);
  assert.throws(() => updateLessonSchedule(started, lessonId, "travel", "tomorrow"), /valid reschedule date/);
});

test("profile validation requires planning context and guardian consent", () => {
  const errors = validateProfile({ grade: "", jurisdiction: "", interests: "", goals: "", guardianConsent: false });
  assert.deepEqual(Object.keys(errors).sort(), ["goals", "grade", "guardianConsent", "interests", "jurisdiction"]);
  assert.deepEqual(validateProfile({ grade: "4", jurisdiction: "Ontario", interests: "Machines", goals: "Reading", guardianConsent: true }), {});
});

test("next lesson is the first incomplete block and skips finished work", () => {
  const plan = createDemoPlan();
  const first = plan.weeks[0].days[0].lessons[0];
  const second = plan.weeks[0].days[0].lessons[1];
  assert.equal(findNextLesson(plan, {}).lesson.id, first.id);
  assert.equal(statusLabel("in_progress"), "In progress");
  const started = updateLessonActivity({}, first.id, "completed");
  assert.equal(findNextLesson(plan, started).lesson.id, second.id);
  const allDone = plan.weeks.flatMap((week) => week.days.flatMap((day) => day.lessons)).reduce(
    (state, lesson) => updateLessonActivity(state, lesson.id, lesson.id.endsWith("-l1") ? "skipped" : "completed"),
    {},
  );
  assert.equal(findNextLesson(plan, allDone), null);
});

test("stored JSON parsing fails safely", () => {
  assert.deepEqual(safeParseStored("not-json", { ok: true }), { ok: true });
  assert.deepEqual(safeParseStored('{"saved":true}', {}), { saved: true });
});
