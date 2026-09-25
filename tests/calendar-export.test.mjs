import assert from "node:assert/strict";
import test from "node:test";
import { foldIcsLine, icsText, planCalendarIcs } from "../src/calendar-export.js";

test("iCalendar text is escaped and long lines are folded to 75 octets", () => {
  assert.equal(icsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const folded = foldIcsLine(`DESCRIPTION:${"é".repeat(60)}`);
  for (const line of folded.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(folded.split("\r\n").slice(1).every((line) => line.startsWith(" ")), true);
  assert.equal(foldIcsLine("SHORT:x"), "SHORT:x");
});

test("the plan export has one all-day event per date with work left, follows moves, and names no child", () => {
  const weeks = [{ week_number: 1, plan_days: [
    { id: "d1", day_number: 1, lessons: [{ id: "a", subject: "Math", title: "Count, then sort" }, { id: "b", subject: "French", title: "Bonjour" }, { id: "m", subject: "Art", title: "Moved" }] },
    { id: "d2", day_number: 2, lessons: [{ id: "c", subject: "Art", title: "Draw" }] },
    { id: "d3", day_number: 3, lessons: [{ id: "d", subject: "Math", title: "Undated" }] },
  ] }];
  const dayDates = { d1: "2026-10-05", d2: "2026-10-06" };
  const now = new Date("2026-10-01T12:00:00Z");
  const { count, contents } = planCalendarIcs({ planId: "p1", weeks, dayDates, activitiesByLessonId: { c: { status: "completed" }, m: { scheduled_for: "2026-10-09" } }, paused: ["French"], now });
  assert.equal(count, 2, "Oct 5 (Math) and Oct 9 (the moved lesson); Oct 6 is done and day 3 has no date");
  assert.match(contents, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(contents, /UID:p1-20261005@britelink\r\nDTSTAMP:20261001T120000Z\r\nDTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006\r\nSUMMARY:BriteLink: 1 lesson/, "the paused subject is not counted");
  assert.match(contents, /DTSTART;VALUE=DATE:20261009/, "a moved lesson appears on its new date");
  assert.doesNotMatch(contents, /Count/, "lesson titles stay out unless the parent opts in");
  const titled = planCalendarIcs({ planId: "p1", weeks, dayDates, now, includeTitles: true }).contents;
  assert.match(titled, /Math: Count\\, then sort/);
  assert.ok(contents.endsWith("END:VCALENDAR\r\n"));
});

test("a calendar feed URL is built only from a well-formed token", async () => {
  const { calendarFeedUrl } = await import("../src/calendar-export.js");
  assert.equal(calendarFeedUrl("a".repeat(64), "https://britelink.ashbi.ca"), `https://britelink.ashbi.ca/feed/${"a".repeat(64)}.ics`);
  for (const bad of [undefined, "", "A".repeat(64), "a".repeat(63), "../../etc"]) assert.throws(() => calendarFeedUrl(bad, "https://x"), /token is invalid/);
});
