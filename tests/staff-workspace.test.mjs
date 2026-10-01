import assert from "node:assert/strict";
import test from "node:test";
import {
  latestForCase,
  loadStaffWorkspaceData,
  nextStaffStatuses,
  prioritizedCases,
  staffIntakeRows,
  staffNextAction,
  staffPriorityLabel,
} from "../src/staff-workspace.js";
test("staff queue prioritizes urgent workflow and then SLA", () => {
  const cases = [
    { id: "c1", status: "triage", sla_due_at: "2026-09-02" },
    { id: "c2", status: "overdue" },
    { id: "c3", status: "revision_requested" },
    { id: "c4", status: "triage", sla_due_at: "2026-09-01" },
  ];
  assert.deepEqual(
    prioritizedCases(cases).map((item) => item.id),
    ["c2", "c3", "c4", "c1"],
  );
});
test("staff queue language names priority and the next honest action", () => {
  assert.equal(staffPriorityLabel("overdue"), "Urgent");
  assert.equal(staffPriorityLabel("clarification"), "Needs reply");
  assert.match(staffNextAction("submitted"), /Accept usable intake/);
  assert.match(staffNextAction("unknown_state"), /valid next step/);
});

test("case helpers select latest plan and reserve submitted-to-triage for usable-intake acceptance", () => {
  assert.equal(
    latestForCase(
      [
        { case_id: "c", version: 1 },
        { case_id: "c", version: 3 },
        { case_id: "x", version: 8 },
      ],
      "c",
    ).version,
    3,
  );
  assert.deepEqual(nextStaffStatuses("drafting"), [
    "internal_review",
    "on_hold",
    "overdue",
  ]);
  assert.deepEqual(nextStaffStatuses("submitted"), [
    "clarification",
    "cancelled",
    "refunded",
    "chargeback",
  ]);
  assert.deepEqual(nextStaffStatuses("closed"), []);
});
test("staff intake summary preserves every canonical planning field with explicit empty values", () => {
  const rows = staffIntakeRows({
    subjects: ["Language", "Math"],
    goals: "Build fluency",
    accessibilityNeeds: "Large print",
  });
  assert.deepEqual(
    rows.map((row) => row.key),
    [
      "subjects",
      "planningStructure",
      "priorAttainment",
      "strengthsInterests",
      "goals",
      "learningSupports",
      "language",
      "weeklySchedule",
      "caregiverAvailability",
      "deviceAccess",
      "resourceBudget",
      "contentConstraints",
      "accessibilityNeeds",
    ],
  );
  assert.equal(
    rows.find((row) => row.key === "subjects").value,
    "Language, Math",
  );
  assert.equal(
    rows.find((row) => row.key === "planningStructure").value,
    "Not provided",
    "profiles from before #46 show an explicit empty value",
  );
  assert.equal(
    staffIntakeRows({ planningStructure: "capture_after" }).find((row) => row.key === "planningStructure").value,
    "Record as we go",
  );
  assert.equal(
    rows.find((row) => row.key === "weeklySchedule").value,
    "Not provided",
  );
  assert.equal(
    rows.find((row) => row.key === "accessibilityNeeds").value,
    "Large print",
  );
});
test("staff workspace keeps core triage available when an auxiliary panel fails", async () => {
  const repository = {};
  for (const method of [
    "listCases",
    "listLearners",
    "listStaffProfiles",
    "listStaffPlans",
    "listStaffReviews",
    "listStaffRevisions",
    "listEducatorCapacities",
    "listStaffDeliveries",
    "listStaffMessages",
  ])
    repository[method] = async () =>
      method === "listStaffDeliveries"
        ? Promise.reject(new Error("delivery provider unavailable"))
        : [{ id: method }];
  const data = await loadStaffWorkspaceData(repository, "household-a");
  assert.equal(data.cases.length, 1);
  assert.deepEqual(data.deliveries, []);
  assert.deepEqual(data.warnings, [
    { panel: "deliveries", message: "delivery provider unavailable" },
  ]);
  repository.listCases = async () => {
    throw new Error("case access unavailable");
  };
  await assert.rejects(
    () => loadStaffWorkspaceData(repository, "household-a"),
    /case access unavailable/,
  );
});

test("cases waiting on staff sort above cases waiting on the family, and finished cases sort last", () => {
  const cases = [
    { id: "closed", status: "closed" },
    { id: "acknowledged", status: "acknowledged" },
    { id: "revised", status: "revised" },
    { id: "intake-pending", status: "intake_pending" },
    { id: "submitted", status: "submitted" },
    { id: "delivered", status: "delivered" },
  ];
  assert.deepEqual(prioritizedCases(cases).map((item) => item.id), ["submitted", "revised", "delivered", "acknowledged", "intake-pending", "closed"]);
});
