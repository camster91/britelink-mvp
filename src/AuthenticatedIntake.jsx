import { useCallback, useEffect, useId, useState } from "react";
import { INTAKE_SUBJECTS } from "./input-validation.js";
import { classifyOperationError } from "./operation-state.js";

const EMPTY = {
  subjects: [],
  priorAttainment: "",
  strengthsInterests: "",
  goals: "",
  learningSupports: "",
  language: "",
  weeklySchedule: "",
  caregiverAvailability: "",
  deviceAccess: "",
  resourceBudget: "",
  contentConstraints: "",
  accessibilityNeeds: "",
  guardianConsent: false,
};
function draftFromProfile(profile) {
  return {
    ...EMPTY,
    ...(profile?.planning_context ?? {}),
    subjects: profile?.planning_context?.subjects ?? [],
    guardianConsent: false,
  };
}

export function AuthenticatedIntake({
  householdId,
  learner,
  repository,
  privacyNoticeVersion,
  onSubmitted,
}) {
  const formId = useId();
  const [state, setState] = useState({
    status: "loading",
    profile: null,
    error: null,
  });
  const [draft, setDraft] = useState(EMPTY);
  const [operation, setOperation] = useState({
    status: "idle",
    message: "",
    canRetry: false,
  });
  const load = useCallback(async () => {
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    try {
      const profile = await repository.loadLatestProfile(
        householdId,
        learner.id,
      );
      setState({ status: "success", profile, error: null });
      setDraft(draftFromProfile(profile));
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: "error",
        error: error.message,
      }));
    }
  }, [householdId, learner.id, repository]);
  useEffect(() => {
    load();
  }, [load]);
  const field = (name) => (event) =>
    setDraft((value) => ({
      ...value,
      [name]:
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value,
    }));
  const subject = (subjectName) => (event) =>
    setDraft((value) => ({
      ...value,
      subjects: event.target.checked
        ? [...new Set([...value.subjects, subjectName])]
        : value.subjects.filter((item) => item !== subjectName),
    }));
  const submit = async (event) => {
    event.preventDefault();
    setOperation({
      status: "loading",
      message: "Submitting a new intake version…",
      canRetry: false,
    });
    try {
      const result = await repository.submitGuardianIntake({
        householdId,
        learnerId: learner.id,
        noticeVersion: privacyNoticeVersion,
        guardianConsent: draft.guardianConsent,
        ...draft,
      });
      await load();
      onSubmitted?.();
      setOperation({
        status: "success",
        message: `Intake version ${result?.profile_version ?? "new"} submitted with consent record ${privacyNoticeVersion}.`,
        canRetry: false,
      });
    } catch (error) {
      const status = classifyOperationError(error);
      setOperation({
        status,
        message:
          status === "offline"
            ? "The intake was not submitted because you are offline."
            : status === "session_expired"
              ? "Your session expired. Sign in again before submitting."
              : status === "conflict"
                ? "Another intake version was saved first. Reload and review it before submitting."
                : error.message,
        canRetry: status === "offline" || status === "error",
      });
    }
  };
  if (!privacyNoticeVersion)
    return (
      <section className="live-intake locked" aria-labelledby="intake-heading">
        <span className="eyebrow">Guardian intake</span>
        <h2 id="intake-heading">Planning intake is not available yet</h2>
        <p>
          BriteLink must configure the qualified-counsel-reviewed privacy notice
          and retention terms before this form can accept learner information.
          Invited sign-in still cannot collect family data until that notice
          version is set.
        </p>
      </section>
    );
  const failed = ["offline", "conflict", "session_expired", "error"].includes(
    operation.status,
  );
  return (
    <section className="live-intake" aria-labelledby="intake-heading">
      <header>
        <div>
          <span className="eyebrow">Guardian intake</span>
          <h2 id="intake-heading">
            Planning context for {learner.preferred_name}
          </h2>
        </div>
        {state.profile ? (
          <span className="case-status">
            Current version {state.profile.version}
          </span>
        ) : null}
      </header>
      {state.status === "loading" ? (
        <p className="plan-state" role="status">
          Loading the latest submitted intake…
        </p>
      ) : state.status === "error" ? (
        <div className="plan-state">
          <p role="alert">{state.error}</p>
          <button className="ghost" onClick={load}>
            Try again
          </button>
        </div>
      ) : (
        <form onSubmit={submit} aria-describedby={`${formId}-status`}>
          <p className="intake-guidance">
            Share practical learning context only. Do not include a diagnosis,
            IEP, school name, address, health card, or unnecessary medical
            details. Submitting creates a new immutable version; it never
            overwrites prior records.
          </p>
          <ol className="intake-progress" aria-label="Intake steps">
            <li>Learning context</li>
            <li>Household setup</li>
            <li>Consent</li>
          </ol>
          <fieldset className="intake-subjects">
            <legend>1. Subjects to prioritize</legend>
            {INTAKE_SUBJECTS.map((item) => (
              <label key={item} htmlFor={`${formId}-subject-${item}`}>
                <input
                  id={`${formId}-subject-${item}`}
                  type="checkbox"
                  checked={draft.subjects.includes(item)}
                  onChange={subject(item)}
                />{" "}
                {item}
              </label>
            ))}
          </fieldset>
          <div className="intake-fields">
            <label htmlFor={`${formId}-prior`}>
              Current learning starting point
              <textarea
                id={`${formId}-prior`}
                required
                maxLength="1000"
                value={draft.priorAttainment}
                onChange={field("priorAttainment")}
              />
            </label>
            <label htmlFor={`${formId}-strengths`}>
              Strengths and interests
              <textarea
                id={`${formId}-strengths`}
                required
                maxLength="1000"
                value={draft.strengthsInterests}
                onChange={field("strengthsInterests")}
              />
            </label>
            <label htmlFor={`${formId}-goals`}>
              Goals for this plan
              <textarea
                id={`${formId}-goals`}
                required
                maxLength="1000"
                value={draft.goals}
                onChange={field("goals")}
              />
            </label>
            <label htmlFor={`${formId}-supports`}>
              Helpful learning supports <span>(optional)</span>
              <textarea
                id={`${formId}-supports`}
                maxLength="1000"
                value={draft.learningSupports}
                onChange={field("learningSupports")}
              />
            </label>
          </div>
          <fieldset className="intake-group">
            <legend>2. Household setup</legend>
            <div className="intake-fields">
              <label htmlFor={`${formId}-language`}>
                Learning language
                <input
                  id={`${formId}-language`}
                  required
                  maxLength="120"
                  value={draft.language}
                  onChange={field("language")}
                />
              </label>
              <label htmlFor={`${formId}-schedule`}>
                Typical weekly learning schedule
                <textarea
                  id={`${formId}-schedule`}
                  required
                  maxLength="500"
                  value={draft.weeklySchedule}
                  onChange={field("weeklySchedule")}
                />
              </label>
              <label htmlFor={`${formId}-availability`}>
                Caregiver availability
                <textarea
                  id={`${formId}-availability`}
                  required
                  maxLength="500"
                  value={draft.caregiverAvailability}
                  onChange={field("caregiverAvailability")}
                />
              </label>
              <label htmlFor={`${formId}-device`}>
                Device and printer access
                <select
                  id={`${formId}-device`}
                  required
                  value={draft.deviceAccess}
                  onChange={field("deviceAccess")}
                >
                  <option value="">Choose one</option>
                  <option value="computer_printer">Computer and printer</option>
                  <option value="computer_no_printer">
                    Computer, no printer
                  </option>
                  <option value="tablet">Tablet or phone only</option>
                  <option value="limited">Limited device access</option>
                </select>
              </label>
              <label htmlFor={`${formId}-budget`}>
                Optional resource budget
                <select
                  id={`${formId}-budget`}
                  required
                  value={draft.resourceBudget}
                  onChange={field("resourceBudget")}
                >
                  <option value="">Choose one</option>
                  <option value="free_only">Free resources only</option>
                  <option value="up_to_25">Up to $25 CAD</option>
                  <option value="up_to_50">Up to $50 CAD</option>
                  <option value="discuss">
                    Discuss before recommending costs
                  </option>
                </select>
              </label>
              <label htmlFor={`${formId}-constraints`}>
                Content constraints <span>(optional)</span>
                <textarea
                  id={`${formId}-constraints`}
                  maxLength="1000"
                  value={draft.contentConstraints}
                  onChange={field("contentConstraints")}
                />
              </label>
              <label htmlFor={`${formId}-a11y`}>
                Accessibility needs <span>(optional)</span>
                <textarea
                  id={`${formId}-a11y`}
                  maxLength="1000"
                  value={draft.accessibilityNeeds}
                  onChange={field("accessibilityNeeds")}
                />
              </label>
            </div>
          </fieldset>
          <section className="live-consent">
            <h3>3. Guardian consent · notice {privacyNoticeVersion}</h3>
            <p>
              BriteLink will use this information to create, review, deliver,
              and support this learner’s personalized learning plan. It is
              available only to authorized household members and BriteLink staff
              who need it for this service. Correction, export, withdrawal,
              retention, and deletion requests follow the configured privacy
              process.
            </p>
            <label htmlFor={`${formId}-consent`}>
              <input
                id={`${formId}-consent`}
                type="checkbox"
                required
                checked={draft.guardianConsent}
                onChange={field("guardianConsent")}
              />{" "}
              I am this learner’s guardian, have read notice{" "}
              {privacyNoticeVersion}, and consent to this information being used
              for a personalized learning plan.
            </label>
          </section>
          <footer>
            <div
              id={`${formId}-status`}
              className={`live-operation ${failed ? "failure" : "success"}`}
              role={failed ? "alert" : "status"}
              aria-live="polite"
              aria-atomic="true"
            >
              {operation.message ||
                "Nothing is submitted until you confirm consent and use the button."}
              {operation.canRetry ? (
                <button
                  type="button"
                  onClick={() =>
                    submit({
                      preventDefault() {},
                    })
                  }
                >
                  Try again
                </button>
              ) : null}
            </div>
            <button className="primary" disabled={operation.status === "loading"}>
              Submit new intake version
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
