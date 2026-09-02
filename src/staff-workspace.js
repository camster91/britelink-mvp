const PRIORITY = {
  overdue: 0,
  revision_requested: 1,
  clarification: 2,
  triage: 3,
  internal_review: 4,
  assigned: 5,
  drafting: 6,
  on_hold: 7,
  published: 8,
  delivered: 9,
  acknowledged: 10,
};
const INTAKE_FIELDS = [
  ["subjects", "Subjects"],
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
export function nextStaffStatuses(status) {
  return (
    {
      paid: ["intake_pending"],
      intake_pending: ["submitted"],
      submitted: ["clarification"],
      triage: ["clarification", "assigned", "on_hold"],
      clarification: ["submitted", "on_hold"],
      assigned: ["drafting", "on_hold"],
      drafting: ["internal_review", "on_hold"],
      internal_review: ["drafting", "published", "on_hold"],
      published: ["delivered"],
      delivered: ["overdue"],
      acknowledged: ["closed"],
      revision_requested: ["revised", "acknowledged", "on_hold"],
      revised: ["delivered", "closed"],
      on_hold: ["triage", "assigned", "drafting", "internal_review"],
      overdue: ["triage", "assigned", "drafting", "delivered", "on_hold"],
    }[status] ?? []
  );
}
export function staffIntakeRows(context = {}) {
  return INTAKE_FIELDS.map(([key, label]) => {
    const value = context?.[key];
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
