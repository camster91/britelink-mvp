import { useCallback, useEffect, useId, useState } from "react";
import { sharedActivitiesView } from "./authenticated-workspace.js";

// Whole-family activities (#45): authored once by the educator for several children, each with
// their own expected outcome. The family marks each child separately, moves the activity for
// everyone, or moves just one child ("split") when that child needs another day.
export function SharedActivities({ repository, householdId, learners, today }) {
  const headingId = useId();
  const [state, setState] = useState({ status: "loading", items: [], error: null });
  const [operation, setOperation] = useState({ status: "idle", message: "" });
  const [moving, setMoving] = useState(null);

  const load = useCallback(async () => {
    try {
      const items = await repository.listSharedActivities(householdId);
      setState({ status: "success", items: items ?? [], error: null });
    } catch (error) {
      setState({ status: "error", items: [], error: error.message });
    }
  }, [householdId, repository]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (message, run) => {
    setOperation({ status: "loading", message: "Saving…" });
    try {
      await run();
      await load();
      setOperation({ status: "success", message });
      return true;
    } catch (error) {
      setOperation({ status: "error", message: error.message });
      return false;
    }
  };

  if (learners.length < 2 || (state.status === "success" && !state.items.length)) return null;
  const view = sharedActivitiesView(state.items, learners);
  return (
    <section className="shared-activities" aria-labelledby={headingId}>
      <span className="eyebrow">Together</span>
      <h2 id={headingId}>Family activities</h2>
      {state.status === "error" ? (
        <p role="alert">
          {state.error}{" "}
          <button type="button" className="ghost" onClick={load}>
            Try again
          </button>
        </p>
      ) : null}
      {state.status === "loading" ? <p role="status">Loading family activities…</p> : null}
      {view.open.map((item) => (
        <article key={item.id} className="shared-activity">
          <header>
            <h3>{item.title}</h3>
            <small>
              {item.date ? (item.date === today ? "Today" : item.date) : "Any day"}
              {item.subjects.length ? ` · ${item.subjects.join(", ")}` : ""}
            </small>
          </header>
          {item.description ? <p>{item.description}</p> : null}
          <ul aria-label={`What each child works on in ${item.title}`}>
            {item.learners.map((row) => (
              <li key={row.learnerId}>
                <label className="fit-toggle">
                  <input
                    type="checkbox"
                    checked={row.done}
                    disabled={operation.status === "loading"}
                    onChange={(event) =>
                      act(event.target.checked ? `Marked done for ${row.name}.` : `Marked not done for ${row.name}.`, () =>
                        repository.setSharedActivityDone({ householdId, activityId: item.id, learnerId: row.learnerId, done: event.target.checked }),
                      )
                    }
                  />
                  <span>
                    <strong>{row.name}</strong>: {row.outcome}
                    {row.split ? <small> (moved to {row.date})</small> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {moving?.id === item.id ? (
            <form
              className="shared-activity-move"
              onSubmit={async (event) => {
                event.preventDefault();
                const who = item.learners.find((row) => row.learnerId === moving.learnerId);
                const saved = await act(
                  who ? `Moved for ${who.name} only.` : "Moved for everyone.",
                  () => repository.moveSharedActivity({ householdId, activityId: item.id, date: moving.date || null, learnerId: moving.learnerId || null }),
                );
                if (saved) setMoving(null);
              }}
            >
              <label>
                New date
                <input type="date" value={moving.date} min={today} onChange={(event) => setMoving((value) => ({ ...value, date: event.target.value }))} />
              </label>
              <label>
                Who
                <select value={moving.learnerId} onChange={(event) => setMoving((value) => ({ ...value, learnerId: event.target.value }))}>
                  <option value="">Everyone</option>
                  {item.learners.map((row) => (
                    <option key={row.learnerId} value={row.learnerId}>
                      Only {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" disabled={operation.status === "loading"}>
                Move
              </button>
              <button type="button" className="ghost" onClick={() => setMoving(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="ghost" onClick={() => setMoving({ id: item.id, date: item.date ?? today, learnerId: "" })}>
              Move this activity
            </button>
          )}
        </article>
      ))}
      {state.status === "success" && !view.open.length ? <p>All family activities are done.</p> : null}
      {view.doneCount ? (
        <small className="shared-done-count">
          {view.doneCount} finished {view.doneCount === 1 ? "activity" : "activities"} in the record.
        </small>
      ) : null}
      {operation.status === "error" ? (
        <p role="alert" className="form-error-summary">
          {operation.message}
        </p>
      ) : operation.message ? (
        <p role="status">{operation.message}</p>
      ) : null}
    </section>
  );
}
