import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  calculateProgress,
  createDemoPlan,
  DAYS,
  DEMO_PROFILE,
  findNextLesson,
  getLessonStatus,
  safeParseStored,
  statusLabel,
  STORAGE_KEYS,
  updateLessonActivity,
  updateLessonSchedule,
  validateProfile,
} from "./domain.js";
import { CASE_TRANSITIONS, InMemoryBriteLinkRepository, createServiceSeed } from "./service-domain.js";
import { staffNextAction, staffPriorityLabel } from "./staff-workspace.js";

const VIEW_TITLES = {
  home: "Overview",
  plan: "Learning plan",
  intake: "Learner profile",
  educator: "Educator demo",
};

function useDeviceState(key, fallback) {
  const [value, setValue] = useState(() => safeParseStored(globalThis.localStorage?.getItem(key), fallback));
  const save = (next) => {
    const resolved = typeof next === "function" ? next(value) : next;
    setValue(resolved);
    globalThis.localStorage?.setItem(key, JSON.stringify(resolved));
    return resolved;
  };
  return [value, save];
}

function Brand() {
  return <img className="logo" src="/assets/britelink-logo.png" alt="BriteLink" />;
}

function SkipLink() {
  return (
    <a className="skip-link" href="#workspace-main">
      Skip to main content
    </a>
  );
}

function Sidebar({ view, setView }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <Brand />
      </div>
      <nav aria-label="Workspace navigation">
        {[
          ["home", "Overview"],
          ["plan", "Learning plan"],
          ["intake", "Learner profile"],
          ["educator", "Educator demo"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={view === id ? "nav active" : "nav"}
            aria-current={view === id ? "page" : undefined}
            onClick={() => setView(id)}
          >
            <i aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <div className="side-end">
        <section className="support">
          <span className="eyebrow">Demo support</span>
          <strong>No sensitive data</strong>
          <p>This prototype stores sample changes on this device only.</p>
        </section>
        <div className="account">
          <b>AM</b>
          <span>
            <strong>Alex Morgan</strong>
            <small>Fictional guardian</small>
          </span>
        </div>
      </div>
    </aside>
  );
}

function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <strong>Interactive demo</strong>
      <span>Fictional family data · Saved only in this browser · Not connected to BriteLink operations</span>
    </div>
  );
}

