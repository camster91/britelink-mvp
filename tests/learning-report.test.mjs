import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_DISCLAIMER, csvCell, learningReport, learningReportCsv } from "../src/learning-report.js";

const weeks = [{ plan_days: [{ lessons: [{ id: "a", subject: "Math", title: "Count" }, { id: "b", subject: "Language", title: "Read" }] }] }];
const local = (iso) => iso.slice(0, 10);

test("the report lists lessons done and outside learning in the period, dated and tallied", () => {
  const report = learningReport({
    weeks, from: "2026-10-01", to: "2026-10-31", toLocalDate: local,
    activities: [
      { lesson_id: "a", status: "completed", updated_at: "2026-10-06T15:00:00Z", caregiver_note: "Used beans" },
      { lesson_id: "b", status: "in_progress", updated_at: "2026-10-07T15:00:00Z" },
      { lesson_id: "b", status: "completed", updated_at: "2026-09-20T15:00:00Z" },
    ],
    captures: [{ captured_on: "2026-10-03", kind: "outing", subjects: ["Science", "Math"], note: "Pond walk" }, { captured_on: "2026-11-02", kind: "book", subjects: [], note: "Later" }],
  });
  assert.deepEqual(report.rows.map((row) => [row.date, row.source, row.title]), [["2026-10-03", "Outside the plan", "Outing or field trip"], ["2026-10-06", "Plan lesson", "Count"]]);
  assert.deepEqual(report.subjects, [["Math", 2], ["Science", 1]]);
  assert.throws(() => learningReport({ from: "2026-10-31", to: "2026-10-01" }), /on or before/);
  assert.throws(() => learningReport({ from: "", to: "2026-10-01" }), /start and end date/);
});

test("CSV cells are quoted and spreadsheet formulas are neutralised", () => {
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  for (const attack of ["=HYPERLINK(\"http://x\")", "+1+1", "-2", "@SUM(A1)", "\tcmd", "\rcmd"]) assert.ok(csvCell(attack).startsWith(`"'`), attack);
  assert.equal(csvCell("2026-10-06"), '"2026-10-06"');
  const csv = learningReportCsv({ from: "2026-10-01", to: "2026-10-31", rows: [{ date: "2026-10-06", source: "Plan lesson", subjects: ["Math"], title: "=cmd", detail: "note, with comma" }] }, "Maya");
  assert.ok(csv.includes(REPORT_DISCLAIMER));
  assert.ok(csv.includes('"\'=cmd"'));
  assert.ok(csv.includes('"note, with comma"'));
  assert.ok(csv.endsWith("\r\n"));
});

test("a completed lesson is dated by its first completion, not by a later note edit", () => {
  const report = learningReport({
    weeks, from: "2026-09-01", to: "2026-09-30", toLocalDate: local,
    activities: [{ lesson_id: "a", status: "completed", first_completed_at: "2026-09-03T15:00:00Z", updated_at: "2026-10-02T15:00:00Z" }],
  });
  assert.deepEqual(report.rows.map((row) => row.date), ["2026-09-03"]);
  const october = learningReport({
    weeks, from: "2026-10-01", to: "2026-10-31", toLocalDate: local,
    activities: [{ lesson_id: "a", status: "completed", first_completed_at: "2026-09-03T15:00:00Z", updated_at: "2026-10-02T15:00:00Z" }],
  });
  assert.equal(october.rows.length, 0);
});
