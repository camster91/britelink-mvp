import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activityMap,
  caseForLearner,
  dayMovedTo,
  findNextPublishedLesson,
  latestPublishedPlan,
  messageIsUnread,
  orderedPlanWeeks,
  planDayMove,
  unfinishedLessons,
} from "./authenticated-workspace.js";
import { classifyOperationError } from "./operation-state.js";
import { AuthenticatedIntake } from "./AuthenticatedIntake.jsx";
import { AuthenticatedServicePrivacy } from "./AuthenticatedServicePrivacy.jsx";
import { EducatorWorkspace } from "./EducatorWorkspace.jsx";
import { MessageAttachments } from "./MessageAttachments.jsx";
import { startInactivityMonitor } from "./inactivity-monitor.js";

// A signed-in account with no household. Beta families arrive here straight from their sign-in
// link: the details they typed on the join form come back as signup metadata, so the household is
// created once, now that the email is proven. Anyone else (for example a staff member whose
// invitation is not set up yet) sees the same form, prefilled with nothing, plus a way out.
function BetaHouseholdSetup({ repository, metadata, onReady }) {
  const [learnerName, setLearnerName] = useState(
    String(metadata?.beta_learner_name ?? ""),
  );
  const [learnerGrade, setLearnerGrade] = useState(
    String(metadata?.beta_learner_grade ?? ""),
  );
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState([]);
  const nameRef = useRef(null);
  const gradeRef = useRef(null);
  const autoStarted = useRef(false);
  const provision = useCallback(
    async (name, grade) => {
      const missing = [];
      if (!name.trim()) missing.push("name");
      if (!grade.trim()) missing.push("grade");
      setInvalid(missing);
      if (missing.length) {
        setStatus("error");
        setError(
          `Add ${missing.map((field) => (field === "name" ? "your child's first name" : "their grade or level")).join(" and ")} to set up your household.`,
        );
        (missing[0] === "name" ? nameRef : gradeRef).current?.focus();
        return;
      }
      setStatus("loading");
      setError("");
      try {
        await repository.provisionBetaHousehold({
          learnerName: name,
          learnerGrade: grade,
        });
        await onReady();
      } catch (failure) {
        setStatus("error");
        setError(failure.message);
      }
    },
    [onReady, repository],
  );
  useEffect(() => {
    const name = String(metadata?.beta_learner_name ?? "").trim();
    const grade = String(metadata?.beta_learner_grade ?? "").trim();
    if (autoStarted.current || !name || !grade) return;
    autoStarted.current = true;
    provision(name, grade);
  }, [metadata, provision]);
  if (status === "loading")
    return (
      <main className="auth-page" aria-labelledby="setup-heading">
        <section className="auth-card" role="status">
          <h1 id="setup-heading">Setting up your household…</h1>
          <p>Creating your secure family workspace.</p>
        </section>
      </main>
    );
  return (
    <main className="auth-page" aria-labelledby="setup-heading">
      <section className="auth-card">
        <h1 id="setup-heading">Set up your household</h1>
        <p>
          You're signed in, and your account isn't connected to a household yet.
          Tell us who you're planning for to start the free beta. If BriteLink
          invited you as staff, sign out and contact support instead.
        </p>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            provision(learnerName, learnerGrade);
          }}
        >
          {error ? (
            <p role="alert" id="setup-error" className="form-error-summary">
              {error}
            </p>
          ) : null}
          <label>
            Your child's first name
            <input
              ref={nameRef}
              type="text"
              autoComplete="off"
              maxLength={120}
              value={learnerName}
              aria-invalid={invalid.includes("name") || undefined}
              aria-describedby={invalid.includes("name") ? "setup-error" : undefined}
              onChange={(event) => setLearnerName(event.target.value)}
            />
          </label>
          <label>
            Grade or level
            <input
              ref={gradeRef}
              type="text"
              autoComplete="off"
              maxLength={60}
              placeholder="e.g. Grade 3"
              value={learnerGrade}
              aria-invalid={invalid.includes("grade") || undefined}
              aria-describedby={invalid.includes("grade") ? "setup-error" : undefined}
              onChange={(event) => setLearnerGrade(event.target.value)}
            />
          </label>
          <button className="primary">Start the free beta</button>
          <button
            type="button"
            className="ghost"
            onClick={() => repository.signOut()}
          >
            Sign out
          </button>
        </form>
        <small>
          Do not send child, health, school, diagnosis, or IEP information by
          email.
        </small>
      </section>
    </main>
  );
}