function Header({ eyebrow, title, action }) {
  return (
    <header className="header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}

function StatusLabel({ status }) {
  return <span className={`lesson-status ${status}`}>{statusLabel(status)}</span>;
}

function Overview({ setView, plan, activity }) {
  const progress = calculateProgress(plan, activity);
  const next = findNextLesson(plan, activity);
  return (
    <>
      <Header
        eyebrow="Prototype workspace"
        title="Welcome, Alex."
        action={
          <button className="ghost" disabled>
            Messages <b>Demo</b>
          </button>
        }
      />
      <section className="hero">
        <div>
          <span className="pill">Sample plan ready</span>
          <h2>Explore Riley’s fictional learning plan.</h2>
          <p>
            This demo shows how a delivered BritePath plan could work. It does not show a live order, educator status, or
            delivery estimate.
          </p>
          <div className="progress">
            <progress
              max={progress.total}
              value={progress.completed}
              aria-label={`${progress.completed} of ${progress.total} sample lessons completed`}
            />
            <strong>{progress.percent}%</strong>
          </div>
          <small>
            {progress.completed} of {progress.total} sample lessons marked complete on this device
          </small>
        </div>
        <img src="/assets/britely-mascot.webp" alt="Briteley, the BriteLink learning companion" />
      </section>
      <section className="next-up" aria-labelledby="next-up-heading">
        <span className="eyebrow">What to do today</span>
        <h2 id="next-up-heading">{next ? "Your next sample lesson" : "Sample plan complete on this device"}</h2>
        {next ? (
          <>
            <p>
              Week {next.week.number}, {next.day.label}: {next.lesson.title}
            </p>
            <p className="next-up-meta">
              {next.lesson.subject} · {next.lesson.minutes} min · {statusLabel(next.status)}
            </p>
            <button className="primary" onClick={() => setView("plan")}>
              Open this lesson
            </button>
          </>
        ) : (
          <p>
            Every sample lesson is marked complete or skipped in this browser. Open the plan to review or change a
            status. This is still fictional demo data only.
          </p>
        )}
      </section>
      <section className="next">
        <span className="eyebrow">Explore the prototype</span>
        <h2>Three parts of the proposed experience.</h2>
        <div className="cards">
          <button onClick={() => setView("plan")}>
            <em>01</em>
            <h3>Use the learning plan</h3>
            <p>Move between eight weeks and distinct weekdays, then open a lesson.</p>
            <strong>Open sample plan</strong>
          </button>
          <button onClick={() => setView("intake")}>
            <em>02</em>
            <h3>Review sample intake</h3>
            <p>See structured planning context and guardian-consent handling.</p>
            <strong>Open sample profile</strong>
          </button>
          <button onClick={() => setView("educator")}>
            <em>03</em>
            <h3>Educator workflow</h3>
            <p>Exercise role-checked case transitions, internal review, publishing, clarification, and audit history.</p>
            <strong>Open educator demo</strong>
          </button>
        </div>
      </section>
    </>
  );
}

function Plan({ plan, activity, saveActivity }) {
  const next = findNextLesson(plan, activity);
  const [weekIndex, setWeekIndex] = useState(() => Math.max(0, plan.weeks.findIndex((week) => week.id === next?.week.id)));
  const [dayIndex, setDayIndex] = useState(() => {
    const week = plan.weeks.find((item) => item.id === next?.week.id) ?? plan.weeks[0];
    return Math.max(0, week.days.findIndex((day) => day.id === next?.day.id));
  });
  const [selectedLessonId, setSelectedLessonId] = useState(next?.lesson.id ?? null);
  const [scheduleReason, setScheduleReason] = useState("illness");
  const [scheduledFor, setScheduledFor] = useState("");
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [scheduleFailed, setScheduleFailed] = useState(false);
  const [statusToast, setStatusToast] = useState("");
  const lessonHeadingRef = useRef(null);
  const week = plan.weeks[weekIndex];
  const day = week.days[dayIndex];
  const lesson = day.lessons.find((item) => item.id === selectedLessonId) ?? day.lessons[0];
  const status = getLessonStatus(activity, lesson.id);
  const weekDone = week.days.flatMap((item) => item.lessons).filter((item) => getLessonStatus(activity, item.id) === "completed").length;
  const weekTotal = week.days.flatMap((item) => item.lessons).length;
  const dayPanelId = `plan-day-panel-${day.id}`;
  const setStatus = (nextStatus) => {
    saveActivity(updateLessonActivity(activity, lesson.id, nextStatus, activity[lesson.id]?.note ?? ""));
    const labels = { in_progress: "started", paused: "paused", completed: "completed", skipped: "skipped" };
    setStatusToast(`Lesson ${labels[nextStatus]} and saved to this browser.`);
    setTimeout(() => setStatusToast(""), 3000);
  };
  const setNote = (note) => saveActivity(updateLessonActivity(activity, lesson.id, status, note));
  const reschedule = () => {
    try {
      saveActivity(updateLessonSchedule(activity, lesson.id, scheduleReason, scheduledFor));
      setScheduleFailed(false);
      setScheduleMessage(`Moved to ${scheduledFor}. Existing progress and notes were preserved.`);
    } catch (error) {
      setScheduleFailed(true);
      setScheduleMessage(error.message);
    }
  };
  const jumpToNext = () => {
    if (!next) return;
    const nextWeek = plan.weeks.findIndex((item) => item.id === next.week.id);
    const nextDay = plan.weeks[nextWeek].days.findIndex((item) => item.id === next.day.id);
    setWeekIndex(nextWeek);
    setDayIndex(nextDay);
    setSelectedLessonId(next.lesson.id);
    requestAnimationFrame(() => lessonHeadingRef.current?.focus());
  };
  return (
    <>
      <Header
        eyebrow="BritePath Essentials · Sample 8-week plan"
        title={plan.title}
        action={
          <button className="primary" onClick={() => window.print()}>
            Print sample week
          </button>
        }
      />
      {next && next.lesson.id !== lesson.id ? (
        <section className="next-up compact" aria-labelledby="plan-next-heading">
          <div>
            <span className="eyebrow">Do this next</span>
            <h2 id="plan-next-heading">{next.lesson.title}</h2>
            <p>
              Week {next.week.number} · {next.day.label} · {statusLabel(next.status)}
            </p>
          </div>
          <button className="primary" onClick={jumpToNext}>
            Jump to next lesson
          </button>
        </section>
      ) : null}
      <div className="plan">
        <aside className="weeks">
          <span className="eyebrow">Plan outline</span>
          {plan.weeks.map((item, i) => (
            <button
              key={item.id}
              className={weekIndex === i ? "active" : ""}
              aria-pressed={weekIndex === i}
              onClick={() => {
                setWeekIndex(i);
                setDayIndex(0);
                setSelectedLessonId(null);
              }}
            >
              <small>Week {item.number}</small>
              <strong>{item.theme}</strong>
              <em>Sample</em>
            </button>
          ))}
        </aside>
        <section className="schedule">
          <header>
            <div>
              <span className="eyebrow">Week {week.number}</span>
              <h2>{week.theme}</h2>
              <p>{plan.grade} · Fictional curriculum content for interaction testing</p>
            </div>
            <div className="count">
              <strong>
                {weekDone}/{weekTotal}
              </strong>
              <small>week blocks done</small>
            </div>
          </header>
          <div className="days" role="tablist" aria-label={`Week ${week.number} days`}>
            {week.days.map((item, i) => (
              <button
                role="tab"
                id={`plan-day-tab-${item.id}`}
                aria-controls={dayPanelId}
                aria-selected={dayIndex === i}
                tabIndex={dayIndex === i ? 0 : -1}
                className={dayIndex === i ? "active" : ""}
                onClick={() => {
                  setDayIndex(i);
                  setSelectedLessonId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 1 : -1;
                  const nextIndex = (i + delta + week.days.length) % week.days.length;
                  setDayIndex(nextIndex);
                  setSelectedLessonId(null);
                }}
                key={item.id}
              >
                {DAYS[i].slice(0, 3)}
                <strong>{item.dateLabel.replace("Day ", "")}</strong>
              </button>
            ))}
          </div>
          <div className="lesson-workspace" id={dayPanelId} role="tabpanel" aria-labelledby={`plan-day-tab-${day.id}`}>
            <div className="lessons" aria-label={`${day.label} lessons`}>
              {day.lessons.map((item, i) => {
                const itemStatus = getLessonStatus(activity, item.id);
                return (
                  <button
                    className={lesson.id === item.id ? "selected" : ""}
                    aria-pressed={lesson.id === item.id}
                    onClick={() => setSelectedLessonId(item.id)}
                    key={item.id}
                  >
                    <time>{item.time}</time>
                    <i className={`tone t${i}`} aria-hidden="true" />
                    <span>
                      <small>{item.subject}</small>
                      <strong>{item.title}</strong>
                      {activity[item.id]?.scheduledFor && <small>Moved to {activity[item.id].scheduledFor}</small>}
                    </span>
                    <StatusLabel status={itemStatus} />
                  </button>
                );
              })}
            </div>
            <section className="lesson-detail" aria-labelledby="selected-lesson-heading">
              <div>
                <span className="eyebrow">
                  {day.label} · {lesson.minutes} min
                </span>
                <h3 id="selected-lesson-heading" ref={lessonHeadingRef} tabIndex={-1}>
                  {lesson.title}
                </h3>
                <StatusLabel status={status} />
              </div>
              <p>
                <strong>Objective:</strong> {lesson.objective}
              </p>
              <h4>Instructions</h4>
              <ol>
                {lesson.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <h4>Materials</h4>
              <ul className="materials-list">
                {lesson.materials.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p>
                <strong>Adult help:</strong> {lesson.adultHelp}
              </p>
              <p>
                <strong>Built-in support:</strong> {lesson.accommodation}
              </p>
              <div className="status-actions" aria-label="Update lesson status">
                {[
                  ["in_progress", "Start"],
                  ["paused", "Pause"],
                  ["completed", "Complete"],
                  ["skipped", "Skip"],
                ].map(([value, label]) => (
                  <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
                    {label}
                  </button>
                ))}
              </div>
              {statusToast ? (
                <div className="status-toast" role="status" aria-live="polite" aria-atomic="true">
                  {statusToast}
                </div>
              ) : null}
              <fieldset className="reschedule">
                <legend>Move this lesson</legend>
                <label htmlFor="demo-schedule-reason">
                  Reason
                  <select
                    id="demo-schedule-reason"
                    value={scheduleReason}
                    onChange={(event) => setScheduleReason(event.target.value)}
                  >
                    <option value="illness">Illness</option>
                    <option value="travel">Travel</option>
                    <option value="caregiver_schedule">Caregiver schedule</option>
                    <option value="catch_up">Catch-up day</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label htmlFor="demo-schedule-date">
                  New date
                  <input
                    id="demo-schedule-date"
                    type="date"
                    value={scheduledFor}
                    aria-invalid={scheduleFailed || undefined}
                    aria-describedby="demo-schedule-message"
                    onChange={(event) => setScheduledFor(event.target.value)}
                  />
                </label>
                <button type="button" onClick={reschedule}>
                  Move lesson
                </button>
                <span
                  id="demo-schedule-message"
                  role={scheduleFailed ? "alert" : "status"}
                  aria-live="polite"
                >
                  {scheduleMessage}
                </span>
              </fieldset>
              <label className="note-field" htmlFor="demo-caregiver-note">
                Private demo note
                <textarea
                  id="demo-caregiver-note"
                  value={activity[lesson.id]?.note ?? ""}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Add a caregiver note saved on this device"
                />
              </label>
              <span className="save-hint" role="status" aria-live="polite">
                Changes are stored in this browser demo only.
              </span>
            </section>
          </div>
        </section>
      </div>
    </>
  );
}

function Intake({ profile, saveProfile }) {
  const formId = useId();
  const [draft, setDraft] = useState(profile);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("idle");
  const summaryRef = useRef(null);
  const gradeRef = useRef(null);
  const jurisdictionRef = useRef(null);
  const interestsRef = useRef(null);
  const goalsRef = useRef(null);
  const consentRef = useRef(null);
  const fieldRefs = {
    grade: gradeRef,
    jurisdiction: jurisdictionRef,
    interests: interestsRef,
    goals: goalsRef,
    guardianConsent: consentRef,
  };
  const field = (name) => (event) =>
    setDraft({ ...draft, [name]: event.target.type === "checkbox" ? event.target.checked : event.target.value });
  const describedBy = (name) => (errors[name] ? `${formId}-${name}-error` : undefined);
  const submit = (event) => {
    event.preventDefault();
    const nextErrors = validateProfile(draft);
    setErrors(nextErrors);
    const invalidKeys = Object.keys(nextErrors);
    if (invalidKeys.length) {
      setMessageTone("error");
      setMessage(`Review ${invalidKeys.length} highlighted field${invalidKeys.length === 1 ? "" : "s"}. Nothing was saved.`);
      requestAnimationFrame(() => {
        const first = fieldRefs[invalidKeys[0]]?.current;
        if (first) first.focus();
        else summaryRef.current?.focus();
      });
      return;
    }
    saveProfile(draft);
    setMessageTone("success");
    setMessage("Sample profile saved on this device. It was not submitted to BriteLink.");
  };
  return (
    <>
      <Header
        eyebrow="Sample learner profile"
        title="Planning context for Riley."
        action={<span className="complete">Demo intake · Not submitted</span>}
      />
      <div className="form-shell">
        <aside>
          <span>Guided sample</span>
          <h2>Structured planning context</h2>
          <p>
            A real intake should collect only what the educator needs, explain its use, and require guardian consent
            before submission.
          </p>
          <ol className="intake-guide">
            <li>Learning context</li>
            <li>Household setup</li>
            <li>Consent</li>
          </ol>
        </aside>
        <form onSubmit={submit} noValidate aria-describedby={`${formId}-status`}>
          {messageTone === "error" ? (
            <div
              className="form-error-summary"
              role="alert"
              tabIndex={-1}
              ref={summaryRef}
              aria-labelledby={`${formId}-error-heading`}
            >
              <strong id={`${formId}-error-heading`}>Fix these fields before saving</strong>
              <ul>
                {Object.entries(errors).map(([name, text]) => (
                  <li key={name}>
                    <a
                      href={`#${formId}-${name}`}
                      onClick={(event) => {
                        event.preventDefault();
                        fieldRefs[name]?.current?.focus();
                      }}
                    >
                      {text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <fieldset className="intake-group">
            <legend>1. Learning context</legend>
            <div className="form-row">
              <label htmlFor={`${formId}-grade`}>
                Grade level
                <select
                  id={`${formId}-grade`}
                  ref={fieldRefs.grade}
                  value={draft.grade}
                  onChange={field("grade")}
                  aria-invalid={Boolean(errors.grade) || undefined}
                  aria-describedby={describedBy("grade")}
                  required
                >
                  <option value="">Choose grade</option>
                  <option>Grade 3</option>
                  <option>Grade 4</option>
                  <option>Grade 5</option>
                </select>
                {errors.grade ? (
                  <small id={`${formId}-grade-error`} className="error">
                    {errors.grade}
                  </small>
                ) : null}
              </label>
              <label htmlFor={`${formId}-jurisdiction`}>
                Curriculum jurisdiction
                <select
                  id={`${formId}-jurisdiction`}
                  ref={fieldRefs.jurisdiction}
                  value={draft.jurisdiction}
                  onChange={field("jurisdiction")}
                  aria-invalid={Boolean(errors.jurisdiction) || undefined}
                  aria-describedby={describedBy("jurisdiction")}
                  required
                >
                  <option value="">Choose jurisdiction</option>
                  <option>Ontario</option>
                  <option>Other / clarify with educator</option>
                </select>
                {errors.jurisdiction ? (
                  <small id={`${formId}-jurisdiction-error`} className="error">
                    {errors.jurisdiction}
                  </small>
                ) : null}
              </label>
            </div>
            <label htmlFor={`${formId}-interests`}>
              Learner interests
              <textarea
                id={`${formId}-interests`}
                ref={fieldRefs.interests}
                value={draft.interests}
                onChange={field("interests")}
                aria-invalid={Boolean(errors.interests) || undefined}
                aria-describedby={describedBy("interests")}
                required
              />
              {errors.interests ? (
                <small id={`${formId}-interests-error`} className="error">
                  {errors.interests}
                </small>
              ) : null}
            </label>
            <label htmlFor={`${formId}-goals`}>
              Term goals
              <textarea
                id={`${formId}-goals`}
                ref={fieldRefs.goals}
                value={draft.goals}
                onChange={field("goals")}
                aria-invalid={Boolean(errors.goals) || undefined}
                aria-describedby={describedBy("goals")}
                required
              />
              {errors.goals ? (
                <small id={`${formId}-goals-error`} className="error">
                  {errors.goals}
                </small>
              ) : null}
            </label>
          </fieldset>
          <fieldset className="intake-group">
            <legend>2. Household setup</legend>
            <div className="form-row">
              <label htmlFor={`${formId}-language`}>
                Learning language
                <input id={`${formId}-language`} value={draft.language} onChange={field("language")} />
              </label>
              <label htmlFor={`${formId}-device`}>
                Device and printing access
                <input id={`${formId}-device`} value={draft.deviceAccess} onChange={field("deviceAccess")} />
              </label>
            </div>
            <label htmlFor={`${formId}-availability`}>
              Caregiver availability
              <input
                id={`${formId}-availability`}
                value={draft.caregiverAvailability}
                onChange={field("caregiverAvailability")}
              />
            </label>
          </fieldset>
          <section className="consent-copy" aria-labelledby={`${formId}-consent-heading`}>
            <h3 id={`${formId}-consent-heading`}>3. Guardian notice for this prototype</h3>
            <p>
              This browser-only demo must not contain real child, health, diagnosis, IEP, address, or school information.
              A production intake will need approved privacy notice, retention, correction, export and deletion controls.
            </p>
            <label htmlFor={`${formId}-guardianConsent`}>
              <input
                id={`${formId}-guardianConsent`}
                ref={fieldRefs.guardianConsent}
                type="checkbox"
                checked={draft.guardianConsent}
                onChange={field("guardianConsent")}
                aria-invalid={Boolean(errors.guardianConsent) || undefined}
                aria-describedby={describedBy("guardianConsent")}
                required
              />{" "}
              I understand this is fictional demo data stored only on this device.
            </label>
            {errors.guardianConsent ? (
              <small id={`${formId}-guardianConsent-error`} className="error">
                {errors.guardianConsent}
              </small>
            ) : null}
          </section>
          <footer>
            <span
              id={`${formId}-status`}
              role={messageTone === "error" ? "alert" : "status"}
              aria-live="polite"
              aria-atomic="true"
            >
              {message || "Sample changes are not sent anywhere."}
            </span>
            <button className="primary">Validate and save demo</button>
          </footer>
        </form>
      </div>
    </>
  );
}

const STAFF_ACTOR = { id: "educator-a" };
const DEFAULT_REVIEW = { curriculum: false, safeguarding: false, accessibility: false, resourceRights: false };

function EducatorDemo({ repository }) {
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState(DEFAULT_REVIEW);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeFailed, setNoticeFailed] = useState(false);
  const actionRef = useRef(null);
  const serviceCase = repository.getCase(STAFF_ACTOR, "case-a");
  const nextStates = CASE_TRANSITIONS[serviceCase.status] ?? [];
  const preferredNext = nextStates[0] ?? null;
  const announce = (text, failed = false) => {
    setNoticeFailed(failed);
    setNotice(text);
  };
  const advance = (status) => {
    try {
      repository.transitionCase(STAFF_ACTOR, "case-a", status);
      announce(`Case moved to ${status.replaceAll("_", " ")}.`);
      setRevision(revision + 1);
      requestAnimationFrame(() => actionRef.current?.focus());
    } catch (error) {
      announce(error.message, true);
    }
  };
  const saveReview = () => {
    try {
      const result = repository.savePlanReview(STAFF_ACTOR, "case-a", review, "Demo checklist");
      announce(
        result.approvedAt
          ? "Internal review approved. Publishing is now available."
          : "Complete every check before publishing.",
        !result.approvedAt,
      );
      setRevision(revision + 1);
    } catch (error) {
      announce(error.message, true);
    }
  };
  const send = () => {
    try {
      repository.sendMessage(STAFF_ACTOR, "case-a", message, "clarification");
      setMessage("");
      announce("Demo clarification saved to this in-memory case.");
      setRevision(revision + 1);
    } catch (error) {
      announce(error.message, true);
    }
  };
  const messages = repository.listMessages(STAFF_ACTOR, "case-a");
  return (
    <>
      <Header
        eyebrow="Fictional staff workspace"
        title="Educator case operations"
        action={<span className="complete">In-memory demo · Resets on reload</span>}
      />
      <section className="staff-focus" aria-labelledby="staff-focus-heading">
        <div>
          <span className="eyebrow">Current case</span>
          <h2 id="staff-focus-heading" ref={actionRef} tabIndex={-1}>
            Riley Morgan · BL-DEMO-001
          </h2>
          <p>BritePath Complete · fictional Grade 4 intake</p>
        </div>
        <div className="staff-focus-status">
          <span className={`queue-priority ${serviceCase.status}`}>{staffPriorityLabel(serviceCase.status)}</span>
          <span className="case-status">{serviceCase.status.replaceAll("_", " ")}</span>
        </div>
        <div className="staff-next-panel">
          <p className="staff-next-copy">{staffNextAction(serviceCase.status)}</p>
          {preferredNext ? (
            <button className="primary" type="button" onClick={() => advance(preferredNext)}>
              Next action: {preferredNext.replaceAll("_", " ")}
            </button>
          ) : (
            <p className="empty" role="status">
              No further demo transitions are available from this state.
            </p>
          )}
        </div>
      </section>
      <div className="ops-grid">
        <section className="case-card" aria-labelledby="case-move-heading">
          <div className="case-top">
            <div>
              <span className="eyebrow">Allowed next states</span>
              <h2 id="case-move-heading">Move this case</h2>
              <p>Transitions are role-checked and audited by the demo service layer. This is not a live queue.</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Package scope</dt>
              <dd>16 weeks · one included revision</dd>
            </div>
            <div>
              <dt>SLA</dt>
              <dd>Not started until usable intake</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>Keisa A. · demo educator</dd>
            </div>
          </dl>
          <div className="transition-actions" aria-label="Other allowed transitions">
            {nextStates.length ? (
              nextStates.map((status) => (
                <button
                  key={status}
                  className={status === preferredNext ? "primary" : undefined}
                  aria-current={status === preferredNext ? "step" : undefined}
                  onClick={() => advance(status)}
                >
                  {status.replaceAll("_", " ")}
                </button>
              ))
            ) : (
              <p className="empty">No further demo transitions are available from this state.</p>
            )}
          </div>
          <span
            className="save-hint"
            role={noticeFailed ? "alert" : "status"}
            aria-live="polite"
            aria-atomic="true"
          >
            {notice || "Choose one allowed next state. History stays on this page until you reload."}
          </span>
        </section>
        <section className="review-card" aria-labelledby="review-heading">
          <span className="eyebrow">Publish quality gate</span>
          <h2 id="review-heading">Internal review checklist</h2>
          <p>A plan cannot be published until all four checks have an approved review record.</p>
          {Object.entries({
            curriculum: "Curriculum mapping",
            safeguarding: "Safeguarding",
            accessibility: "Accessibility",
            resourceRights: "Resource rights",
          }).map(([key, label]) => (
            <label key={key} htmlFor={`demo-review-${key}`}>
              <input
                id={`demo-review-${key}`}
                type="checkbox"
                checked={review[key]}
                onChange={(event) => setReview({ ...review, [key]: event.target.checked })}
              />{" "}
              {label}
            </label>
          ))}
          <button className="primary" onClick={saveReview}>
            Save review
          </button>
        </section>
        <section className="message-card" aria-labelledby="message-heading">
          <span className="eyebrow">Case clarification</span>
          <h2 id="message-heading">Secure case thread</h2>
          <div className="thread" aria-live="polite">
            {messages.length ? (
              messages.map((item) => (
                <p key={item.id}>
                  <strong>{item.senderId === STAFF_ACTOR.id ? "Educator" : "Guardian"}</strong>
                  {item.body}
                </p>
              ))
            ) : (
              <p className="empty">No messages yet. Use this thread for a focused intake clarification.</p>
            )}
          </div>
          <label htmlFor="demo-staff-message">
            Message
            <textarea
              id="demo-staff-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask a focused intake clarification"
            />
          </label>
          <button className="primary" onClick={send}>
            Save demo message
          </button>
        </section>
        <section className="audit-card" aria-labelledby="audit-heading">
          <span className="eyebrow">Audit trail</span>
          <h2 id="audit-heading">Recent case events</h2>
          <ol>
            {repository.data.audits
              .filter((item) => item.householdId === "house-a")
              .slice(-8)
              .reverse()
              .map((item) => (
                <li key={item.id}>
                  <strong>{item.eventType}</strong>
                  <span>{item.createdAt}</span>
                </li>
              ))}
          </ol>
        </section>
      </div>
    </>
  );
}

export function App() {
  const [view, setView] = useState("home");
  const plan = useMemo(() => createDemoPlan(), []);
  const repository = useMemo(() => new InMemoryBriteLinkRepository(createServiceSeed()), []);
  const [activity, saveActivity] = useDeviceState(STORAGE_KEYS.activity, {});
  const [profile, saveProfile] = useDeviceState(STORAGE_KEYS.profile, DEMO_PROFILE);
  useEffect(() => {
    document.title = `BriteLink demo · ${VIEW_TITLES[view] ?? "Workspace"}`;
  }, [view]);
  return (
    <div className="shell">
      <SkipLink />
      <Sidebar view={view} setView={setView} />
      <main id="workspace-main" aria-label={VIEW_TITLES[view] ?? "Workspace"}>
        <DemoBanner />
        {view === "home" && <Overview setView={setView} plan={plan} activity={activity} />}
        {view === "plan" && <Plan plan={plan} activity={activity} saveActivity={saveActivity} />}
        {view === "intake" && <Intake profile={profile} saveProfile={saveProfile} />}
        {view === "educator" && <EducatorDemo repository={repository} />}
      </main>
    </div>
  );
}
