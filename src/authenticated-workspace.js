export function latestPublishedPlan(plans) {
  if (!Array.isArray(plans)) return null;
  return [...plans]
    .filter((plan) => plan?.status === "published")
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
}

export function orderedPlanWeeks(plan) {
  return [...(plan?.plan_weeks ?? [])]
    .sort((a, b) => a.week_number - b.week_number)
    .map((week) => ({
      ...week,
      plan_days: [...(week.plan_days ?? [])]
        .sort((a, b) => a.day_number - b.day_number)
        .map((day) => ({ ...day, lessons: [...(day.lessons ?? [])].sort((a, b) => a.position - b.position) })),
    }));
}

export function activityMap(activities) {
  return Object.fromEntries((activities ?? []).map((activity) => [activity.lesson_id, activity]));
}

export function messageIsUnread(message, userId) {
  return message?.sender_user_id !== userId && !(message?.case_message_reads ?? []).some((read) => read.user_id === userId);
}

export function caseForLearner(cases, learnerId) {
  return (cases ?? []).find((item) => item.learner_id === learnerId) ?? null;
}

// Lessons still to do on a plan day. Completed and skipped lessons are part of the record, not the
// plan still to do, so a whole-day move leaves them where they happened.
export function unfinishedLessons(day, activitiesByLessonId = {}) {
  return (day?.lessons ?? []).filter((lesson) => !["completed", "skipped"].includes(activitiesByLessonId[lesson.id]?.status));
}

// "Move this day": the activity input for each unfinished lesson. Every moved lesson keeps its
// status and caregiver note, so the move adapts the plan without rewriting history.
export function planDayMove(day, activitiesByLessonId = {}, { reason, scheduledFor } = {}) {
  if (!reason || !scheduledFor) throw new TypeError("Choose a reason and a new date to move this day");
  return unfinishedLessons(day, activitiesByLessonId).map((lesson) => {
    const activity = activitiesByLessonId[lesson.id];
    return {
      lessonId: lesson.id,
      status: activity?.status ?? "not_started",
      note: activity?.caregiver_note ?? "",
      scheduleReason: reason,
      scheduledFor,
    };
  });
}

// Where a day's unfinished lessons now sit, for the day tab: one shared new date, or null.
export function dayMovedTo(day, activitiesByLessonId = {}) {
  const open = unfinishedLessons(day, activitiesByLessonId);
  if (!open.length) return null;
  const dates = new Set(open.map((lesson) => activitiesByLessonId[lesson.id]?.scheduled_for ?? null));
  return dates.size === 1 ? [...dates][0] : null;
}

// The next honest action for today. A lesson dated later -- moved there, or placed there by the
// family calendar -- is not "next" until that date, so it is skipped; lessons dated today or earlier
// stay in plan order with everything else.
// When every unfinished lesson has been moved ahead, say when work resumes -- never report the
// plan as finished while moved work remains.
//   { kind: "due", week, day, lesson, status, weekIndex, dayIndex }
//   { kind: "later", resumesOn, week, day, lesson, status, weekIndex, dayIndex }  earliest moved lesson
//   { kind: "done" }
export function nextLessonForToday(weeks = [], activitiesByLessonId = {}, today, dayDates = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) throw new TypeError("today must be a YYYY-MM-DD date");
  let later = null;
  for (const [weekIndex, week] of weeks.entries()) {
    for (const [dayIndex, day] of (week.plan_days ?? []).entries()) {
      for (const lesson of day.lessons ?? []) {
        const activity = activitiesByLessonId[lesson.id];
        const status = activity?.status ?? "not_started";
        if (status === "completed" || status === "skipped") continue;
        const entry = { week, day, lesson, status, weekIndex, dayIndex };
        // A moved lesson's own date wins; otherwise the plan day's calendar date, if it has one.
        const movedTo = activity?.scheduled_for ?? dayDates[day.id] ?? null;
        if (!movedTo || movedTo <= today) return { kind: "due", ...entry };
        if (!later || movedTo < later.resumesOn) later = { kind: "later", resumesOn: movedTo, ...entry };
      }
    }
  }
  return later ?? { kind: "done" };
}

// Today's date in the family's own time zone, as the YYYY-MM-DD that scheduled_for stores.
export function localDateString(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ---------------------------------------------------------------------------
// Family calendar (migration 043). Dates are derived, never stored per lesson: plan days fill the
// family's school days in order from start_date, skipping days off. An educator-set planned_date is
// a fixed commitment -- it keeps its date and does not use up a school-day slot. With no start_date
// the family goes at its own pace, and only educator-set dates exist.
// All arithmetic is on UTC midnights so a DST change can never shift a date.
const DAY_MS = 86400000;
const toUtc = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoWeekday = (ms) => new Date(ms).getUTCDay() || 7;

export function planDayDates(weeks = [], schedule = null) {
  const days = weeks.flatMap((week) => week.plan_days ?? []);
  const dates = {};
  const fixed = new Set(days.map((day) => day.planned_date).filter(Boolean));
  if (!schedule?.start_date) {
    for (const day of days) dates[day.id] = day.planned_date ?? null;
    return dates;
  }
  const schoolDays = new Set((schedule.school_days ?? []).map(Number));
  if (!schoolDays.size) throw new TypeError("A calendar needs at least one school day");
  const daysOff = new Set(schedule.days_off ?? []);
  let cursor = toUtc(schedule.start_date);
  for (const day of days) {
    if (day.planned_date) { dates[day.id] = day.planned_date; continue; }
    while (!schoolDays.has(isoWeekday(cursor)) || daysOff.has(fromUtc(cursor)) || fixed.has(fromUtc(cursor))) cursor += DAY_MS;
    dates[day.id] = fromUtc(cursor);
    cursor += DAY_MS;
  }
  return dates;
}

// "Take today off": the new days_off list, or null when the day is not a school day to take off.
export function withDayOff(schedule, date) {
  if (!schedule?.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return null;
  if (date < schedule.start_date || !(schedule.school_days ?? []).map(Number).includes(isoWeekday(toUtc(date)))) return null;
  const off = new Set(schedule.days_off ?? []);
  if (off.has(date)) return null;
  return [...off, date].sort();
}

export function withoutDayOff(schedule, date) {
  return (schedule?.days_off ?? []).filter((item) => item !== date);
}

export const WEEKDAY_LABELS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
