import { useCallback, useEffect, useId, useRef, useState } from "react";
import { calendarFeedUrl } from "./calendar-export.js";

// A calendar subscription link (#47, migration 050). Calendar apps poll it, so moved lessons and
// days off show up without re-downloading a file. The token is shown once, when the link is made:
// the database keeps only its hash. Private by default -- no child's name ever, and lesson titles
// only when the parent ticks the box before creating the link.
export function CalendarFeed({ repository, householdId, learner }) {
  const titlesId = useId();
  const [state, setState] = useState({ status: "loading", feed: null, error: null });
  const [includeTitles, setIncludeTitles] = useState(false);
  const [created, setCreated] = useState(null);
  const [operation, setOperation] = useState({ status: "idle", message: "" });
  const linkRef = useRef(null);

  const load = useCallback(async () => {
    setState((value) => ({ ...value, status: "loading", error: null }));
    try {
      setState({ status: "success", feed: await repository.getCalendarFeed(householdId, learner.id), error: null });
    } catch (error) {
      setState({ status: "error", feed: null, error: error.message });
    }
  }, [householdId, learner.id, repository]);
  useEffect(() => {
    setCreated(null);
    setOperation({ status: "idle", message: "" });
    load();
  }, [load]);
  useEffect(() => {
    if (created) linkRef.current?.focus();
  }, [created]);

  const create = async () => {
    setOperation({ status: "loading", message: "Creating your calendar link…" });
    try {
      const made = await repository.createCalendarFeed({ householdId, learnerId: learner.id, includeTitles });
      setCreated({ url: calendarFeedUrl(made.token), includeTitles });
      setOperation({ status: "success", message: "Calendar link created. Copy it now: it is shown only once." });
      await load();
    } catch (error) {
      setOperation({ status: "error", message: error.message });
    }
  };
  const revoke = async () => {
    setOperation({ status: "loading", message: "Turning the link off…" });
    try {
      await repository.revokeCalendarFeed({ householdId, learnerId: learner.id });
      setCreated(null);
      setOperation({ status: "success", message: "Calendar link turned off. Calendars using it stop updating." });
      await load();
    } catch (error) {
      setOperation({ status: "error", message: error.message });
    }
  };
  const copy = async () => {
    try {
      await globalThis.navigator?.clipboard?.writeText(created.url);
      setOperation({ status: "success", message: "Link copied." });
    } catch {
      linkRef.current?.select();
      setOperation({ status: "success", message: "Select the link and copy it." });
    }
  };

  const busy = operation.status === "loading";
  return (
    <details className="calendar-feed">
      <summary>Keep my calendar app up to date</summary>
      <div>
        <p>
          A private link your calendar app (Google, Apple, Outlook) checks on its own, so moved
          lessons and days off update without downloading a file again. It never includes{" "}
          {learner.preferred_name}’s name.
        </p>
        {state.status === "error" ? (
          <p role="alert">
            {state.error}{" "}
            <button type="button" className="ghost" onClick={load}>
              Try again
            </button>
          </p>
        ) : null}
        {created ? (
          <div className="calendar-feed-link">
            <label>
              Your calendar link
              <input ref={linkRef} readOnly value={created.url} onFocus={(event) => event.target.select()} />
            </label>
            <button type="button" className="primary" onClick={copy}>
              Copy link
            </button>
            <small>
              Anyone with this link can see the dates{created.includeTitles ? " and lesson titles" : ""}.
              Paste it into your calendar app’s “subscribe by URL” option. It will not be shown again.
            </small>
          </div>
        ) : state.feed ? (
          <p className="calendar-feed-on">
            A calendar link is on for {learner.preferred_name}
            {state.feed.include_titles ? ", with lesson titles" : ", dates only"}. Created{" "}
            {String(state.feed.created_at).slice(0, 10)}.
          </p>
        ) : null}
        {state.status === "success" ? (
          <div className="calendar-feed-actions">
            <label className="fit-toggle" htmlFor={titlesId}>
              <input
                id={titlesId}
                type="checkbox"
                checked={includeTitles}
                onChange={(event) => setIncludeTitles(event.target.checked)}
              />
              Include lesson titles
            </label>
            <button type="button" className={state.feed ? "ghost" : "primary"} disabled={busy} onClick={create}>
              {state.feed ? "Replace link" : "Create calendar link"}
            </button>
            {state.feed ? (
              <button type="button" className="ghost" disabled={busy} onClick={revoke}>
                Turn off link
              </button>
            ) : null}
          </div>
        ) : null}
        {state.feed && !created ? (
          <small>Replacing the link stops the old one. Lost it? Replace it and subscribe again.</small>
        ) : null}
        {operation.status === "error" ? (
          <p role="alert" className="form-error-summary">
            {operation.message}
          </p>
        ) : operation.message ? (
          <p role="status">{operation.message}</p>
        ) : null}
      </div>
    </details>
  );
}
