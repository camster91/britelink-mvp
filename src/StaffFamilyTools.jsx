import { useCallback, useEffect, useId, useRef, useState } from "react";
import { INTAKE_SUBJECTS } from "./input-validation.js";
import { recentMondays } from "./authenticated-workspace.js";

// Educator tools that sit beside the plan: the optional note for the week (#43, migration 048) and
// whole-family activities with a different outcome per child (#45, migration 049).

export function StaffWeeklyNote({ repository, householdId, learner, today }) {
  const id = useId();
  const weeks = recentMondays(today);
  const [week, setWeek] = useState(weeks[0]);
  const [notes, setNotes] = useState({ status: "loading", items: [], error: null });
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [operation, setOperation] = useState({ status: "idle", message: "" });
  const noteRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const items = await repository.listWeeklyNotes(householdId, learner.id);
      setNotes({ status: "success", items: items ?? [], error: null });
      return items ?? [];
    } catch (error) {
      setNotes({ status: "error", items: [], error: error.message });
      return [];
    }
  }, [householdId, learner.id, repository]);
  useEffect(() => {
    load();
  }, [load]);
  const existing = notes.items.find((item) => item.week_start === week) ?? null;
  useEffect(() => {
    setDraft(existing?.note ?? "");
    setInvalid(false);
  }, [existing?.note, week]);

  const save = async (event) => {
    event.preventDefault();
    if (!draft.trim()) {
      setInvalid(true);
      setOperation({ status: "error", message: "Write the note for the week before saving." });
      noteRef.current?.focus();
      return;
    }
    setInvalid(false);
    setOperation({ status: "loading", message: "Saving…" });
    try {
      await repository.setWeeklyNote({ householdId, learnerId: learner.id, weekStart: week, note: draft });
      await load();
      setOperation({ status: "success", message: `Saved. ${learner.preferred_name}’s family sees it in the week’s story.` });
    } catch (error) {
      setOperation({ status: "error", message: error.message });
    }
  };
  const clear = async () => {
    setOperation({ status: "loading", message: "Removing…" });
    try {
      await repository.clearWeeklyNote({ householdId, learnerId: learner.id, weekStart: week });
      await load();
      setOperation({ status: "success", message: "Note removed." });
    } catch (error) {
      setOperation({ status: "error", message: error.message });
    }
  };

  const errorId = `${id}-error`;
  return (
    <section className="staff-weekly-note" aria-labelledby={`${id}-heading`}>
      <h4 id={`${id}-heading`}>Note for the week</h4>
      <p className="staff-next-hint">
        Optional. A win you noticed or one practical suggestion. The family reads it in their weekly
        story. No health or diagnosis details.
      </p>
      {notes.status === "error" ? <p role="alert">{notes.error}</p> : null}
      <form onSubmit={save} noValidate>
        {operation.status === "error" ? (
          <p role="alert" id={errorId} className="form-error-summary">
            {operation.message}
          </p>
        ) : null}
        <label>
          Week starting
          <select value={week} onChange={(event) => setWeek(event.target.value)}>
            {weeks.map((monday, index) => (
              <option key={monday} value={monday}>
                {monday}
                {index === 0 ? " (this week)" : ""}
                {notes.items.some((item) => item.week_start === monday) ? " · has a note" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Note
          <textarea
            ref={noteRef}
            maxLength={1000}
            value={draft}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <div className="staff-inline-actions">
          <button className="primary" disabled={operation.status === "loading"}>
            {existing ? "Update note" : "Save note"}
          </button>
          {existing ? (
            <button type="button" className="ghost" disabled={operation.status === "loading"} onClick={clear}>
              Remove note
            </button>
          ) : null}
        </div>
        {operation.status !== "error" && operation.message ? <p role="status">{operation.message}</p> : null}
      </form>
    </section>
  );
}

const emptyActivity = () => ({ title: "", description: "", subjects: [], date: "", outcomes: {} });

export function StaffSharedActivities({ repository, householdId, learners }) {
  const id = useId();
  const [draft, setDraft] = useState(emptyActivity);
  const [invalid, setInvalid] = useState([]);
  const [list, setList] = useState({ status: "loading", items: [], error: null });
  const [operation, setOperation] = useState({ status: "idle", message: "" });
  const titleRef = useRef(null);
  const learnersRef = useRef(null);
  const outcomeRefs = useRef({});

  const load = useCallback(async () => {
    try {
      setList({ status: "success", items: (await repository.listSharedActivities(householdId)) ?? [], error: null });
    } catch (error) {
      setList({ status: "error", items: [], error: error.message });
    }
  }, [householdId, repository]);
  useEffect(() => {
    load();
  }, [load]);

  if (learners.length < 2) return null;
  const chosen = learners.filter((learner) => learner.id in draft.outcomes);
  const names = new Map(learners.map((learner) => [learner.id, learner.preferred_name]));

  const save = async (event) => {
    event.preventDefault();
    const problems = [];
    if (!draft.title.trim()) problems.push({ key: "title", text: "a title" });
    if (chosen.length < 2) problems.push({ key: "learners", text: "at least two children" });
    const missing = chosen.filter((learner) => !draft.outcomes[learner.id].trim());
    for (const learner of missing) problems.push({ key: `outcome:${learner.id}`, text: `what ${learner.preferred_name} should get out of it` });
    setInvalid(problems.map((item) => item.key));
    if (problems.length) {
      setOperation({ status: "error", message: `Add ${problems.map((item) => item.text).join(", ")}.` });
      const first = problems[0].key;
      (first === "title" ? titleRef.current : first === "learners" ? learnersRef.current : outcomeRefs.current[first.slice(8)])?.focus();
      return;
    }
    setOperation({ status: "loading", message: "Saving…" });
    try {
      await repository.createSharedActivity({
        householdId,
        title: draft.title,
        description: draft.description,
        subjects: draft.subjects,
        date: draft.date || null,
        outcomes: chosen.map((learner) => ({ learnerId: learner.id, outcome: draft.outcomes[learner.id] })),
      });
      setDraft(emptyActivity());
      await load();
      setOperation({ status: "success", message: "Shared activity saved. The family sees it under Family activities." });
    } catch (error) {
      setOperation({ status: "error", message: error.message });
    }
  };
  const remove = async (activity) => {
    // The family sees this activity, so removing it is confirmed first.
    if (!globalThis.confirm?.(`Remove “${activity.title}” from the family’s activities?`)) return;
    setOperation({ status: "loading", message: "Removing…" });
    try {
      await repository.removeSharedActivity({ householdId, activityId: activity.id });
      await load();
      setOperation({ status: "success", message: `Removed “${activity.title}”.` });
    } catch (error) {
      setOperation({ status: "error", message: error.message });
    }
  };

  const errorId = `${id}-error`;
  const describe = (key) => (invalid.includes(key) ? { "aria-invalid": true, "aria-describedby": errorId } : {});
  return (
    <section className="staff-shared-activities" aria-labelledby={`${id}-heading`}>
      <h4 id={`${id}-heading`}>Whole-family activity</h4>
      <p className="staff-next-hint">One activity for several children, with a different expected outcome for each.</p>
      <form onSubmit={save} noValidate>
        {operation.status === "error" ? (
          <p role="alert" id={errorId} className="form-error-summary">
            {operation.message}
          </p>
        ) : null}
        <label>
          Activity title
          <input ref={titleRef} maxLength={200} value={draft.title} {...describe("title")} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} />
        </label>
        <label>
          What the family does <span>(optional)</span>
          <textarea maxLength={2000} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} />
        </label>
        <label>
          Date <span>(optional)</span>
          <input type="date" value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} />
        </label>
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
                    subjects: event.target.checked ? [...value.subjects, subject] : value.subjects.filter((item) => item !== subject),
                  }))
                }
              />
              {subject}
            </label>
          ))}
        </fieldset>
        <fieldset className="shared-learners" ref={learnersRef} tabIndex={-1} {...describe("learners")}>
          <legend>Children and their expected outcome</legend>
          {learners.map((learner) => {
            const on = learner.id in draft.outcomes;
            return (
              <div key={learner.id} className="shared-learner-row">
                <label className="fit-toggle">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) =>
                      setDraft((value) => {
                        const outcomes = { ...value.outcomes };
                        if (event.target.checked) outcomes[learner.id] = "";
                        else delete outcomes[learner.id];
                        return { ...value, outcomes };
                      })
                    }
                  />
                  {learner.preferred_name}
                </label>
                {on ? (
                  <label>
                    What {learner.preferred_name} should get out of it
                    <input
                      ref={(node) => {
                        outcomeRefs.current[learner.id] = node;
                      }}
                      maxLength={500}
                      value={draft.outcomes[learner.id]}
                      {...describe(`outcome:${learner.id}`)}
                      onChange={(event) => setDraft((value) => ({ ...value, outcomes: { ...value.outcomes, [learner.id]: event.target.value } }))}
                    />
                  </label>
                ) : null}
              </div>
            );
          })}
        </fieldset>
        <button className="primary" disabled={operation.status === "loading"}>
          Save shared activity
        </button>
        {operation.status !== "error" && operation.message ? <p role="status">{operation.message}</p> : null}
      </form>
      {list.status === "error" ? <p role="alert">{list.error}</p> : null}
      {list.items.length ? (
        <ul className="capture-list" aria-label="Shared activities">
          {list.items.map((activity) => (
            <li key={activity.id}>
              <div>
                <strong>
                  {activity.title}
                  {activity.scheduled_for ? ` · ${activity.scheduled_for}` : ""}
                </strong>
                <small>
                  {(activity.shared_activity_learners ?? [])
                    .map((row) => `${names.get(row.learner_id) ?? "Learner"}${row.completed_at ? " (done)" : ""}`)
                    .join(", ")}
                </small>
              </div>
              <button type="button" className="ghost" aria-label={`Remove ${activity.title}`} disabled={operation.status === "loading"} onClick={() => remove(activity)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