function SignIn({ repository }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  // Beta signup fields. Optional: an invited family signs in without them.
  const [joining, setJoining] = useState(false);
  const [learnerName, setLearnerName] = useState("");
  const [learnerGrade, setLearnerGrade] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      if (joining) {
        if (!learnerName.trim() || !learnerGrade.trim()) {
          setStatus("error");
          setMessage("Add your child's name and grade to join the beta.");
          return;
        }
        // The household is created after the link is followed, never before: see
        // BetaHouseholdSetup and migration 041.
        await repository.joinBeta(email, globalThis.location?.origin, {
          learnerName,
          learnerGrade,
        });
        setStatus("sent");
        setMessage(
          "Welcome to the beta. Check your email for a secure sign-in link.",
        );
        return;
      }
      await repository.signInWithEmail(email, globalThis.location?.origin);
      setStatus("sent");
      setMessage("Check your email for a secure sign-in link.");
    } catch (error) {
      setStatus("error");
      setMessage(error.message);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-card">
        <img src="/assets/britelink-logo.png" alt="BriteLink" />
        <span className="eyebrow">Secure family and educator workspace</span>
        <h1 id="auth-heading">Sign in or join the beta</h1>
        <p>
          Enter your email and we'll send you a secure sign-in link. New families
          can join the free beta from this same form.
        </p>
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {joining ? (
            <>
              <label>
                Your child's first name
                <input
                  type="text"
                  autoComplete="off"
                  required
                  maxLength={120}
                  value={learnerName}
                  onChange={(event) => setLearnerName(event.target.value)}
                />
              </label>
              <label>
                Grade or level
                <input
                  type="text"
                  autoComplete="off"
                  required
                  maxLength={60}
                  placeholder="e.g. Grade 3"
                  value={learnerGrade}
                  onChange={(event) => setLearnerGrade(event.target.value)}
                />
              </label>
            </>
          ) : null}
          <button className="primary" disabled={status === "loading"}>
            {status === "loading"
              ? "Sending secure link…"
              : joining
                ? "Join the free beta"
                : "Email me a sign-in link"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setJoining((current) => !current)}
          >
            {joining
              ? "I already have an account"
              : "New here? Join the free beta"}
          </button>
          <span
            role="status"
            aria-live="polite"
            className={status === "error" ? "error" : ""}
          >
            {message}
          </span>
        </form>
        <p className="auth-recovery">
          Already invited? Use the same form — it signs you in and never creates
          a duplicate account.
        </p>
        <small>
          Do not send child, health, school, diagnosis, or IEP information by
          email.
        </small>
      </section>
    </main>
  );
}

