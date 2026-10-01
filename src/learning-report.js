import { localDateString } from "./authenticated-workspace.js";

// Learning report (#50): a dated record of lessons done and learning captured outside the plan, for
// a chosen period. It is a family learning log -- never an Ontario credit, transcript or OSSD record
// (only authorized schools grant those), and every rendering says so.
export const REPORT_DISCLAIMER =
  "This is a family learning log kept in BriteLink. It is not an Ontario credit, transcript, or OSSD record.";

const KIND_LABELS = { book: "Book or reading", outing: "Outing or field trip", activity: "Hands-on activity", co_op: "Co-op or group class", tutor: "Tutor or lesson", note: "Something else" };

export function learningReport({ weeks = [], activities = [], captures = [], from, to, toLocalDate = (iso) => localDateString(new Date(iso)) } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) throw new TypeError("Choose a start and end date");
  if (from > to) throw new TypeError("The start date must be on or before the end date");
  const inRange = (date) => Boolean(date) && date >= from && date <= to;
  const lessons = new Map(weeks.flatMap((week) => (week.plan_days ?? []).flatMap((day) => day.lessons ?? [])).map((lesson) => [lesson.id, lesson]));
  const rows = [
    ...activities
      .filter((activity) => activity.status === "completed")
      .map((activity) => ({ activity, lesson: lessons.get(activity.lesson_id), date: toLocalDate(activity.first_completed_at ?? activity.updated_at) }))
      .filter(({ lesson, date }) => lesson && inRange(date))
      .map(({ activity, lesson, date }) => ({ date, source: "Plan lesson", subjects: [lesson.subject], title: lesson.title, detail: activity.caregiver_note ?? "" })),
    ...captures
      .filter((capture) => inRange(capture.captured_on))
      .map((capture) => ({ date: capture.captured_on, source: "Outside the plan", subjects: capture.subjects ?? [], title: KIND_LABELS[capture.kind] ?? capture.kind, detail: capture.note ?? "" })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.title.localeCompare(b.title));
  const tally = {};
  for (const row of rows) for (const subject of row.subjects) tally[subject] = (tally[subject] ?? 0) + 1;
  return { from, to, rows, subjects: Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
}

// CSV with every cell quoted, and cells that a spreadsheet would treat as a formula neutralised with
// a leading apostrophe (OWASP CSV injection guidance: = + - @ tab carriage-return).
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function learningReportCsv(report, learnerName) {
  const lines = [
    [`Learning report for ${learnerName}`, `${report.from} to ${report.to}`],
    [REPORT_DISCLAIMER],
    [],
    ["Date", "Source", "Subjects", "What", "Notes"],
    ...report.rows.map((row) => [row.date, row.source, row.subjects.join("; "), row.title, row.detail]),
  ];
  return lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
