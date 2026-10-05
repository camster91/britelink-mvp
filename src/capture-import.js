import { CAPTURE_KINDS, INTAKE_SUBJECTS } from "./input-validation.js";

// Import outside learning from a spreadsheet (#51). Families who already keep a log elsewhere can
// bring it in as learning notes (#44). Columns: date, kind, subjects, note. Kinds accept the stored
// value or its label ("book" or "Book or reading"); subjects are separated by ";". At most 50 rows
// per import, which keeps well inside the per-actor rate limit on captures (60 an hour).
export const IMPORT_LIMIT = 50;
const KIND_ALIASES = {
  book: "book", "book or reading": "book", reading: "book",
  outing: "outing", "outing or field trip": "outing", "field trip": "outing",
  activity: "activity", "hands-on activity": "activity",
  co_op: "co_op", "co-op": "co_op", coop: "co_op", "co-op or group class": "co_op",
  tutor: "tutor", "tutor or lesson": "tutor",
  note: "note", other: "note", "something else": "note",
};

// RFC 4180-style parsing: quoted fields, doubled quotes, CRLF or LF, a trailing newline.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text ?? "").replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

// 2026-02-30 has the right shape but is not a day; the save would fail part-way through an import.
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function captureRowsFromCsv(text, today) {
  const rows = parseCsv(text);
  if (!rows.length) return { ready: [], problems: ["The file is empty."] };
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const column = (name) => header.indexOf(name);
  const missing = ["date", "kind", "note"].filter((name) => column(name) < 0);
  if (missing.length) return { ready: [], problems: [`The first row must name the columns date, kind, subjects, note (missing: ${missing.join(", ")}).`] };
  const body = rows.slice(1);
  const problems = [];
  if (body.length > IMPORT_LIMIT) problems.push(`Only the first ${IMPORT_LIMIT} rows are imported at a time; import the rest separately.`);
  const ready = [];
  body.slice(0, IMPORT_LIMIT).forEach((cells, index) => {
    const line = index + 2;
    const date = (cells[column("date")] ?? "").trim();
    const kind = KIND_ALIASES[(cells[column("kind")] ?? "").trim().toLowerCase()];
    const note = (cells[column("note")] ?? "").trim();
    const subjects = column("subjects") < 0 ? [] : (cells[column("subjects")] ?? "").split(";").map((item) => item.trim()).filter(Boolean);
    const unknownSubject = subjects.find((subject) => !INTAKE_SUBJECTS.includes(subject));
    const issue = !/^\d{4}-\d{2}-\d{2}$/.test(date) ? "date must look like 2026-10-05"
      : !isCalendarDate(date) ? `${date} is not a real date`
      : date > today ? "date is in the future"
      : !kind || !CAPTURE_KINDS.includes(kind) ? "kind is not one of book, outing, activity, co-op, tutor, note"
      : unknownSubject ? `"${unknownSubject}" is not a subject BriteLink tracks`
      : !note ? "note is empty"
      : note.length > 1000 ? "note is longer than 1000 characters"
      : null;
    if (issue) problems.push(`Row ${line}: ${issue}.`);
    else ready.push({ capturedOn: date, kind, subjects: [...new Set(subjects)], note });
  });
  return { ready, problems };
}
