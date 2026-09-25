// Calendar export (#47): the family calendar's dated plan days as an iCalendar file (RFC 5545) that
// Google, Apple and Outlook calendars import. Private by default: event titles never carry the
// child's name, and lesson titles only when the parent opts in. Stable UIDs mean re-importing
// updates events instead of duplicating them. The live subscription feed (migration 050's
// calendar_feed) builds the same events in SQL; tests/postgres-rls-full-chain.test.mjs keeps the two
// byte-identical. Email reminders need SMTP and are not built.

// RFC 5545 3.3.11: backslash, semicolon, comma and newlines are escaped in TEXT values.
export function icsText(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// RFC 5545 3.1: lines longer than 75 octets are folded with CRLF + a single space.
export function foldIcsLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let chunk = "";
  let size = 0;
  for (const char of line) {
    const width = new TextEncoder().encode(char).length;
    if (size + width > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += char;
    size += width;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

const compactDate = (date) => date.replaceAll("-", "");
const nextDate = (date) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

export function planCalendarIcs({ planId, weeks = [], dayDates = {}, activitiesByLessonId = {}, paused = [], includeTitles = false, now = new Date() }) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // Group by the date each unfinished lesson now falls on: its own move wins over its plan day.
  const byDate = new Map();
  for (const week of weeks) {
    for (const day of week.plan_days ?? []) {
      for (const lesson of day.lessons ?? []) {
        const activity = activitiesByLessonId[lesson.id];
        if (["completed", "skipped"].includes(activity?.status) || paused.includes(lesson.subject)) continue;
        const date = activity?.scheduled_for ?? dayDates[day.id];
        if (!date) continue;
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push(lesson);
      }
    }
  }
  const events = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, lessons]) => {
    const summary = `BriteLink: ${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"}`;
    const description = includeTitles ? lessons.map((lesson) => `${lesson.subject}: ${lesson.title}`).join("\n") : "Open BriteLink to see the day's lessons.";
    return [
      "BEGIN:VEVENT",
      `UID:${planId}-${compactDate(date)}@britelink`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(date)}`,
      `DTEND;VALUE=DATE:${compactDate(nextDate(date))}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    ];
  });
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BriteLink//Family plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...events.flat(), "END:VCALENDAR"];
  return { count: events.length, contents: lines.map(foldIcsLine).join("\r\n") + "\r\n" };
}

// The subscription URL for a feed token (served by nginx.conf.template's /feed/ route). Only
// well-formed tokens make a URL, so a bug upstream cannot produce a link that looks valid.
export function calendarFeedUrl(token, origin = globalThis.location?.origin ?? "") {
  if (!/^[0-9a-f]{64}$/.test(token ?? "")) throw new TypeError("Calendar link token is invalid");
  return `${origin}/feed/${token}.ics`;
}
