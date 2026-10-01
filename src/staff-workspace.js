const PRIORITY = {
  overdue: 0,
  revision_requested: 1,
  clarification: 2,
  // A new intake waits on staff to accept it before the package SLA starts.
  submitted: 2.5,
  triage: 3,
  internal_review: 4,
  assigned: 5,
  drafting: 6,
  on_hold: 7,
  // A revised plan waits on staff to re-deliver it.
  revised: 7.5,
  published: 8,
  delivered: 9,
  acknowledged: 10,
  // Waiting on the family to start or finish intake.
  paid: 11,
  intake_pending: 12,
  // Finished cases sort after every open one, including any status added later.
  closed: 100,
  cancelled: 100,
  refunded: 100,
  chargeback: 100,
};
const INTAKE_FIELDS = [
  ["subjects", "Subjects"],
  ["planningStructure", "How they like to plan"],
  ["priorAttainment", "Current learning starting point"],
  ["strengthsInterests", "Strengths and interests"],
  ["goals", "Goals"],
  ["learningSupports", "Helpful learning supports"],
  ["language", "Learning language"],
  ["weeklySchedule", "Typical weekly schedule"],
  ["caregiverAvailability", "Caregiver availability"],
  ["deviceAccess", "Device and printer access"],
  ["resourceBudget", "Optional resource budget"],
  ["contentConstraints", "Content constraints"],
  ["accessibilityNeeds", "Accessibility needs"],
];

export function prioritizedCases(cases = []) {
  return [...cases].sort(
    (a, b) =>
      (PRIORITY[a.status] ?? 99) - (PRIORITY[b.status] ?? 99) ||
      String(a.sla_due_at ?? "9999").localeCompare(
        String(b.sla_due_at ?? "9999"),
      ) ||
      String(a.id).localeCompare(String(b.id)),
  );
}
export function latestForCase(rows = [], caseId) {
  return (
    rows
      .filter((item) => item.case_id === caseId)
      .sort(
        (a, b) =>
          (b.version ?? 0) - (a.version ?? 0) ||
          String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
      )[0] ?? null
  );
}
export const STAFF_PRIORITY_LABELS = {
  overdue: "Urgent",
  revision_requested: "Revision",
  clarification: "Needs reply",
  triage: "Triage",
  internal_review: "Ready for review",
  assigned: "Assigned",
  drafting: "Authoring",
  on_hold: "On hold",
  published: "Ready to deliver",
  delivered: "Awaiting family",
  acknowledged: "Acknowledged",
  submitted: "Intake ready",
  intake_pending: "Waiting on intake",
  paid: "Paid",
};

export const STAFF_NEXT_ACTIONS = {
  paid: "Wait for usable intake before starting the SLA.",
  intake_pending: "Wait for the guardian to submit usable intake.",
  submitted: "Accept usable intake to start the package SLA.",
  clarification: "Resolve the open clarification, then re-check intake.",
  triage: "Assign this case within capacity, or place it on hold.",
  assigned: "Start drafting the plan for this learner.",
  drafting: "Finish the plan and send it to independent review.",
  internal_review: "Complete independent review, then publish if approved.",
  published: "Deliver the published plan through the secure portal.",
  delivered: "Wait for the guardian to acknowledge delivery.",
  acknowledged: "Close the case, or wait if a revision is requested.",
  revision_requested: "Accept or decline the revision with a reason.",
  revised: "Re-deliver the revised plan.",
  on_hold: "Return this case to an active operational state.",
  overdue: "Triage this overdue case and choose a safe next state.",
  closed: "This case is closed. No further operational work is required.",
  cancelled: "This case was cancelled. Do not treat it as an active family plan.",
  refunded: "This case was refunded. Do not invent a delivery or educator status.",
  chargeback: "This case has a chargeback. Pause operational work.",
};

export function staffPriorityLabel(status) {
  return STAFF_PRIORITY_LABELS[status] ?? String(status ?? "unknown").replaceAll("_", " ");
}

export function staffNextAction(status) {
  return STAFF_NEXT_ACTIONS[status] ?? "Review this case and choose a valid next step.";
}

export function nextStaffStatuses(status) {
  // This map must agree with CASE_TRANSITIONS in service-domain.js, which is the
  // authority enforced by transitionCase(). QA found the two drifting: `submitted`
  // offered only `clarification`, so the educator journey the UI itself describes
  // ("Accept usable intake to start the package SLA") was unreachable and the case
  // looped submitted -> clarification -> submitted forever. tests/staff-transitions
  // .test.mjs now pins the two maps together.
  return (
    {
      paid: ["intake_pending", "cancelled", "refunded", "chargeback"],
      intake_pending: ["submitted", "cancelled", "refunded", "chargeback"],
      submitted: ["triage", "clarification", "cancelled", "refunded", "chargeback"],
      triage: ["clarification", "assigned", "on_hold", "overdue"],
      clarification: ["submitted", "on_hold", "cancelled"],
      assigned: ["drafting", "on_hold", "overdue"],
      drafting: ["internal_review", "on_hold", "overdue"],
      internal_review: ["drafting", "published", "on_hold"],
      published: ["delivered"],
      delivered: ["acknowledged", "overdue"],
      acknowledged: ["revision_requested", "closed"],
      revision_requested: ["revised", "on_hold"],
      revised: ["delivered", "closed"],
      on_hold: ["triage", "assigned", "drafting", "internal_review", "cancelled", "refunded"],
      overdue: ["triage", "assigned", "drafting", "delivered", "on_hold"],
      closed: [],
      cancelled: [],
      refunded: [],
      chargeback: [],
    }[status] ?? []
  );
}
// Readable values for coded answers, so staff never have to decode an enum.
const INTAKE_VALUE_LABELS = {
  planningStructure: {
    plan_every_day: "Plan each day for us",
    weekly_goals: "Weekly goals",
    capture_after: "Record as we go",
  },
};
export function staffIntakeRows(context = {}) {
  return INTAKE_FIELDS.map(([key, label]) => {
    const raw = context?.[key];
    const value = INTAKE_VALUE_LABELS[key]?.[raw] ?? raw;
    return {
      key,
      label,
      value: Array.isArray(value)
        ? value.length
          ? value.join(", ")
          : "Not provided"
        : value === null || value === undefined || String(value).trim() === ""
          ? "Not provided"
          : String(value),
    };
  });
}

const STAFF_READS = [
  ["cases", "listCases", true],
  ["learners", "listLearners", true],
  ["profiles", "listStaffProfiles", false],
  ["plans", "listStaffPlans", false],
  ["reviews", "listStaffReviews", false],
  ["revisions", "listStaffRevisions", false],
  ["capacities", "listEducatorCapacities", false],
  ["deliveries", "listStaffDeliveries", false],
  ["messages", "listStaffMessages", false],
];
export async function loadStaffWorkspaceData(repository, householdId) {
  const results = await Promise.allSettled(
    STAFF_READS.map(([, method]) => repository[method](householdId)),
  );
  const data = { warnings: [] };
  for (let index = 0; index < STAFF_READS.length; index += 1) {
    const [key, , essential] = STAFF_READS[index],
      result = results[index];
    if (result.status === "fulfilled") data[key] = result.value;
    else if (essential) throw result.reason;
    else {
      data[key] = [];
      data.warnings.push({
        panel: key,
        message: result.reason?.message ?? `${key} unavailable`,
      });
    }
  }
  return data;
}
