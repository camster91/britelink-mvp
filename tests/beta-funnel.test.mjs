import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBetaFunnel } from "../src/beta-funnel.js";

const row = (extra) => ({ synthetic: false, created_at: "2026-10-01T12:00:00Z", intake_submitted_at: null, plan_published_at: null, delivery_acknowledged_at: null, first_completed_at: null, guardian_messages_before_first_completion: 0, ...extra });

test("the beta funnel counts milestones and the no-contact first lesson, excluding synthetic households", () => {
  const rows = [
    row({ intake_submitted_at: "2026-10-01T13:00:00Z", plan_published_at: "2026-10-04T12:00:00Z", delivery_acknowledged_at: "2026-10-04T15:00:00Z", first_completed_at: "2026-10-05T12:00:00Z" }),
    row({ intake_submitted_at: "2026-10-02T12:00:00Z", plan_published_at: "2026-10-06T12:00:00Z", first_completed_at: "2026-10-08T12:00:00Z", guardian_messages_before_first_completion: 2 }),
    row({ intake_submitted_at: "2026-10-02T12:00:00Z" }),
    row({ synthetic: true, first_completed_at: "2026-10-01T13:00:00Z" }),
  ];
  const summary = summarizeBetaFunnel(rows);
  assert.equal(summary.households, 3);
  assert.deepEqual(summary.reached, { intakeSubmitted: 3, planPublished: 2, deliveryAcknowledged: 1, firstLessonCompleted: 2 });
  assert.equal(summary.firstLessonWithoutContacting, 1);
  assert.equal(summary.medianDaysToFirstLesson, 5.5);
  assert.equal(summary.medianDaysPublishedToFirstLesson, 1.5);
  assert.equal(summarizeBetaFunnel(rows, { includeSynthetic: true }).households, 4);
  assert.deepEqual(summarizeBetaFunnel([]), { households: 0, reached: { intakeSubmitted: 0, planPublished: 0, deliveryAcknowledged: 0, firstLessonCompleted: 0 }, firstLessonWithoutContacting: 0, medianDaysToFirstLesson: null, medianDaysPublishedToFirstLesson: null });
});