function OperationNotice({ operation, retry }) {
  if (!operation.message) return null;
  const failure = ["offline", "conflict", "session_expired", "error"].includes(
    operation.status,
  );
  const retryAction = operation.onRetry ?? retry;
  return (
    <div
      className={`live-operation ${failure ? "failure" : "success"}`}
      role={failure ? "alert" : "status"}
    >
      <span>{operation.message}</span>
      {operation.canRetry && retryAction ? (
        <button type="button" onClick={retryAction}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

function ParentWorkspace({
  household,
  learners,
  cases,
  repository,
  userId,
  userEmail,
  privacyNoticeVersion,
}) {
  const [learnerId, setLearnerId] = useState(learners[0]?.id ?? "");
  const [planState, setPlanState] = useState({
    status: "loading",
    plans: [],
    activities: [],
    error: null,
  });
  const [messages, setMessages] = useState({
    status: "idle",
    items: [],
    error: null,
  });
  const [weekIndex, setWeekIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [selectedLessonId, setSelectedLessonId] = useState(null);
  const [draft, setDraft] = useState({
    status: "not_started",
    note: "",
    scheduleReason: "",
    scheduledFor: "",
  });
  const [activityOperation, setActivityOperation] = useState({
    status: "idle",
    message: "",
    canRetry: false,
  });
  const [dayMove, setDayMove] = useState({ reason: "", scheduledFor: "" });
  const [dayMoveOperation, setDayMoveOperation] = useState({
    status: "idle",
    message: "",
    canRetry: false,
  });
  const [messageBody, setMessageBody] = useState("");
  const [messageFiles, setMessageFiles] = useState([]);
  const [attachmentRecovery, setAttachmentRecovery] = useState([]);
  const [messageOperation, setMessageOperation] = useState({
    status: "idle",
    message: "",
    canRetry: false,
  });
  const [serviceRefresh, setServiceRefresh] = useState(0);
  const planRequest = useRef(0);
  const messageRequest = useRef(0);
  const attachmentRecoveryRef = useRef([]);
  const selectedLearner =
    learners.find((item) => item.id === learnerId) ?? learners[0];
  const selectedCase = caseForLearner(cases, selectedLearner?.id);

  const loadPlan = useCallback(async () => {
    if (!selectedLearner) return;
    const request = ++planRequest.current;
    setPlanState({ status: "loading", plans: [], activities: [], error: null });
    try {
      const [plans, activities] = await Promise.all([
        repository.loadPublishedPlans(
          household.household_id,
          selectedLearner.id,
        ),
        repository.listLessonActivities(
          household.household_id,
          selectedLearner.id,
        ),
      ]);
      if (request === planRequest.current)
        setPlanState({ status: "success", plans, activities, error: null });
    } catch (error) {
      if (request === planRequest.current)
        setPlanState({
          status: "error",
          plans: [],
          activities: [],
          error: error.message,
        });
    }
  }, [household.household_id, repository, selectedLearner]);
  const loadMessages = useCallback(async () => {
    const request = ++messageRequest.current;
    if (!selectedCase) {
      setMessages({ status: "empty", items: [], error: null });
      return;
    }
    setMessages({ status: "loading", items: [], error: null });
    try {
      const items = await repository.listMessages(
        household.household_id,
        selectedCase.id,
      );
      if (request === messageRequest.current)
        setMessages({ status: "success", items, error: null });
    } catch (error) {
      if (request === messageRequest.current)
        setMessages({ status: "error", items: [], error: error.message });
    }
  }, [household.household_id, repository, selectedCase]);
  useEffect(() => {
    setWeekIndex(0);
    setDayIndex(0);
    setSelectedLessonId(null);
    loadPlan();
  }, [loadPlan]);
  useEffect(() => {
    setMessageBody("");
    setMessageFiles([]);
    setAttachmentRecovery([]);
    attachmentRecoveryRef.current = [];
    loadMessages();
  }, [loadMessages]);

  const plan = latestPublishedPlan(planState.plans);
  const weeks = useMemo(() => orderedPlanWeeks(plan), [plan]);
  const week = weeks[weekIndex] ?? weeks[0];
  const day = week?.plan_days?.[dayIndex] ?? week?.plan_days?.[0];
  const activities = useMemo(
    () => activityMap(planState.activities),
    [planState.activities],
  );
  const selectedLesson =
    day?.lessons?.find((item) => item.id === selectedLessonId) ??
    day?.lessons?.[0] ??
    null;
  useEffect(() => {
    if (!selectedLesson) return;
    const activity = activities[selectedLesson.id];
    setSelectedLessonId(selectedLesson.id);
    setDraft({
      status: activity?.status ?? "not_started",
      note: activity?.caregiver_note ?? "",
      scheduleReason: activity?.schedule_reason ?? "",
      scheduledFor: activity?.scheduled_for ?? "",
    });
  }, [selectedLesson?.id, activities]);

  const operationFailure = (error, action) => {
    const status = classifyOperationError(error);
    return {
      status,
      message:
        status === "offline"
          ? `${action} was not saved because you are offline.`
          : status === "conflict"
            ? `${action} conflicted with a newer change. Reload before trying again.`
            : status === "session_expired"
              ? "Your session has expired. Sign in again before changing data."
              : error.message,
      canRetry: status === "offline" || status === "error",
    };
  };
  const saveActivity = async () => {
    if (!selectedLesson) return;
    const input = {
      householdId: household.household_id,
      learnerId: selectedLearner.id,
      lessonId: selectedLesson.id,
      userId,
      status: draft.status,
      note: draft.note,
      scheduleReason: draft.scheduleReason,
      scheduledFor: draft.scheduledFor,
    };
    const previous = planState.activities;
    setPlanState((state) => ({
      ...state,
      activities: [
        ...state.activities.filter(
          (item) => item.lesson_id !== selectedLesson.id,
        ),
        {
          lesson_id: selectedLesson.id,
          status: draft.status,
          caregiver_note: draft.note,
          schedule_reason: draft.scheduleReason || null,
          scheduled_for: draft.scheduledFor || null,
          updated_at: new Date().toISOString(),
        },
      ],
    }));
    setActivityOperation({
      status: "loading",
      message: "Saving lesson activity…",
      canRetry: false,
    });
    try {
      const saved = await repository.saveLessonActivity(input);
      setPlanState((state) => ({
        ...state,
        activities: [
          ...state.activities.filter(
            (item) => item.lesson_id !== selectedLesson.id,
          ),
          saved,
        ],
      }));
      setActivityOperation({
        status: "success",
        message: draft.scheduleReason
          ? "Lesson activity and new schedule saved securely."
          : "Lesson activity saved securely.",
        canRetry: false,
      });
    } catch (error) {
      setPlanState((state) => ({ ...state, activities: previous }));
      setActivityOperation(operationFailure(error, "Lesson activity"));
    }
  };
  useEffect(() => {
    setDayMove({ reason: "", scheduledFor: "" });
    setDayMoveOperation({ status: "idle", message: "", canRetry: false });
  }, [day?.id]);
  // Moves every unfinished lesson of the selected day. Each lesson is its own upsert, so a
  // failure part-way leaves the rest saved; retry then resends only the lessons that failed.
  const moveDay = async (pending) => {
    const moves =
      pending ??
      planDayMove(day, activities, {
        reason: dayMove.reason,
        scheduledFor: dayMove.scheduledFor,
      });
    if (!moves.length) return;
    setDayMoveOperation({
      status: "loading",
      message: `Moving ${moves.length} lesson${moves.length === 1 ? "" : "s"}…`,
      canRetry: false,
    });
    const failed = [];
    let lastError = null;
    for (const move of moves) {
      try {
        const saved = await repository.saveLessonActivity({
          householdId: household.household_id,
          learnerId: selectedLearner.id,
          userId,
          ...move,
        });
        setPlanState((state) => ({
          ...state,
          activities: [
            ...state.activities.filter((item) => item.lesson_id !== move.lessonId),
            saved,
          ],
        }));
      } catch (error) {
        failed.push(move);
        lastError = error;
      }
    }
    const date = moves[0].scheduledFor;
    if (!failed.length) {
      setDayMoveOperation({
        status: "success",
        message: `Moved ${moves.length} unfinished lesson${moves.length === 1 ? "" : "s"} to ${date}. Progress and notes were kept.`,
        canRetry: false,
      });
      return;
    }
    const failure = operationFailure(lastError, "Moving this day");
    setDayMoveOperation({
      ...failure,
      message: `${moves.length - failed.length} of ${moves.length} lessons moved to ${date}. ${failure.message}`,
      onRetry: () => moveDay(failed),
    });
  };
  const sendMessage = async (event) => {
    event.preventDefault();
    const body = messageBody;
    const files = messageFiles;
    setMessageOperation({
      status: "loading",
      message: files.length
        ? "Sending message and uploading attachments…"
        : "Sending secure message…",
      canRetry: false,
    });
    let saved;
    try {
      saved = await repository.sendMessage({
        householdId: household.household_id,
        caseId: selectedCase.id,
        userId,
        body,
      });
    } catch (error) {
      setMessageOperation(operationFailure(error, "Message"));
      return;
    }
    setMessages((state) => ({
      ...state,
      status: "success",
      items: [...state.items, saved],
    }));
    setMessageBody("");
    const failed = [];
    for (const file of files) {
      try {
        await repository.uploadMessageAttachment({
          householdId: household.household_id,
          messageId: saved.id,
          file,
        });
      } catch (error) {
        if (error.attachmentRetry) failed.push(error.attachmentRetry);
        else failed.push({ attachmentId: null, file, error: error.message });
      }
    }
    await loadMessages();
    if (failed.length) {
      attachmentRecoveryRef.current = failed;
      setAttachmentRecovery(failed);
      setMessageFiles(failed.map((item) => item.file));
      setMessageOperation({
        status: "error",
        message: `Message sent once. ${failed.length} attachment upload${failed.length === 1 ? "" : "s"} failed. Retry attachments only; the message will not be resent.`,
        canRetry: failed.every((item) => item.attachmentId),
        onRetry: retryAttachments,
      });
    } else {
      attachmentRecoveryRef.current = [];
      setAttachmentRecovery([]);
      setMessageFiles([]);
      setMessageOperation({
        status: "success",
        message: files.length
          ? "Message sent. Attachments are quarantined until their security scan passes."
          : "Message sent to your BriteLink case.",
        canRetry: false,
      });
    }
  };
  const retryAttachments = async () => {
    const pending = attachmentRecoveryRef.current;
    if (!pending.length) return;
    setMessageOperation({
      status: "loading",
      message: "Retrying failed attachments without resending the message…",
      canRetry: false,
    });
    const failed = [];
    for (const retry of pending) {
      try {
        await repository.retryMessageAttachmentUpload({
          householdId: household.household_id,
          attachmentId: retry.attachmentId,
          file: retry.file,
        });
      } catch (error) {
        failed.push(error.attachmentRetry ?? retry);
      }
    }
    await loadMessages();
    attachmentRecoveryRef.current = failed;
    setAttachmentRecovery(failed);
    setMessageFiles(failed.map((item) => item.file));
    setMessageOperation(
      failed.length
        ? {
            status: "error",
            message: `Message remains sent. ${failed.length} attachment upload${failed.length === 1 ? "" : "s"} still failed; retrying will not duplicate the message.`,
            canRetry: true,
            onRetry: retryAttachments,
          }
        : {
            status: "success",
            message:
              "Failed attachments uploaded to the original message and are quarantined until scanning passes.",
            canRetry: false,
          },
    );
  };
  const markRead = async (message) => {
    setMessageOperation({
      status: "loading",
      message: "Marking message as read…",
      canRetry: false,
    });
    try {
      const read = await repository.markMessageRead({
        householdId: household.household_id,
        messageId: message.id,
        userId,
      });
      setMessages((state) => ({
        ...state,
        items: state.items.map((item) =>
          item.id === message.id
            ? {
                ...item,
                case_message_reads: [...(item.case_message_reads ?? []), read],
              }
            : item,
        ),
      }));
      setMessageOperation({
        status: "success",
        message: "Message marked as read.",
        canRetry: false,
      });
    } catch (error) {
      setMessageOperation(operationFailure(error, "Read acknowledgement"));
    }
  };

  const nextLesson = findNextPublishedLesson(weeks, activities);
  const jumpToNextLesson = () => {
    if (!nextLesson) return;
    setWeekIndex(nextLesson.weekIndex);
    setDayIndex(nextLesson.dayIndex);
    setSelectedLessonId(nextLesson.lesson.id);
  };
  return (
    <>
      <nav className="household-jump" aria-label="Household sections">
        <a href="#learner-heading">Learner</a>
        <a href="#intake-heading">Intake</a>
        <a href="#plan-heading">Plan</a>
        <a href="#messages-heading">Messages</a>
        <a href="#service-heading">Privacy</a>
      </nav>
      <section className="live-selector" aria-labelledby="learner-heading">
        <div>
          <span className="eyebrow">Parent plan workspace</span>
          <h2 id="learner-heading">Choose a learner</h2>
        </div>
        <label>
          Learner
          <select
            value={selectedLearner.id}
            onChange={(event) => setLearnerId(event.target.value)}
          >
            {learners.map((item) => (
              <option key={item.id} value={item.id}>
                {item.preferred_name} · {item.grade_label ?? "Grade not set"}
              </option>
            ))}
          </select>
        </label>
      </section>
      <AuthenticatedIntake
        householdId={household.household_id}
        learner={selectedLearner}
        repository={repository}
        privacyNoticeVersion={privacyNoticeVersion}
        onSubmitted={() => setServiceRefresh((value) => value + 1)}
      />
      <div className="live-parent-grid">
        <section className="live-plan" aria-labelledby="plan-heading">
          <header>
            <div>
              <span className="eyebrow">Published learning plan</span>
              <h2 id="plan-heading">{selectedLearner.preferred_name}’s plan</h2>
            </div>
            {plan ? (
              <span className="case-status">Version {plan.version}</span>
            ) : null}
          </header>
          {planState.status === "loading" ? (
            <p className="plan-state" role="status">Loading the published plan and saved activity…</p>
          ) : planState.status === "error" ? (
            <div className="plan-state">
              <p role="alert">{planState.error}</p>
              <button className="ghost" onClick={loadPlan}>
                Try again
              </button>
            </div>
          ) : !plan ? (
            <p className="parent-empty">
              Your educator is working on your personalized plan. You'll see it here once it's ready to start.
            </p>
          ) : !weeks.length ? (
            <p className="parent-empty">
              This plan is being prepared. If this persists, contact BriteLink support (remember: no child details by email).
            </p>
          ) : (
            <>
              {nextLesson ? (
                <section className="next-up compact" aria-labelledby="parent-next-heading">
                  <div>
                    <span className="eyebrow">Do this next</span>
                    <h3 id="parent-next-heading">{nextLesson.lesson.title}</h3>
                    <p>
                      Week {nextLesson.week.week_number} · Day {nextLesson.day.day_number} ·{" "}
                      {(nextLesson.status ?? "not_started").replaceAll("_", " ")}
                    </p>
                  </div>
                  <button className="primary" type="button" onClick={jumpToNextLesson}>
                    Open next lesson
                  </button>
                </section>
              ) : (
                <p className="parent-empty" role="status">
                  All lessons complete! You can still review any day or adjust lesson statuses.
                </p>
              )}
            </>
          )}
          {plan && weeks.length && planState.status === "success" ? (
            <>
              <div
                className="live-week-tabs"
                role="group"
                aria-label="Plan weeks"
              >
                {weeks.map((item, index) => (
                  <button
                    key={item.id}
                    aria-pressed={weekIndex === index}
                    onClick={() => {
                      setWeekIndex(index);
                      setDayIndex(0);
                      setSelectedLessonId(null);
                    }}
                  >
                    Week {item.week_number}
                    <small>{item.theme}</small>
                  </button>
                ))}
              </div>
              <div
                className="live-day-tabs"
                role="group"
                aria-label={`Days in week ${week.week_number}`}
              >
                {week.plan_days.map((item, index) => (
                  <button
                    key={item.id}
                    aria-pressed={dayIndex === index}
                    onClick={() => {
                      setDayIndex(index);
                      setSelectedLessonId(null);
                    }}
                  >
                    Day {item.day_number}
                    <small>
                      {dayMovedTo(item, activities)
                        ? `Moved to ${dayMovedTo(item, activities)}`
                        : (item.planned_date ?? "Flexible")}
                    </small>
                  </button>
                ))}
              </div>
              {unfinishedLessons(day, activities).length ? (
                <details
                  className="live-day-move"
                  open={dayMoveOperation.status !== "idle" || undefined}
                >
                  <summary>Need to move this day?</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      moveDay();
                    }}
                  >
                    <fieldset className="live-schedule">
                      <legend>
                        Move this day <span>(unfinished lessons only)</span>
                      </legend>
                      <label>
                        Why move this day?
                        <select
                          required
                          value={dayMove.reason}
                          onChange={(event) =>
                            setDayMove((value) => ({ ...value, reason: event.target.value }))
                          }
                        >
                          <option value="">Select one</option>
                          <option value="illness">Illness</option>
                          <option value="travel">Travel</option>
                          <option value="caregiver_schedule">Caregiver schedule</option>
                          <option value="catch_up">Catch-up day</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label>
                        Move to
                        <input
                          type="date"
                          required
                          value={dayMove.scheduledFor}
                          onChange={(event) =>
                            setDayMove((value) => ({ ...value, scheduledFor: event.target.value }))
                          }
                        />
                      </label>
                      <small>
                        Life happens. Completed and skipped lessons stay where they
                        are; everything else keeps its progress and notes.
                      </small>
                      <button
                        className="ghost"
                        disabled={dayMoveOperation.status === "loading"}
                      >
                        Move unfinished lessons
                      </button>
                    </fieldset>
                    <OperationNotice operation={dayMoveOperation} />
                  </form>
                </details>
              ) : null}
              {!day?.lessons?.length ? (
                <p>No lessons are scheduled for this day.</p>
              ) : (
                <div className="live-lesson-workspace">
                  <div
                    className="live-lesson-list"
                    role="group"
                    aria-label="Lessons"
                  >
                    {day.lessons.map((item) => (
                      <button
                        key={item.id}
                        aria-pressed={selectedLesson?.id === item.id}
                        onClick={() => setSelectedLessonId(item.id)}
                      >
                        <span>{item.subject}</span>
                        <strong>{item.title}</strong>
                        <small>
                          {(
                            activities[item.id]?.status ?? "not_started"
                          ).replaceAll("_", " ")}
                          {activities[item.id]?.scheduled_for
                            ? ` · moved to ${activities[item.id].scheduled_for}`
                            : ""}
                        </small>
                      </button>
                    ))}
                  </div>
                  {selectedLesson ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveActivity();
                      }}
                      className="live-activity"
                    >
                      <span className="eyebrow">Selected lesson</span>
                      <h3>{selectedLesson.title}</h3>
                      <p>{selectedLesson.objective}</p>
                      <section
                        className="lesson-directions"
                        aria-label="Lesson directions"
                      >
                        <h4>Instructions</h4>
                        {selectedLesson.instructions?.length ? (
                          <ol>
                            {selectedLesson.instructions.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ol>
                        ) : (
                          <p>
                            No instructions were provided. Contact BriteLink
                            before starting.
                          </p>
                        )}
                        <h4>Materials</h4>
                        {selectedLesson.materials?.length ? (
                          <ul>
                            {selectedLesson.materials.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No materials are required.</p>
                        )}
                        <h4>Adaptations</h4>
                        {selectedLesson.accommodations?.length ? (
                          <ul>
                            {selectedLesson.accommodations.map(
                              (item, index) => (
                                <li key={index}>{item}</li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p>No specific adaptations were recorded.</p>
                        )}
                        <p>
                          <strong>Adult help:</strong>{" "}
                          {selectedLesson.adult_help_minutes == null
                            ? "Not specified"
                            : `${selectedLesson.adult_help_minutes} minutes`}
                        </p>
                        <h4>Resources</h4>
                        {selectedLesson.resources?.length ? (
                          <ul className="lesson-resources">
                            {selectedLesson.resources.map((resource) => (
                              <li key={resource.id}>
                                <strong>{resource.title}</strong>
                                <span>
                                  {resource.requirement} ·{" "}
                                  {resource.access_type}
                                  {resource.estimated_cost_cents
                                    ? ` · estimated $${(resource.estimated_cost_cents / 100).toFixed(2)}`
                                    : ""}
                                  {resource.region
                                    ? ` · ${resource.region}`
                                    : ""}
                                </span>
                                {resource.url ? (
                                  <a
                                    href={resource.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open reviewed resource
                                  </a>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>No external resources are required.</p>
                        )}
                      </section>
                      <label>
                        Status
                        <select
                          value={draft.status}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              status: event.target.value,
                            }))
                          }
                        >
                          <option value="not_started">Not started</option>
                          <option value="in_progress">In progress</option>
                          <option value="paused">Paused</option>
                          <option value="completed">Completed</option>
                          <option value="skipped">Skipped</option>
                        </select>
                      </label>
                      <fieldset className="live-schedule">
                        <legend>
                          Move this lesson <span>(optional)</span>
                        </legend>
                        <label>
                          Reason
                          <select
                            value={draft.scheduleReason}
                            onChange={(event) =>
                              setDraft((value) => ({
                                ...value,
                                scheduleReason: event.target.value,
                                scheduledFor: event.target.value
                                  ? value.scheduledFor
                                  : "",
                              }))
                            }
                          >
                            <option value="">Keep current date</option>
                            <option value="illness">Illness</option>
                            <option value="travel">Travel</option>
                            <option value="caregiver_schedule">
                              Caregiver schedule
                            </option>
                            <option value="catch_up">Catch-up day</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        <label>
                          New date
                          <input
                            type="date"
                            disabled={!draft.scheduleReason}
                            required={Boolean(draft.scheduleReason)}
                            value={draft.scheduledFor}
                            onChange={(event) =>
                              setDraft((value) => ({
                                ...value,
                                scheduledFor: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <small>
                          Choose only a general reason. Do not enter medical
                          details.
                        </small>
                      </fieldset>
                      <label>
                        Caregiver note <span>(optional)</span>
                        <textarea
                          maxLength="2000"
                          value={draft.note}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              note: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        className="primary"
                        disabled={activityOperation.status === "loading"}
                      >
                        Save lesson activity
                      </button>
                      <OperationNotice
                        operation={activityOperation}
                        retry={saveActivity}
                      />
                    </form>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </section>
        <section className="live-messages" aria-labelledby="messages-heading">
          <header>
            <span className="eyebrow">Secure case messages</span>
            <h2 id="messages-heading">Ask your educator</h2>
            {selectedCase ? (
              <p>
                {selectedCase.package_code} ·{" "}
                {selectedCase.status.replaceAll("_", " ")}
              </p>
            ) : null}
          </header>
          {!selectedCase ? (
            <p className="parent-empty">
              Messaging will be available once your educator starts working on this learner's plan.
            </p>
          ) : messages.status === "loading" ? (
            <p className="plan-state" role="status">Loading case messages…</p>
          ) : messages.status === "error" ? (
            <div className="plan-state">
              <p role="alert">{messages.error}</p>
              <button className="ghost" onClick={loadMessages}>
                Try again
              </button>
            </div>
          ) : (
            <>
              <div className="live-thread">
                {messages.items.length ? (
                  messages.items.map((message) => {
                    const unread = messageIsUnread(message, userId);
                    return (
                      <article
                        key={message.id}
                        className={unread ? "unread" : ""}
                      >
                        <header>
                          <strong>
                            {message.sender_user_id === userId
                              ? "You"
                              : "BriteLink team"}
                          </strong>
                          <time>
                            {new Date(message.created_at).toLocaleString()}
                          </time>
                        </header>
                        <p>{message.body}</p>
                        <MessageAttachments
                          attachments={message.case_attachments}
                          repository={repository}
                          onError={(error) =>
                            setMessageOperation(
                              operationFailure(error, "Attachment download"),
                            )
                          }
                        />
                        {unread ? (
                          <button
                            type="button"
                            onClick={() => markRead(message)}
                          >
                            Mark as read
                          </button>
                        ) : null}
                      </article>
                    );
                  })
                ) : (
                  <p>
                    No messages yet. Use this secure thread instead of email for
                    learner information.
                  </p>
                )}
              </div>
              <form onSubmit={sendMessage}>
                <label>
                  New secure message
                  <textarea
                    required
                    maxLength="4000"
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                  />
                </label>
                <small>{messageBody.length}/4000 characters</small>
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
                    Up to 3 PDF, JPEG, PNG, or text files; 10 MB each. Files
                    stay quarantined until scanned.
                  </small>
                </label>
                <button
                  className="primary"
                  disabled={messageOperation.status === "loading"}
                >
                  Send message
                </button>
              </form>
              <OperationNotice
                operation={messageOperation}
                retry={
                  messageBody
                    ? () => sendMessage({ preventDefault() {} })
                    : null
                }
              />
            </>
          )}
        </section>
      </div>
      <AuthenticatedServicePrivacy
        householdId={household.household_id}
        learner={selectedLearner}
        serviceCase={selectedCase}
        userId={userId}
        userEmail={userEmail}
        repository={repository}
        refreshKey={serviceRefresh}
      />
    </>
  );
}

export function Workspace({
  repository,
  session,
  privacyNoticeVersion = null,
  inactivityMs,
  staffRefreshIntervalMs,
}) {
  const [state, setState] = useState({
    status: "loading",
    memberships: [],
    learners: [],
    cases: [],
    household: null,
    error: null,
  });
  const [householdId, setHouseholdId] = useState("");
  const workspaceRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++workspaceRequest.current;
    setState((previous) => ({
      ...previous,
      status: "loading",
      learners: [],
      cases: [],
      error: null,
    }));
    try {
      const memberships = await repository.listMemberships();
      if (request !== workspaceRequest.current) return;
      if (!memberships.length) {
        setState({
          status: "empty",
          memberships,
          learners: [],
          cases: [],
          household: null,
          error: null,
        });
        return;
      }
      const household =
        memberships.find((item) => item.household_id === householdId) ??
        memberships[0];
      if (household.household_id !== householdId)
        setHouseholdId(household.household_id);
      const [learners, cases] = await Promise.all([
        repository.listLearners(household.household_id),
        repository.listCases(household.household_id),
      ]);
      if (request === workspaceRequest.current)
        setState({
          status: learners.length ? "success" : "no_learners",
          memberships,
          learners,
          cases,
          household,
          error: null,
        });
    } catch (error) {
      if (request === workspaceRequest.current)
        setState((previous) => ({
          ...previous,
          status: "error",
          error: error.message,
        }));
    }
  }, [householdId, repository]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(
    () =>
      startInactivityMonitor({
        timeoutMs: inactivityMs,
        onTimeout: () => repository.signOut(),
      }),
    [inactivityMs, repository],
  );
  if (state.status === "loading")
    return (
      <main className="auth-page">
        <section className="auth-card" role="status">
          <h1>Loading your secure workspace…</h1>
          <p>Checking household access and current case data.</p>
        </section>
      </main>
    );
  if (state.status === "error")
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>We couldn’t load your workspace</h1>
          <p role="alert">{state.error}</p>
          <button className="primary" onClick={load}>
            Try again
          </button>
          <button className="ghost" onClick={() => repository.signOut()}>
            Sign out
          </button>
        </section>
      </main>
    );
  if (state.status === "empty")
    return (
      <BetaHouseholdSetup
        repository={repository}
        metadata={session?.user?.user_metadata}
        onReady={load}
      />
    );
  const isStaff = ["educator", "admin"].includes(state.household.role);
  return (
    <div className="live-shell">
      <a className="skip-link" href="#live-main">
        Skip to main content
      </a>
      <header>
        <img src="/assets/britelink-logo.png" alt="BriteLink" />
        <div>
          <span>Authenticated workspace</span>
          <strong>{session.user.email}</strong>
          <button onClick={() => repository.signOut()}>Sign out</button>
        </div>
      </header>
      <main id="live-main">
        <div className="live-notice" role="note">
          <strong>Private to your family</strong>
          <span>
            Only you and the educator working with your child can see what's here.
            If you step away, we sign you out after 15 minutes to keep it safe.
          </span>
        </div>
        {state.memberships.length > 1 ? (
          <section
            className="live-selector membership-selector"
            aria-labelledby="workspace-selector-heading"
          >
            <div>
              <span className="eyebrow">Account access</span>
              <h2 id="workspace-selector-heading">Choose a workspace</h2>
            </div>
            <label>
              Workspace
              <select
                value={state.household.household_id}
                onChange={(event) => setHouseholdId(event.target.value)}
              >
                {state.memberships.map((item) => (
                  <option key={item.household_id} value={item.household_id}>
                    {item.households?.display_name ?? "BriteLink household"} ·{" "}
                    {item.role}
                  </option>
                ))}
              </select>
            </label>
          </section>
        ) : null}
        <span className="eyebrow">
          {isStaff ? "Staff workspace" : "Household workspace"}
        </span>
        <h1>
          {state.household.households?.display_name ??
            "Your BriteLink household"}
        </h1>
        {state.status === "no_learners" ? (
          <section className="live-empty">
            <h2>No learners have been added</h2>
            <p>
              Your household exists, but an administrator must complete learner
              setup before a plan can be delivered.
            </p>
          </section>
        ) : isStaff ? (
          <EducatorWorkspace
            key={state.household.household_id}
            household={state.household}
            membership={state.household}
            learners={state.learners}
            cases={state.cases}
            repository={repository}
            userId={session.user.id}
            refreshIntervalMs={staffRefreshIntervalMs}
          />
        ) : (
          <ParentWorkspace
            key={state.household.household_id}
            household={state.household}
            learners={state.learners}
            cases={state.cases}
            repository={repository}
            userId={session.user.id}
            userEmail={session.user.email}
            privacyNoticeVersion={privacyNoticeVersion}
          />
        )}
        <p className="live-limit">
          You're in the free beta. Things may change as we improve them, and we'd
          love to hear what works for your family.
        </p>
      </main>
    </div>
  );
}

export function AuthenticatedApp({
  client,
  repository,
  privacyNoticeVersion = null,
}) {
  const [auth, setAuth] = useState({
    status: "loading",
    session: null,
    error: null,
  });
  useEffect(() => {
    let active = true;
    repository
      .session()
      .then((session) => {
        if (active) setAuth({ status: "ready", session, error: null });
      })
      .catch((error) => {
        if (active)
          setAuth({ status: "error", session: null, error: error.message });
      });
    const { data } = client.auth.onAuthStateChange((_event, session) =>
      setAuth({ status: "ready", session, error: null }),
    );
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client, repository]);
  if (auth.status === "loading")
    return (
      <main className="auth-page">
        <section className="auth-card" role="status">
          <h1>Checking your session…</h1>
        </section>
      </main>
    );
  if (auth.status === "error")
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Secure sign-in is unavailable</h1>
          <p role="alert">{auth.error}</p>
          <button
            className="primary"
            onClick={() => globalThis.location?.reload()}
          >
            Try again
          </button>
        </section>
      </main>
    );
  return auth.session ? (
    <Workspace
      repository={repository}
      session={auth.session}
      privacyNoticeVersion={privacyNoticeVersion}
    />
  ) : (
    <SignIn repository={repository} />
  );
}
