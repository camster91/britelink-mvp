import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lessonInstructionTexts } from "./authenticated-workspace.js";

const HOLD_MS = 2000;

// The student check-off view (#49): a short, big-target list of today's lessons that a child can
// tick off on the family's device. It runs inside the guardian's session -- there is no learner
// login -- so it is a focus mode, not a security boundary: the rest of the app is made inert while
// it is open, and leaving needs a grown-up to press and hold, which stops accidental exits.
export function StudentView({ learnerName, lessons, onDone, onExit }) {
  const headingId = useId();
  const dialogRef = useRef(null);
  const [saving, setSaving] = useState(null);
  const [finished, setFinished] = useState([]);
  const [error, setError] = useState("");
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef(null);

  useEffect(() => {
    const root = document.getElementById("root");
    const previous = document.activeElement;
    if (root) root.inert = true;
    dialogRef.current?.focus();
    return () => {
      if (root) root.inert = false;
      clearTimeout(holdTimer.current);
      previous?.focus?.();
    };
  }, []);

  const startHold = () => {
    if (holdTimer.current) return;
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setHolding(false);
      onExit();
    }, HOLD_MS);
  };
  const stopHold = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
  };

  const markDone = async (lesson) => {
    setSaving(lesson.id);
    setError("");
    try {
      await onDone(lesson);
      setFinished((items) => [...items, lesson.title]);
    } catch (failure) {
      setError(`That didn’t save. Ask a grown-up to try again. (${failure.message})`);
    } finally {
      setSaving(null);
    }
  };

  return createPortal(
    <div className="student-view" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} ref={dialogRef}>
      <header>
        <h1 id={headingId}>{learnerName}’s list for today</h1>
        <button
          type="button"
          className={`student-exit${holding ? " holding" : ""}`}
          onPointerDown={startHold}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
              event.preventDefault();
              startHold();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === "Enter" || event.key === " ") stopHold();
          }}
          onClick={(event) => event.preventDefault()}
        >
          Grown-ups: press and hold to leave
        </button>
      </header>
      {finished.length ? (
        <p className="student-finished" role="status">
          Done today: {finished.join(", ")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="form-error-summary">
          {error}
        </p>
      ) : null}
      {lessons.length ? (
        <ol className="student-lessons">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <span>{lesson.subject}</span>
              <h2>{lesson.title}</h2>
              {lesson.instructions?.length ? (
                <ol>
                  {lessonInstructionTexts(lesson.instructions).map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              ) : null}
              <button
                type="button"
                className="primary"
                disabled={saving !== null}
                onClick={() => markDone(lesson)}
              >
                {saving === lesson.id ? "Saving…" : "I did it!"}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="student-all-done">That’s everything for today. Nice work!</p>
      )}
    </div>,
    document.body,
  );
}
