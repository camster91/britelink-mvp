import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  latestForCase,
  loadStaffWorkspaceData,
  nextStaffStatuses,
  prioritizedCases,
  staffIntakeRows,
  staffNextAction,
  staffPriorityLabel,
} from "./staff-workspace.js";
import "./staff-workspace.css";
import { StaffAuthoring } from "./StaffAuthoring.jsx";
import { EmailUpdates } from "./EmailUpdates.jsx";
import "./staff-operations.css";
import { MessageAttachments } from "./MessageAttachments.jsx";
import { StaffSharedActivities, StaffWeeklyNote } from "./StaffFamilyTools.jsx";
import { localDateString } from "./authenticated-workspace.js";
import { validateAttachmentFile } from "./input-validation.js";

function StaffNotice({ state }) {
  if (!state.message) return null;
  return (
    <div
      className={state.status === "error" ? "error" : "live-operation success"}
      role={state.status === "error" ? "alert" : "status"}
    >
      <span>{state.message}</span>
      {state.onRetry ? (
        <button type="button" className="ghost" onClick={state.onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EducatorWorkspace({
  household,
  membership,
  learners,
  cases,
  repository,
  userId,
  refreshIntervalMs = 60000,
  attachmentsEnabled = true,
}) {
  const [data, setData] = useState({
    status: "loading",
    cases,
    learners,
    profiles: [],
    plans: [],
    reviews: [],
    revisions: [],
    capacities: [],
    deliveries: [],
    messages: [],
    warnings: [],
    error: null,
  });
  // Open on the most urgent case, the same order as the queue.
  const [selectedId, setSelectedId] = useState(
    () => prioritizedCases(cases)[0]?.id ?? "",
  );
  const [casePackage, setCasePackage] = useState("essentials");
  const [newCaseLearnerId, setNewCaseLearnerId] = useState("");
  const [operation, setOperation] = useState({ status: "idle", message: "" });
  const [transition, setTransition] = useState({ status: "", reason: "" });
  const [checks, setChecks] = useState({
    curriculum: false,
    safeguarding: false,
    accessibility: false,
    resourceRights: false,
  });
  const [reviewNotes, setReviewNotes] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messageFiles, setMessageFiles] = useState([]);
  const [absenceReason, setAbsenceReason] = useState("");
  const staffAttachmentRecovery = useRef(null);
  const workspaceRequest = useRef(0);
  const operationInFlight = useRef(false);
  const load = useCallback(async () => {
    const request = ++workspaceRequest.current;
    setData((previous) => ({
      ...previous,
      status: previous.status === "success" ? "refreshing" : "loading",
      error: null,
    }));
    try {
      const loaded = await loadStaffWorkspaceData(
        repository,
        household.household_id,
      );
      if (request !== workspaceRequest.current) return null;
      setData((previous) => {
        const preserved = { ...loaded };
        for (const warning of loaded.warnings)
          if (previous[warning.panel]?.length)
            preserved[warning.panel] = previous[warning.panel];
        return { status: "success", ...preserved, error: null };
      });
      return loaded;
    } catch (error) {
      if (request !== workspaceRequest.current) return null;
      setData((previous) =>
        previous.status === "refreshing"
          ? {
              ...previous,
              status: "success",
              warnings: [
                ...previous.warnings.filter(
                  (item) => item.panel !== "workspace refresh",
                ),
                { panel: "workspace refresh", message: error.message },
              ],
              error: null,
            }
          : { ...previous, status: "error", error: error.message },
      );
      return null;
    }
  }, [household.household_id, repository]);
  useEffect(() => {
    setTransition({ status: "", reason: "" });
    setChecks({
      curriculum: false,
      safeguarding: false,
      accessibility: false,
      resourceRights: false,
    });
    setReviewNotes("");
    setDecisionReason("");
    setChangeSummary("");
    setMessageBody("");
    setMessageFiles([]);
    staffAttachmentRecovery.current = null;
    setAbsenceReason("");
  }, [selectedId]);
  useEffect(() => {
    load().catch(() => {});
    if (!refreshIntervalMs) return undefined;
    const timer = globalThis.setInterval(
      () => load().catch(() => {}),
      refreshIntervalMs,
    );
    return () => globalThis.clearInterval(timer);
  }, [load, refreshIntervalMs]);
  const queue = useMemo(() => prioritizedCases(data.cases), [data.cases]);
  const selected =
    queue.find((item) => item.id === selectedId) ?? queue[0] ?? null;
  useEffect(() => {
    if (selected?.id && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected?.id, selectedId]);
  const currentLearners = data.learners?.length ? data.learners : learners;
  // Names staff set for themselves (057), loaded apart from the case data: they only label
  // people, so if they cannot load, staff see IDs and every case action keeps working.
  const [staffNameRows, setStaffNameRows] = useState([]);
  const loadStaffNames = useCallback(async () => {
    try {
      setStaffNameRows((await repository.listStaffNames?.(household.household_id)) ?? []);
    } catch {
      setStaffNameRows([]);
    }
  }, [household.household_id, repository]);
  useEffect(() => {
    loadStaffNames();
  }, [loadStaffNames]);
  const staffNames = new Map(
    staffNameRows.map((row) => [row.user_id, row.display_name]),
  );
  const staffLabel = (id) =>
    id === userId
      ? "You"
      : (staffNames.get(id) ?? `Educator ${String(id).slice(0, 8)} (no name yet)`);

  useEffect(() => {
    if (!newCaseLearnerId && currentLearners.length) {
      setNewCaseLearnerId(currentLearners[0].id);
    }
  }, [newCaseLearnerId, currentLearners]);
  const learner = currentLearners.find(
    (item) => item.id === selected?.learner_id,
  );
  const profile =
    data.profiles.find((item) => item.learner_id === selected?.learner_id) ??
    null;
  const plan = latestForCase(data.plans, selected?.id);
  const revision =
    data.revisions.find(
      (item) =>
        item.case_id === selected?.id &&
        ["requested", "accepted"].includes(item.status),
    ) ?? null;
  const messages = data.messages.filter(
    (item) => item.case_id === selected?.id,
  );
  const allowed = nextStaffStatuses(
    selected?.status,
    selected?.previous_operational_status,
  );
  // A choice made for the old status is meaningless once the case moves (an action here, or
  // the background refresh), so the form starts again from the new status's suggestion.
  useEffect(() => {
    setTransition({ status: "", reason: "" });
  }, [selected?.id, selected?.status]);
  const nextStatus = allowed.includes(transition.status)
    ? transition.status
    : (allowed[0] ?? "");
  const latestReview = plan
    ? ([...data.reviews]
        .filter((item) => item.plan_id === plan.id)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null)
    : null;
  const planApproved = Boolean(
    plan && data.reviews.some((item) => item.plan_id === plan.id && item.approved_at),
  );
  // A saved review starts the next one from clear boxes, so nothing is approved by leftover ticks.
  useEffect(() => {
    setChecks({
      curriculum: false,
      safeguarding: false,
      accessibility: false,
      resourceRights: false,
    });
    setReviewNotes("");
  }, [latestReview?.id]);
  const revisionAccepted = data.revisions.some(
    (item) => item.case_id === selected?.id && item.status === "accepted",
  );
  const retryStaffAttachments = async () => {
    const recovery = staffAttachmentRecovery.current;
    if (!recovery) return;
    setOperation({
      status: "loading",
      message: "Retrying attachments without resending the secure message…",
    });
    const pending = [recovery.retry.file, ...recovery.remainingFiles];
    let retriedFirst = false;
    try {
      await repository.retryMessageAttachmentUpload({
        householdId: household.household_id,
        attachmentId: recovery.retry.attachmentId,
        file: recovery.retry.file,
      });
      retriedFirst = true;
      for (let index = 1; index < pending.length; index += 1) {
        try {
          await repository.uploadMessageAttachment({
            householdId: household.household_id,
            messageId: recovery.messageId,
            file: pending[index],
          });
        } catch (error) {
          if (error.attachmentRetry) {
            staffAttachmentRecovery.current = {
              retry: error.attachmentRetry,
              messageId: recovery.messageId,
              remainingFiles: pending.slice(index + 1),
            };
            setMessageFiles(pending.slice(index));
            setOperation({
              status: "error",
              message: `Message remains sent. ${pending.length - index} attachment${pending.length - index === 1 ? "" : "s"} still require upload; retrying will not duplicate the message.`,
              onRetry: retryStaffAttachments,
            });
            await load();
            return;
          }
          throw error;
        }
      }
      staffAttachmentRecovery.current = null;
      setMessageBody("");
      setMessageFiles([]);
      await load();
      setOperation({
        status: "success",
        message:
          "Attachments uploaded to the original secure message and quarantined until scanning passes.",
      });
    } catch (error) {
      if (retriedFirst && !error.attachmentRetry) {
        // The retried attachment is uploaded; a later file failed in a way that cannot be retried
        // against this message (no attachment row). Retrying the first one again would only fail.
        staffAttachmentRecovery.current = null;
        setMessageBody("");
        setMessageFiles([]);
        setOperation({
          status: "error",
          message: `The secure message remains sent, but a file could not be attached: ${error.message} Send it in a new message.`,
        });
        await load();
        return;
      }
      const retry = error.attachmentRetry ?? recovery.retry;
      staffAttachmentRecovery.current = { ...recovery, retry };
      setOperation({
        status: "error",
        message:
          "The secure message remains sent, but its attachment still failed. Try again to retry only the attachment.",
        onRetry: retryStaffAttachments,
      });
      await load();
    }
  };
  const act = async (label, work) => {
    if (operationInFlight.current) return null;
    if (data.warnings.length) {
      setOperation({
        status: "error",
        message:
          "Refresh unavailable supporting panels before changing this case.",
      });
      return null;
    }
    operationInFlight.current = true;
    setOperation({ status: "loading", message: `${label}…` });
    try {
      const result = await work();
      setOperation({
        status: "success",
        message: `${label} completed and audited.`,
      });
      await load();
      return result ?? true;
    } catch (error) {
      if (error.attachmentRetry) {
        const failedIndex = Math.max(
          0,
          messageFiles.indexOf(error.attachmentRetry.file),
        );
        staffAttachmentRecovery.current = {
          retry: error.attachmentRetry,
          messageId: error.attachmentRetry.messageId,
          remainingFiles: messageFiles.slice(failedIndex + 1),
        };
        setMessageFiles(messageFiles.slice(failedIndex));
        await load();
        setOperation({
          status: "error",
          message: `Secure message sent once. ${messageFiles.length - failedIndex} attachment${messageFiles.length - failedIndex === 1 ? "" : "s"} require retry; the message will not be resent.`,
          onRetry: retryStaffAttachments,
        });
        return null;
      }
      setOperation({ status: "error", message: error.message });
      return null;
    } finally {
      operationInFlight.current = false;
    }
  };
  if (data.status === "loading")
    return (
      <section className="staff-workspace" role="status">
        <h2>Loading staff operations…</h2>
      </section>
    );
  if (data.status === "error")
    return (
      <section className="staff-workspace">
        <h2>Staff operations unavailable</h2>
        <p role="alert">{data.error}</p>
        <button className="primary" onClick={load}>
          Try again
        </button>
      </section>
    );
  return (
    <section className="staff-workspace" aria-labelledby="staff-heading">
      <header>
        <div>
          <span className="eyebrow">Authenticated staff operations</span>
          <h2 id="staff-heading">Educator workbench</h2>
          <p className="staff-lead">
            Work the highest-priority case first. Queue order is overdue, revision, clarification, then SLA.
          </p>
          <StaffNameForm
            current={staffNames.get(userId) ?? ""}
            repository={repository}
            onSaved={loadStaffNames}
          />
          <EmailUpdates repository={repository} audience="staff" />
        </div>
        <div className="staff-header-actions">
          <span className="case-status">{membership.role}</span>
          {membership.role === "admin" ? (
            <>
              <button
                className="ghost"
                onClick={() =>
                  act("Open a case", async () => {
                    const learner = currentLearners.find(
                      (entry) => entry.id === newCaseLearnerId,
                    );
                    if (!learner) {
                      throw new Error(
                        "Choose a learner before opening a case.",
                      );
                    }
                    await repository.createStaffCase({
                      householdId: household.household_id,
                      learnerId: learner.id,
                      packageCode: casePackage,
                    });
                    await load();
                  })
                }
              >
                Open a case
              </button>
              <label className="case-learner">
                <span className="visually-hidden">Learner for the new case</span>
                <select
                  value={newCaseLearnerId}
                  onChange={(event) => setNewCaseLearnerId(event.target.value)}
                >
                  {currentLearners.length ? null : (
                    <option value="">No learners yet</option>
                  )}
                  {currentLearners.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.preferred_name || "Learner"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="case-package">
                <span className="visually-hidden">Package for the new case</span>
                <select
                  value={casePackage}
                  onChange={(event) => setCasePackage(event.target.value)}
                >
                  <option value="essentials">Essentials</option>
                  <option value="complete">Complete</option>
                  <option value="annual">Annual</option>
                </select>
              </label>
              <button
                className="ghost"
                onClick={() =>
                  act("Overdue evaluation", () =>
                    repository.markStaffOverdue(household.household_id),
                  )
                }
              >
                Evaluate overdue cases
              </button>
            </>
          ) : null}
        </div>
      </header>
      <p className="staff-lead">
        Queue → case → next action. Priority is overdue, revision, clarification, then SLA. Mutations stay
        role-checked and audited.
      </p>
      {data.warnings.length ? (
        <div className="live-operation failure" role="alert">
          <strong>Some supporting panels are temporarily unavailable.</strong>
          <span>
            {data.warnings.map((item) => item.panel).join(", ")}. Core case
            triage remains available; retry before acting on missing context.
          </span>
          <button type="button" className="ghost" onClick={load}>
            Retry supporting panels
          </button>
        </div>
      ) : null}
      {!queue.length ? (
        <div className="live-empty">
          <h3>No active cases</h3>
          <p>This household has no cases requiring attention right now.</p>
        </div>
      ) : (
        <div className="staff-grid">
          <nav aria-label="Case queue">
            <h3>Case queue</h3>
            {queue.map((item) => {
              const name =
                currentLearners.find((entry) => entry.id === item.learner_id)
                  ?.preferred_name ?? "Learner";
              return (
                <button
                  key={item.id}
                  aria-current={selected?.id === item.id ? "true" : undefined}
                  onClick={() => {
                    setSelectedId(item.id);
                    setOperation({ status: "idle", message: "" });
                    requestAnimationFrame(() =>
                      document.getElementById("selected-case-heading")?.focus(),
                    );
                  }}
                >
                  <strong>{name}</strong>
                  <span className={`queue-priority ${item.status}`}>{staffPriorityLabel(item.status)}</span>
                  <span>{item.status.replaceAll("_", " ")}</span>
                  <small>
                    {item.sla_due_at
                      ? `Due ${new Date(item.sla_due_at).toLocaleDateString()}`
                      : "SLA not started"}
                  </small>
                </button>
              );
            })}
          </nav>
          <div className="staff-case">
            <header>
              <div>
                <span className="eyebrow">Selected case</span>
                <h3 id="selected-case-heading" tabIndex={-1}>
                  {learner?.preferred_name ?? "Learner"} ·{" "}
                  {selected.package_code}
                </h3>
                <div className="staff-next-panel">
                  <p className="staff-next-copy">{staffNextAction(selected.status)}</p>
                  {allowed[0] ? (
                    <p className="staff-next-hint">
                      Preferred next status: <strong>{allowed[0].replaceAll("_", " ")}</strong>
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="staff-focus-status">
                <span className={`queue-priority ${selected.status}`}>
                  {staffPriorityLabel(selected.status)}
                </span>
                <span className="case-status">
                  {selected.status.replaceAll("_", " ")}
                </span>
              </div>
            </header>
            <div className="staff-summary">
              <article>
                <h4>Complete latest intake</h4>
                {profile ? (
                  <>
                    <p>Version {profile.version}</p>
                    <dl>
                      {staffIntakeRows(profile.planning_context).map((row) => (
                        <div key={row.key}>
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <p>No consented intake is visible.</p>
                )}
              </article>
              <article>
                <h4>Latest plan</h4>
                {plan ? (
                  <>
                    <p>
                      Version {plan.version} ·{" "}
                      {plan.status.replaceAll("_", " ")}
                    </p>
                    <p>
                      {plan.plan_weeks?.length ?? 0} week(s) · authored by{" "}
                      {plan.authored_by}
                    </p>
                  </>
                ) : (
                  <p>No plan version exists.</p>
                )}
              </article>
            </div>
            {["submitted", "clarification"].includes(selected.status) ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  act("Usable intake acceptance", () =>
                    repository.acceptStaffIntake({
                      householdId: household.household_id,
                      caseId: selected.id,
                    }),
                  );
                }}
              >
                <h4>Accept usable intake and start SLA</h4>
                <p>
                  The backend verifies the latest submitted profile, active
                  planning consent, grade, jurisdiction, and required context.
                  The 5–7 business-day deadline starts only if every check
                  passes.
                </p>
                <button className="primary">Accept intake and start SLA</button>
              </form>
            ) : null}
            {allowed.length ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const status = nextStatus;
                  if (!status) return;
                  act("Case transition", () =>
                    repository.transitionStaffCase({
                      householdId: household.household_id,
                      caseId: selected.id,
                      status,
                      reason: transition.reason,
                    }),
                  );
                }}
              >
                <h4>Move case forward</h4>
                <p className="staff-next-hint">
                  {staffNextAction(selected.status)} Choose one allowed status
                  below.
                </p>
                <label>
                  Next status
                  <select
                    required
                    value={nextStatus}
                    onChange={(event) =>
                      setTransition((value) => ({
                        ...value,
                        status: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose a valid transition</option>
                    {allowed.map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll("_", " ")}
                        {value === allowed[0] ? " (suggested)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Operational reason <span>(optional)</span>
                  <input
                    maxLength="500"
                    value={transition.reason}
                    onChange={(event) =>
                      setTransition((value) => ({
                        ...value,
                        reason: event.target.value,
                      }))
                    }
                  />
                </label>
                <button
                  className="primary"
                  disabled={operation.status === "loading"}
                >
                  Apply transition
                </button>
              </form>
            ) : null}
            {membership.role === "admin" &&
            ["triage", "assigned", "on_hold"].includes(selected.status) ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const educatorId = new FormData(event.currentTarget).get(
                    "educator",
                  );
                  act("Case assignment", () =>
                    repository.assignStaffCase({
                      householdId: household.household_id,
                      caseId: selected.id,
                      educatorId,
                    }),
                  );
                }}
              >
                <h4>Assign within capacity</h4>
                <label>
                  Educator
                  <select name="educator" required>
                    <option value="">Choose educator</option>
                    {data.capacities.map((item) => (
                      <option
                        key={item.educator_user_id}
                        value={item.educator_user_id}
                      >
                        {staffLabel(item.educator_user_id)} ·{" "}
                        {
                          data.cases.filter(
                            (row) =>
                              row.assigned_educator_id === item.educator_user_id &&
                              !["closed", "cancelled", "refunded", "chargeback"].includes(row.status),
                          ).length
                        }{" "}
                        of {item.max_active_cases} cases
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary">Assign case</button>
              </form>
            ) : null}
            {membership.role === "admin" &&
            ["assigned", "drafting", "internal_review"].includes(
              selected.status,
            ) ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  act("Educator absence", () =>
                    repository.recordStaffAbsence({
                      householdId: household.household_id,
                      caseId: selected.id,
                      reason: absenceReason,
                    }),
                  );
                }}
              >
                <h4>Place case on safe hold</h4>
                <p>
                  Use this only when the assigned educator becomes unavailable.
                  Their assignment is removed and the prior state is preserved.
                </p>
                <label>
                  Absence reason
                  <input
                    required
                    maxLength="500"
                    value={absenceReason}
                    onChange={(event) => setAbsenceReason(event.target.value)}
                  />
                </label>
                <button className="ghost">Record absence and hold</button>
              </form>
            ) : null}
            {plan && ["draft", "internal_review"].includes(plan.status) ? (
              plan.authored_by === userId ? (
                <section className="review-separation" role="note">
                  <h4>Independent review required</h4>
                  <p>
                    You authored this plan, so another active educator or
                    administrator must complete the curriculum, safeguarding,
                    accessibility, and resource review.
                  </p>
                </section>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    act("Plan review", () =>
                      repository.reviewStaffPlan({
                        householdId: household.household_id,
                        planId: plan.id,
                        checks,
                        notes: reviewNotes,
                      }),
                    );
                  }}
                >
                  <h4>Independent internal review</h4>
                  {latestReview ? (
                    <p
                      className="staff-next-hint"
                      role="status"
                    >
                      {latestReview.approved_at
                        ? `Approved on ${new Date(latestReview.approved_at).toLocaleDateString()}. Saving another review replaces this approval; if any check is left unticked, the plan can no longer be published.`
                        : `Latest review did not approve this plan${latestReview.notes ? `: ${latestReview.notes}` : "."} Fix the plan, then review again.`}
                    </p>
                  ) : (
                    <p className="staff-next-hint">Not reviewed yet. Tick every check to approve this plan for publishing.</p>
                  )}
                  <fieldset>
                    <legend>Required checks</legend>
                    {[
                      ["curriculum", "Curriculum"],
                      ["safeguarding", "Safeguarding"],
                      ["accessibility", "Accessibility"],
                      ["resourceRights", "Resource rights and privacy"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={checks[key]}
                          onChange={(event) =>
                            setChecks((value) => ({
                              ...value,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    Review notes
                    <textarea
                      maxLength="4000"
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value)}
                    />
                  </label>
                  <button className="primary">Save independent review</button>
                </form>
              )
            ) : null}
            {revision?.status === "requested" ? (
              <form onSubmit={(event) => event.preventDefault()}>
                <h4>Revision request</h4>
                <p>{revision.reason}</p>
                <label>
                  Decision reason
                  <textarea
                    maxLength="2000"
                    value={decisionReason}
                    onChange={(event) => setDecisionReason(event.target.value)}
                  />
                </label>
                <div className="service-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() =>
                      act("Revision acceptance", () =>
                        repository.decideStaffRevision({
                          householdId: household.household_id,
                          revisionId: revision.id,
                          decision: "accepted",
                          reason: decisionReason,
                        }),
                      )
                    }
                  >
                    Accept revision
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!decisionReason.trim()}
                    onClick={() =>
                      act("Revision decline", () =>
                        repository.decideStaffRevision({
                          householdId: household.household_id,
                          revisionId: revision.id,
                          decision: "declined",
                          reason: decisionReason,
                        }),
                      )
                    }
                  >
                    Decline with reason
                  </button>
                </div>
              </form>
            ) : revision?.status === "accepted" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  act("Revision completion", () =>
                    repository.completeStaffRevision({
                      householdId: household.household_id,
                      revisionId: revision.id,
                      changeSummary,
                    }),
                  );
                }}
              >
                <h4>Complete reviewed revision</h4>
                <p>
                  A newer internally approved plan is required. This summary is
                  delivered as immutable revision history.
                </p>
                <label>
                  Change summary
                  <textarea
                    required
                    maxLength="4000"
                    value={changeSummary}
                    onChange={(event) => setChangeSummary(event.target.value)}
                  />
                </label>
                <button className="primary">Complete revision</button>
              </form>
            ) : null}
            <section className="staff-messages">
              <h4>Secure case messages</h4>
              <div className="staff-thread">
                {messages.length ? (
                  messages.map((message) => {
                    const unread = !(message.case_message_reads ?? []).some(
                      (read) => read.user_id === userId,
                    );
                    const overdue =
                      message.response_owner_user_id === userId &&
                      !message.resolved_at &&
                      message.response_due_at &&
                      new Date(message.response_due_at) < new Date();
                    return (
                      <article
                        key={message.id}
                        className={overdue ? "overdue" : ""}
                      >
                        <header>
                          <strong>
                            {message.sender_user_id === userId
                              ? "You"
                              : (staffNames.get(message.sender_user_id) ??
                                "Household")}
                          </strong>
                          <span>
                            {message.resolved_at
                              ? "Resolved"
                              : overdue
                                ? "Response overdue"
                                : "Open"}
                          </span>
                        </header>
                        <p>{message.body}</p>
                        <MessageAttachments
                          attachments={message.case_attachments}
                          repository={repository}
                          onError={(error) =>
                            setOperation({
                              status: "error",
                              message: error.message,
                            })
                          }
                        />
                        <small>
                          {message.response_due_at
                            ? `Response due ${new Date(message.response_due_at).toLocaleString()}`
                            : "No response owner"}
                        </small>
                        <div className="service-actions">
                          {unread ? (
                            <button
                              className="ghost"
                              onClick={() =>
                                act("Read acknowledgement", () =>
                                  repository.markMessageRead({
                                    householdId: household.household_id,
                                    messageId: message.id,
                                    userId,
                                  }),
                                )
                              }
                            >
                              Mark read
                            </button>
                          ) : null}
                          {/* Only the response owner or an admin may resolve (008), and resolving
                              your own message would only clear the family's reply deadline. */}
                          {!message.resolved_at &&
                          message.sender_user_id !== userId &&
                          (message.response_owner_user_id === userId ||
                            membership.role === "admin") ? (
                            <button
                              className="ghost"
                              onClick={() =>
                                act("Message resolution", () =>
                                  repository.resolveStaffMessage({
                                    householdId: household.household_id,
                                    messageId: message.id,
                                  }),
                                )
                              }
                            >
                              Resolve
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p>No secure messages for this case.</p>
                )}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  act("Secure message", async () => {
                    // Reject unusable files before the message exists, so a bad file can never
                    // leave a sent message behind that a second submit would duplicate.
                    for (const file of messageFiles) validateAttachmentFile(file);
                    const saved = await repository.sendMessage({
                      householdId: household.household_id,
                      caseId: selected.id,
                      userId,
                      kind: "service",
                      body: messageBody,
                    });
                    setMessageBody("");
                    for (const [index, file] of messageFiles.entries()) {
                      try {
                        await repository.uploadMessageAttachment({
                          householdId: household.household_id,
                          messageId: saved.id,
                          file,
                        });
                      } catch (error) {
                        if (error.attachmentRetry) throw error;
                        const left = messageFiles.length - index;
                        setMessageFiles([]);
                        throw new Error(
                          `Secure message sent once, but ${left} file${left === 1 ? "" : "s"} could not be attached: ${error.message} Send ${left === 1 ? "it" : "them"} in a new message.`,
                        );
                      }
                    }
                    setMessageFiles([]);
                  });
                }}
              >
                <label>
                  New secure message
                  <textarea
                    required
                    maxLength="4000"
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                  />
                </label>
                {attachmentsEnabled ? (
                  <label>
                    Attachments <span>(optional)</span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.txt,application/pdf,image/jpeg,image/png,text/plain"
                      multiple
                      onChange={(event) =>
                        setMessageFiles(
                          Array.from(event.target.files ?? []).slice(0, 3),
                        )
                      }
                    />
                    <small>
                      Up to 3 files, 10 MB each. Downloads remain blocked until
                      scanning passes.
                    </small>
                  </label>
                ) : (
                  <p className="attachments-off">
                    File attachments are off until malware scanning is
                    running. Send links or describe the file instead.
                  </p>
                )}
                <button className="primary">Send secure message</button>
              </form>
            </section>
            <StaffNotice state={operation} />
            {learner && repository.listWeeklyNotes ? (
              <StaffWeeklyNote
                key={`note-${learner.id}`}
                repository={repository}
                householdId={household.household_id}
                learner={learner}
                today={localDateString()}
              />
            ) : null}
            {repository.listSharedActivities ? (
              <StaffSharedActivities
                repository={repository}
                householdId={household.household_id}
                learners={currentLearners}
              />
            ) : null}
            <StaffAuthoring
              key={selected.id}
              householdId={household.household_id}
              userId={userId}
              serviceCase={selected}
              plan={plan}
              deliveries={data.deliveries}
              repository={repository}
              act={act}
              revisionAccepted={revisionAccepted}
              planApproved={planApproved}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// The name other staff see in the assign list and message thread, instead of a user ID.
function StaffNameForm({ current, repository, onSaved }) {
  const id = useId();
  const [name, setName] = useState(current);
  const [state, setState] = useState({ status: "idle", message: "" });
  const inputRef = useRef(null);
  // The saved name arrives after the first render (and again after a save).
  useEffect(() => {
    setName(current);
  }, [current]);
  const save = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setState({ status: "error", message: "Add your name, as other staff should see it." });
      inputRef.current?.focus();
      return;
    }
    setState({ status: "loading", message: "Saving…" });
    try {
      await repository.setStaffDisplayName(name);
      setState({ status: "success", message: "Saved. Other staff now see this name." });
      onSaved?.();
    } catch (error) {
      setState({ status: "error", message: error.message });
      inputRef.current?.focus();
    }
  };
  const invalid = state.status === "error";
  return (
    <form className="staff-name-form" onSubmit={save} noValidate>
      <label htmlFor={`${id}-name`}>
        Your name, shown to other staff
        {!current ? <span> (not set yet)</span> : null}
      </label>
      <div className="staff-name-row">
        <input
          id={`${id}-name`}
          ref={inputRef}
          maxLength="80"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
        />
        <button
          className="ghost"
          disabled={
            state.status === "loading" ||
            (name.trim() !== "" && name.trim() === current)
          }
        >
          Save name
        </button>
      </div>
      {invalid ? (
        <p role="alert" id={`${id}-error`} className="form-error-summary">
          {state.message}
        </p>
      ) : state.message ? (
        <p role="status" className="staff-next-hint">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
