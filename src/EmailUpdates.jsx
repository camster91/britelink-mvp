import { useEffect, useId, useState } from "react";

// One switch for email notices (migration 058): new plan, new message, revision answer. On by
// default; the email never includes details about a child. Shared by parents and staff.
export function EmailUpdates({ repository, audience = "family" }) {
  const id = useId();
  const [state, setState] = useState({ status: "loading", enabled: true, message: "" });
  const load = async () => {
    setState((value) => ({ ...value, status: "loading", message: "" }));
    try {
      const enabled = await repository.getEmailNotifications();
      setState({ status: "ready", enabled, message: "" });
    } catch (error) {
      setState({ status: "error", enabled: true, message: `Your email setting could not load: ${error.message}` });
    }
  };
  useEffect(() => {
    load();
  }, [repository]);
  if (!repository.getEmailNotifications || !repository.setEmailNotifications) return null;
  const change = async (event) => {
    const enabled = event.target.checked;
    const previous = state.enabled;
    setState({ status: "saving", enabled, message: "" });
    try {
      await repository.setEmailNotifications(enabled);
      setState({ status: "ready", enabled, message: enabled ? "Email updates are on." : "Email updates are off. You can still see everything when you sign in." });
    } catch (error) {
      setState({ status: "ready", enabled: previous, message: `Not changed: ${error.message}` });
    }
  };
  const what =
    audience === "staff"
      ? "A short email when a family sends you a message."
      : "A short email when your plan arrives, your educator writes, or your plan change request is answered.";
  return (
    <div className="email-updates">
      <label htmlFor={`${id}-email`}>
        <input
          id={`${id}-email`}
          type="checkbox"
          checked={state.enabled}
          disabled={state.status === "loading" || state.status === "saving" || state.status === "error"}
          onChange={change}
          aria-describedby={`${id}-help`}
        />{" "}
        Email me about updates
      </label>
      <p id={`${id}-help`} className="staff-next-hint">
        {what} It never includes details about your child.
      </p>
      {state.status === "error" ? (
        <p role="alert">
          {state.message}{" "}
          <button type="button" className="ghost" onClick={load}>
            Try again
          </button>
        </p>
      ) : state.message ? (
        <p role="status">{state.message}</p>
      ) : null}
    </div>
  );
}
