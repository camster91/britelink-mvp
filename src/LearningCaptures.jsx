import { useCallback, useEffect, useId, useRef, useState } from "react";
import { INTAKE_SUBJECTS } from "./input-validation.js";
import { classifyOperationError } from "./operation-state.js";

// Learning outside the plan (#44): books, outings, co-ops, tutors, anything the family did that the
// plan did not prescribe. Text only; photos wait for the scanned attachment path and counsel review.
export const CAPTURE_KIND_LABELS = {
  book: "Book or reading",
  outing: "Outing or field trip",
  activity: "Hands-on activity",
  co_op: "Co-op or group class",
  tutor: "Tutor or lesson",
  note: "Something else",
};

const emptyDraft = (today) => ({ capturedOn: today, kind: "", subjects: [], note: "" });

export function LearningCaptures({ repository, householdId, learner, today, onChange }) {
  const formId = useId();
  const [state, setState] = useState({ status: "loading", items: [], error: null });
  const [draft, setDraft] = useState(() => emptyDraft(today));
  const [invalid, setInvalid] = useState([]);
  const [operation, setOperation] = useState({ status: "idle", message: "" });
  const kindRef = useRef(null);
  const noteRef = useRef(null);
  const request = useRef(0);

  const publish = useCallback(
    (items) => {
      setState({ status: "success", items, error: null });
      onChange?.(items);
    },
    [onChange],
  );
  const load = useCallback(async () => {
    const current = ++request.current;
    setState((value) => ({ ...value, status: "loading", error: null }));
    try {
      const items = await repository.listLearningCaptures(householdId, learner.id);
      if (current === request.current) publish(items ?? []);
    } catch (error) {
      if (current === request.current) setState({ status: "error", items: [], error: error.message });
    }
  }, [householdId, learner.id, publish, repository]);
  useEffect(() => {
    setDraft(emptyDraft(today));
    setInvalid([]);
    setOperation({ status: "idle", message: "" });
    load();
  }, [load, today]);

  const save = async (event) => {
    event.preventDefault();
    const missing = [];
    if (!draft.kind) missing.push("kind");
    if (!draft.note.trim()) missing.push("note");
    setInvalid(missing);
    if (missing.length) {
      setOperation({
        status: "error",
        message: `Add ${missing.map((item) => (item === "kind" ? "what kind of learning it was" : "a short note about what happened")).join(" and ")}.`,
      });
      (missing[0] === "kind" ? kindRef : noteRef).current?.focus();
      return;
    }
    setOperation({ status: "loading", message: "Saving…" });
    try {
      await repository.recordLearningCapture({ householdId, learnerId: learner.id, ...draft });
      setDraft(emptyDraft(today));
      await load();
      setOperation({ status: "success", message: `Saved to ${learner.preferred_name}’s learning record.` });
    } catch (error) {
      const status = classifyOperationError(error);
      setOperation({
        status: "error",
        message: status === "offline" ? "Not saved: you appear to be offline." : error.message,
      });
    }
  };
  const remove = async (item) => {
    setOperation({ status: "loading", message: "Removing…" });
    try {
      await repository.removeLearningCapture({ householdId, captureId: item.id });
      await load();
      setOperation({ status: "success", message: "Removed from the learning record." });
    } catch (error) {
      setOperation({ status: "error", message: error.message });
    }
  };

  const errorId = `${formId}-error`;
  return (
    <section className="learning-captures" aria-labelledby={`${formId}-heading`}>
      <header>
        <span className="eyebrow">Learning outside the plan</span>
        <h2 id={`${formId}-heading`}>What else did {learner.preferred_name} learn?</h2>
        <p>
          A book, an outing, a co-op class, a tutor. It all counts, and it all
          goes in the record. Keep it practical: no health or diagnosis details.
        </p>
      </header>
      <form onSubmit={save} noValidate>
        {operation.status === "error" ? (
          <p role="alert" id={errorId} className="form-error-summary">
            {operation.message}
          </p>
        ) : null}
        <div className="capture-row">
          <label>
            When
            <input
              type="date"
              value={draft.capturedOn}
              max={today}
              onChange={(event) => setDraft((value) => ({ ...value, capturedOn: event.target.value }))}
            />
          </label>
          <label>
            What kind
            <select
              ref={kindRef}
              value={draft.kind}
              aria-invalid={invalid.includes("kind") || undefined}
              aria-describedby={invalid.includes("kind") ? errorId : undefined}
              onChange={(event) => setDraft((value) => ({ ...value, kind: event.target.value }))}
            >
              <option value="">Select one</option>
              {Object.entries(CAPTURE_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="capture-subjects">
          <legend>
            Subjects <span>(optional)</span>
          </legend>
          {INTAKE_SUBJECTS.map((subject) => (
            <label key={subject}>
              <input
                type="checkbox"
                checked={draft.subjects.includes(subject)}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    subjects: event.target.checked
                      ? [...value.subjects, subject]
                      : value.subjects.filter((item) => item !== subject),
                  }))
                }
              />
              {subject}
            </label>
          ))}
        </fieldset>
        <label>
          What happened
          <textarea
            ref={noteRef}
            maxLength={1000}
            value={draft.note}
            aria-invalid={invalid.includes("note") || undefined}
            aria-describedby={invalid.includes("note") ? errorId : undefined}
            onChange={(event) => setDraft((value) => ({ ...value, note: event.target.value }))}
          />
        </label>
        <button className="primary" disabled={operation.status === "loading"}>
          Save to the record
        </button>
        {operation.status === "success" || operation.status === "loading" ? (
          <p role="status" className="capture-status">
            {operation.message}
          </p>
        ) : null}
      </form>
      {state.status === "error" ? (
        <div className="plan-state">
          <p role="alert">{state.error}</p>
          <button type="button" className="ghost" onClick={load}>
            Try again
          </button>
        </div>
      ) : state.items.length ? (
        <ul className="capture-list" aria-label="Recent learning notes">
          {state.items.slice(0, 10).map((item) => (
            <li key={item.id}>
              <div>
                <strong>
                  {item.captured_on} · {CAPTURE_KIND_LABELS[item.kind] ?? item.kind}
                </strong>
                {item.subjects?.length ? <small>{item.subjects.join(", ")}</small> : null}
                <p>{item.note}</p>
              </div>
              <button
                type="button"
                className="ghost"
                aria-label={`Remove the note from ${item.captured_on}`}
                onClick={() => remove(item)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : state.status === "success" ? (
        <p className="capture-empty">Nothing recorded yet.</p>
      ) : null}
    </section>
  );
}
