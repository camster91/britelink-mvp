import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { downloadTextFile } from "./browser-download.js";
import { REPORT_DISCLAIMER, learningReport, learningReportCsv } from "./learning-report.js";

// Learning report (#50): pick a period, then download a CSV or print a plain report. A family
// learning log, never a credit or transcript -- the disclaimer rides on every rendering.
export function LearningReport({ learnerName, weeks, activities, captures, today }) {
  const formId = useId();
  const monthStart = `${today.slice(0, 8)}01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [printing, setPrinting] = useState(false);
  let report = null;
  let error = "";
  try {
    report = learningReport({ weeks, activities, captures, from, to });
  } catch (failure) {
    error = failure.message;
  }
  useEffect(() => {
    if (!printing) return undefined;
    const done = () => setPrinting(false);
    globalThis.addEventListener?.("afterprint", done);
    const frame = globalThis.requestAnimationFrame?.(() => globalThis.print?.());
    return () => {
      globalThis.removeEventListener?.("afterprint", done);
      if (frame) globalThis.cancelAnimationFrame?.(frame);
    };
  }, [printing]);
  const slug = learnerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "learner";
  return (
    <details className="learning-report">
      <summary>Make a learning report</summary>
      <div>
        <p>{REPORT_DISCLAIMER}</p>
        <div className="capture-row">
          <label htmlFor={`${formId}-from`}>
            From
            <input id={`${formId}-from`} type="date" value={from} max={today} onChange={(event) => setFrom(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${formId}-error` : undefined} />
          </label>
          <label htmlFor={`${formId}-to`}>
            To
            <input id={`${formId}-to`} type="date" value={to} max={today} onChange={(event) => setTo(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${formId}-error` : undefined} />
          </label>
        </div>
        {error ? (
          <p role="alert" className="form-error-summary" id={`${formId}-error`}>
            {error}
          </p>
        ) : (
          <p role="status" className="report-count">
            {report.rows.length
              ? `${report.rows.length} ${report.rows.length === 1 ? "entry" : "entries"}${report.subjects.length ? ` across ${report.subjects.map(([subject]) => subject).join(", ")}` : ""}.`
              : "Nothing recorded in this period yet."}
          </p>
        )}
        <div className="plan-calendar-actions">
          <button
            type="button"
            className="ghost"
            disabled={!report}
            onClick={() => downloadTextFile(`britelink-${slug}-${from}-to-${to}.csv`, learningReportCsv(report, learnerName), "text/csv;charset=utf-8")}
          >
            Download CSV
          </button>
          <button type="button" className="ghost" disabled={!report} onClick={() => setPrinting(true)}>
            Print report
          </button>
        </div>
      </div>
      {printing && report
        ? createPortal(
            <section className="print-sheet">
              <h1>
                {learnerName}’s learning, {report.from} to {report.to}
              </h1>
              <p>{REPORT_DISCLAIMER}</p>
              {report.subjects.length ? (
                <p>
                  Subjects: {report.subjects.map(([subject, count]) => `${subject} (${count})`).join(", ")}
                </p>
              ) : null}
              <table className="print-report">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Source</th>
                    <th scope="col">Subjects</th>
                    <th scope="col">What</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, index) => (
                    <tr key={index}>
                      <td>{row.date}</td>
                      <td>{row.source}</td>
                      <td>{row.subjects.join(", ")}</td>
                      <td>{row.title}</td>
                      <td>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <footer>Printed from BriteLink on {today}</footer>
            </section>,
            document.body,
          )
        : null}
    </details>
  );
}
