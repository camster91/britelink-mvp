import React from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "/src/AuthenticatedApp.jsx";
import "/src/styles.css";
const now = "2026-08-28T15:00:00Z";
const state = {
  calls: [],
  learners: [
    { id: "learner-a", preferred_name: "Maya", grade_label: "Grade 4" },
    { id: "learner-b", preferred_name: "Noah", grade_label: "Grade 2" },
    { id: "learner-c", preferred_name: "Avery", grade_label: "Grade 5" },
  ],
  cases: [
    {
      id: "case-a",
      learner_id: "learner-a",
      package_code: "complete",
      status: "internal_review",
      sla_due_at: "2026-09-02T00:00:00Z",
      assigned_educator_id: "educator-a",
    },
    {
      id: "case-b",
      learner_id: "learner-b",
      package_code: "annual",
      status: "revision_requested",
      sla_due_at: "2026-09-01T00:00:00Z",
      assigned_educator_id: "educator-a",
    },
    {
      id: "case-c",
      learner_id: "learner-c",
      package_code: "essentials",
      status: "assigned",
      sla_due_at: "2026-09-03T00:00:00Z",
      assigned_educator_id: "educator-a",
    },
  ],
  plans: [
    {
      id: "plan-a",
      case_id: "case-a",
      learner_id: "learner-a",
      version: 1,
      status: "internal_review",
      authored_by: "educator-a",
      plan_weeks: [
        { id: "week-a", week_number: 1, theme: "Patterns", plan_days: [] },
      ],
    },
    {
      id: "plan-b",
      case_id: "case-b",
      learner_id: "learner-b",
      version: 2,
      status: "published",
      authored_by: "educator-a",
      plan_weeks: [],
    },
  ],
  revisions: [
    {
      id: "revision-b",
      case_id: "case-b",
      requested_by: "guardian-a",
      reason: "Reduce the weekly reading load.",
      entitlement_index: 1,
      status: "requested",
      created_at: now,
    },
  ],
  reviews: [],
  deliveries: [],
  resources: [],
  messages: [
    {
      id: "message-a",
      case_id: "case-a",
      sender_user_id: "guardian-a",
      kind: "clarification",
      body: "Could you clarify the reading level?",
      response_owner_user_id: "admin-a",
      response_due_at: "2026-08-27T15:00:00Z",
      resolved_at: null,
      created_at: now,
      case_message_reads: [],
    },
  ],
};
globalThis.staffQaState = state;
state.cases[2] = {
  ...state.cases[2],
  status: "submitted",
  sla_due_at: null,
  assigned_educator_id: null,
};
const repository = {
  async listMemberships() {
    state.calls.push(["listMemberships"]);
    return [
      {
        household_id: "household-a",
        role: "admin",
        households: { id: "household-a", display_name: "BriteLink Operations" },
      },
    ];
  },
  async listLearners(h) {
    state.calls.push(["listLearners", h]);
    return state.learners;
  },
  async listCases(h) {
    state.calls.push(["listCases", h]);
    if (globalThis.staffFailNextCaseRefresh) {
      globalThis.staffFailNextCaseRefresh = false;
      throw new Error("Synthetic staff queue refresh outage");
    }
    if (globalThis.staffDelayNextCaseRefresh) {
      globalThis.staffDelayNextCaseRefresh = false;
      const snapshot = structuredClone(state.cases);
      await new Promise((resolve) => setTimeout(resolve, 700));
      return snapshot;
    }
    return state.cases;
  },
  async listStaffProfiles(h) {
    state.calls.push(["listStaffProfiles", h]);
    return [
      {
        id: "profile-a",
        learner_id: "learner-a",
        version: 2,
        planning_context: {
          subjects: ["Language", "Math"],
          priorAttainment: "Reads short paragraphs",
          strengthsInterests: "Machines and drawing",
          goals: "Build fluency",
          learningSupports: "Short instructions",
          language: "English",
          weeklySchedule: "Weekday mornings",
          caregiverAvailability: "Thirty minutes daily",
          deviceAccess: "computer_printer",
          resourceBudget: "free_only",
          contentConstraints: "Avoid frightening content",
          accessibilityNeeds: "Large print",
        },
        submitted_at: now,
      },
      {
        id: "profile-b",
        learner_id: "learner-b",
        version: 1,
        planning_context: { goals: "Build confidence" },
        submitted_at: now,
      },
      {
        id: "profile-c",
        learner_id: "learner-c",
        version: 1,
        planning_context: { goals: "Independent study" },
        submitted_at: now,
      },
    ];
  },
  async listStaffPlans(h) {
    state.calls.push(["listStaffPlans", h]);
    return state.plans;
  },
  async listStaffReviews(h) {
    state.calls.push(["listStaffReviews", h]);
    return state.reviews;
  },
  async listStaffRevisions(h) {
    state.calls.push(["listStaffRevisions", h]);
    return state.revisions;
  },
  async listEducatorCapacities(h) {
    state.calls.push(["listEducatorCapacities", h]);
    return [
      { educator_user_id: "educator-a", max_active_cases: 4, updated_at: now },
    ];
  },
  async listStaffDeliveries(h) {
    state.calls.push(["listStaffDeliveries", h]);
    if (globalThis.staffFailDeliveryRefresh) {
      throw new Error("Synthetic delivery panel outage");
    }
    return state.deliveries;
  },
  async listStaffMessages(h) {
    state.calls.push(["listStaffMessages", h]);
    return state.messages;
  },
  async createStaffPlanVersion(input) {
    state.calls.push([
      "createStaffPlanVersion",
      input.householdId,
      input.caseId,
    ]);
    (state.planDocuments ??= []).push(input.document);
    const serviceCase = state.cases.find((item) => item.id === input.caseId);
    if (globalThis.staffDelayNextPlanSave) {
      globalThis.staffDelayNextPlanSave = false;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const version =
      Math.max(
        ...state.plans
          .filter((item) => item.case_id === input.caseId)
          .map((item) => item.version),
        0,
      ) + 1;
    state.plans.push({
      id: `plan-${input.caseId}-${version}`,
      case_id: input.caseId,
      learner_id: serviceCase.learner_id,
      version,
      status: "draft",
      authored_by: "educator-a",
      plan_weeks: input.document.weeks.map((week, weekIndex) => ({
        id: `week-${input.caseId}-${version}-${weekIndex + 1}`,
        week_number: week.number,
        theme: week.theme,
        plan_days: week.days.map((day, dayIndex) => ({
          id: `day-${input.caseId}-${version}-${weekIndex + 1}-${dayIndex + 1}`,
          day_number: day.number,
          planned_date: day.plannedDate,
          lessons: day.lessons.map((lesson, lessonIndex) => ({
            id: `lesson-${input.caseId}-${version}-${weekIndex + 1}-${dayIndex + 1}-${lessonIndex + 1}`,
            ...lesson,
            resources: [],
          })),
        })),
      })),
    });
    if (serviceCase.status !== "revision_requested")
      serviceCase.status = "drafting";
    return {
      plan_id: `plan-${input.caseId}-${version}`,
      plan_version: version,
    };
  },
  async addStaffPlanResource(input) {
    state.calls.push([
      "addStaffPlanResource",
      input.householdId,
      input.planId,
      input.lessonId,
    ]);
    const saved = {
      id: `resource-${state.resources.length + 1}`,
      ...input.resource,
    };
    state.resources.push(saved);
    const targetPlan = state.plans.find((item) => item.id === input.planId);
    const targetLesson = targetPlan?.plan_weeks
      .flatMap((week) => week.plan_days)
      .flatMap((day) => day.lessons)
      .find((lesson) => lesson.id === input.lessonId);
    if (!targetLesson) throw new Error("Lesson not found");
    targetLesson.resources.push(saved);
    return { resource_id: saved.id };
  },
  async reviewStaffPlan(input) {
    state.calls.push([
      "reviewStaffPlan",
      input.householdId,
      input.planId,
      input.checks,
    ]);
    state.reviews.push({
      id: `review-${state.reviews.length + 1}`,
      plan_id: input.planId,
      approved_at: now,
    });
    state.plans.find((item) => item.id === input.planId).status =
      "internal_review";
    return { review_id: state.reviews.at(-1).id, approved: true };
  },
  async transitionStaffCase(input) {
    state.calls.push([
      "transitionStaffCase",
      input.householdId,
      input.caseId,
      input.status,
    ]);
    const item = state.cases.find((entry) => entry.id === input.caseId);
    item.status = input.status;
    if (input.status === "published")
      state.plans
        .filter((entry) => entry.case_id === input.caseId)
        .sort((a, b) => b.version - a.version)[0].status = "published";
    return { case_id: input.caseId, current_status: input.status };
  },
  async recordStaffDelivery(input) {
    state.calls.push(["recordStaffDelivery", input.householdId, input.caseId]);
    const plan = state.plans
      .filter((item) => item.case_id === input.caseId)
      .sort((a, b) => b.version - a.version)[0];
    const saved = {
      id: `delivery-${state.deliveries.length + 1}`,
      case_id: input.caseId,
      plan_id: plan.id,
      plan_version: plan.version,
      status: state.deliveries.length ? "sent" : "bounced",
      attempt_count: 1,
      created_at: now,
    };
    state.deliveries.push(saved);
    state.cases.find((item) => item.id === input.caseId).status = "delivered";
    return { delivery_id: saved.id };
  },
  async retryStaffDelivery(input) {
    state.calls.push([
      "retryStaffDelivery",
      input.householdId,
      input.deliveryId,
    ]);
    const item = state.deliveries.find(
      (entry) => entry.id === input.deliveryId,
    );
    item.status = "sent";
    item.attempt_count += 1;
    return { delivery_id: item.id, delivery_status: "sent" };
  },
  async decideStaffRevision(input) {
    state.calls.push([
      "decideStaffRevision",
      input.householdId,
      input.revisionId,
      input.decision,
    ]);
    state.revisions.find((entry) => entry.id === input.revisionId).status =
      input.decision;
    return { revision_id: input.revisionId, current_status: input.decision };
  },
  async sendMessage(input) {
    state.calls.push(["sendMessage", input.householdId, input.caseId]);
    const item = {
      id: `message-${state.messages.length + 1}`,
      case_id: input.caseId,
      sender_user_id: input.userId,
      kind: input.kind,
      body: input.body,
      response_owner_user_id: "guardian-a",
      response_due_at: "2026-08-30T15:00:00Z",
      resolved_at: null,
      created_at: now,
      case_message_reads: [],
      case_attachments: [],
    };
    state.messages.push(item);
    return item;
  },
  async uploadMessageAttachment(input) {
    state.calls.push([
      "uploadMessageAttachment",
      input.householdId,
      input.messageId,
    ]);
    const attachment = {
      id: `attachment-${input.messageId}`,
      file_name: input.file.name,
      status: globalThis.staffFailNextAttachment
        ? "upload_failed"
        : "pending_scan",
    };
    state.messages
      .find((item) => item.id === input.messageId)
      .case_attachments.push(attachment);
    if (globalThis.staffFailNextAttachment) {
      globalThis.staffFailNextAttachment = false;
      const error = new Error("Synthetic staff upload interruption");
      error.attachmentRetry = {
        attachmentId: attachment.id,
        messageId: input.messageId,
        file: input.file,
      };
      throw error;
    }
    return attachment;
  },
  async retryMessageAttachmentUpload(input) {
    state.calls.push([
      "retryMessageAttachmentUpload",
      input.householdId,
      input.attachmentId,
    ]);
    const attachment = state.messages
      .flatMap((item) => item.case_attachments ?? [])
      .find((item) => item.id === input.attachmentId);
    attachment.status = "pending_scan";
    return attachment;
  },
  async markMessageRead(input) {
    state.calls.push(["markMessageRead", input.householdId, input.messageId]);
    const item = state.messages.find((entry) => entry.id === input.messageId);
    item.case_message_reads.push({ user_id: input.userId, read_at: now });
    return item.case_message_reads.at(-1);
  },
  async resolveStaffMessage(input) {
    state.calls.push([
      "resolveStaffMessage",
      input.householdId,
      input.messageId,
    ]);
    state.messages.find((entry) => entry.id === input.messageId).resolved_at =
      now;
    return { message_id: input.messageId };
  },
  async completeStaffRevision(input) {
    state.calls.push([
      "completeStaffRevision",
      input.householdId,
      input.revisionId,
    ]);
    const revision = state.revisions.find(
      (entry) => entry.id === input.revisionId,
    );
    revision.status = "completed";
    revision.change_summary = input.changeSummary;
    const serviceCase = state.cases.find(
      (entry) => entry.id === revision.case_id,
    );
    serviceCase.status = "revised";
    state.plans
      .filter((entry) => entry.case_id === revision.case_id)
      .sort((a, b) => b.version - a.version)[0].status = "published";
    return { revision_id: revision.id };
  },
  async recordStaffAbsence(input) {
    state.calls.push(["recordStaffAbsence", input.householdId, input.caseId]);
    const item = state.cases.find((entry) => entry.id === input.caseId);
    item.previous_operational_status = item.status;
    item.status = "on_hold";
    item.assigned_educator_id = null;
    return { case_id: item.id };
  },
  async markStaffOverdue(h) {
    state.calls.push(["markStaffOverdue", h]);
    return [];
  },
  async assignStaffCase(input) {
    state.calls.push([
      "assignStaffCase",
      input.householdId,
      input.caseId,
      input.educatorId,
    ]);
    return { case_id: input.caseId };
  },
  async listWeeklyNotes(householdId, learnerId) {
    state.calls.push(["listWeeklyNotes", householdId, learnerId]);
    return (state.weeklyNotes ?? []).filter((item) => item.learner_id === learnerId);
  },
  async setWeeklyNote(input) {
    state.calls.push(["setWeeklyNote", input.householdId, input.learnerId, input.weekStart]);
    state.weeklyNotes = (state.weeklyNotes ?? []).filter((item) => !(item.learner_id === input.learnerId && item.week_start === input.weekStart));
    state.weeklyNotes.push({ id: `note-${input.learnerId}-${input.weekStart}`, learner_id: input.learnerId, week_start: input.weekStart, note: input.note.trim(), updated_at: now });
    return { note_id: `note-${input.learnerId}-${input.weekStart}` };
  },
  async clearWeeklyNote(input) {
    state.calls.push(["clearWeeklyNote", input.householdId, input.learnerId, input.weekStart]);
    state.weeklyNotes = (state.weeklyNotes ?? []).filter((item) => !(item.learner_id === input.learnerId && item.week_start === input.weekStart));
    return true;
  },
  async listSharedActivities(householdId) {
    state.calls.push(["listSharedActivities", householdId]);
    return (state.sharedActivities ?? []).filter((item) => !item.removed_at);
  },
  async createSharedActivity(input) {
    state.calls.push(["createSharedActivity", input.householdId, input.outcomes.map((item) => item.learnerId)]);
    const row = { id: `shared-${(state.sharedActivities ?? []).length + 1}`, title: input.title.trim(), description: input.description ?? null, subjects: [...(input.subjects ?? [])], scheduled_for: input.date ?? null, created_at: now, shared_activity_learners: input.outcomes.map((item) => ({ learner_id: item.learnerId, outcome: item.outcome.trim(), scheduled_for: null, completed_at: null })) };
    (state.sharedActivities ??= []).push(row);
    return { activity_id: row.id, learner_count: input.outcomes.length };
  },
  async removeSharedActivity(input) {
    state.calls.push(["removeSharedActivity", input.householdId, input.activityId]);
    const row = (state.sharedActivities ?? []).find((item) => item.id === input.activityId);
    if (row) row.removed_at = now;
    return now;
  },
  async signOut() {
    state.calls.push(["signOut"]);
  },
};
repository.acceptStaffIntake = async (input) => {
  state.calls.push(["acceptStaffIntake", input.householdId, input.caseId]);
  const item = state.cases.find((entry) => entry.id === input.caseId);
  item.status = "triage";
  item.sla_due_at = "2026-09-04T15:00:00Z";
  return {
    case_id: item.id,
    current_status: "triage",
    sla_due_at: item.sla_due_at,
  };
};
repository.assignStaffCase = async (input) => {
  state.calls.push([
    "assignStaffCase",
    input.householdId,
    input.caseId,
    input.educatorId,
  ]);
  const item = state.cases.find((entry) => entry.id === input.caseId);
  item.status = "assigned";
  item.assigned_educator_id = input.educatorId;
  return { case_id: input.caseId };
};
createRoot(document.getElementById("root")).render(
  <Workspace
    repository={repository}
    session={{ user: { id: "admin-a", email: "ops@example.ca" } }}
    staffRefreshIntervalMs={globalThis.staffQaRefreshIntervalMs ?? 60000}
  />,
);
