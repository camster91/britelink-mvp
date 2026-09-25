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
export function nextLessonForToday(weeks = [], activitiesByLessonId = {}, today, dayDates = {}, filters = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) throw new TypeError("today must be a YYYY-MM-DD date");
  const filtering = hasFitFilters(filters);
  const due = [];
  const pausedLeft = new Set();
  let later = null;
  for (const [weekIndex, week] of weeks.entries()) {
    for (const [dayIndex, day] of (week.plan_days ?? []).entries()) {
      for (const lesson of day.lessons ?? []) {
        const activity = activitiesByLessonId[lesson.id];
        const status = activity?.status ?? "not_started";
        if (status === "completed" || status === "skipped") continue;
        if (filters.paused?.includes(lesson.subject)) { pausedLeft.add(lesson.subject); continue; }
        const entry = { week, day, lesson, status, weekIndex, dayIndex };
        // A moved lesson's own date wins; otherwise the plan day's calendar date, if it has one.
        const movedTo = activity?.scheduled_for ?? dayDates[day.id] ?? null;
        if (!movedTo || movedTo <= today) {
          if (!filtering) return { kind: "due", ...entry };
          due.push(entry);
          continue;
        }
        if (!later || movedTo < later.resumesOn) later = { kind: "later", resumesOn: movedTo, ...entry };
      }
    }
  }
  if (due.length) {
    // With "what fits today" filters: the first lesson that fits; else the first the educator has
    // not tagged (shown as untagged, never assumed to fit); else nothing fits, so offer the shortest.
    const fitting = due.find((entry) => lessonFit(entry.lesson, filters) === "fits");
    if (fitting) return { kind: "due", fit: "fits", ...fitting };
    const unknown = due.find((entry) => lessonFit(entry.lesson, filters) === "unknown");
    if (unknown) return { kind: "due", fit: "unknown", ...unknown };
    const shortest = [...due].sort((a, b) => (a.lesson.estimated_minutes ?? Infinity) - (b.lesson.estimated_minutes ?? Infinity))[0];
    return { kind: "due", fit: "none", ...shortest };
  }
  if (later) return later;
  // Work remains but every bit of it is in a paused subject: say so, never "done".
  return pausedLeft.size ? { kind: "paused", subjects: [...pausedLeft] } : { kind: "done" };
}

// "What fits today" (044). Filters: maxMinutes (number or null), alone (child works independently),
// offline (no screen). A lesson "fits" when every active filter is satisfied by an educator tag;
// "no" when a tag rules it out; "unknown" when a needed tag is missing -- untagged is never a yes.
export function hasFitFilters(filters = {}) {
  return Boolean(filters.maxMinutes || filters.alone || filters.offline);
}

export function lessonFit(lesson, filters = {}) {
  const checks = [];
  if (filters.maxMinutes) checks.push(lesson?.estimated_minutes == null ? null : lesson.estimated_minutes <= filters.maxMinutes);
  if (filters.alone) checks.push(lesson?.help_level == null ? null : lesson.help_level === "independent");
  if (filters.offline) checks.push(lesson?.needs_screen == null ? null : lesson.needs_screen === false);
  if (checks.includes(false)) return "no";
  if (checks.includes(null)) return "unknown";
  return "fits";
}

// Short, plain description of a lesson's tags for the family, or "" when untagged.
export function lessonFitSummary(lesson) {
  const parts = [];
  if (lesson?.estimated_minutes != null) parts.push(`About ${lesson.estimated_minutes} min`);
  if (lesson?.help_level) parts.push({ independent: "child can do it alone", some_help: "some adult help", together: "done together" }[lesson.help_level]);
  if (lesson?.needs_screen != null) parts.push(lesson.needs_screen ? "needs a screen" : "no screen needed");
  return parts.join(" · ");
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

// What a printed sheet shows (#48): the selected week, or one day, with calendar dates and a plain
// checklist. Completed and skipped lessons are marked, not dropped, so the paper matches the record.
export function printableDays(weeks = [], { scope = "week", weekIndex = 0, dayIndex = 0 } = {}, dayDates = {}, activitiesByLessonId = {}) {
  const week = weeks[weekIndex];
  if (!week) return [];
  const days = scope === "day" ? [week.plan_days?.[dayIndex]].filter(Boolean) : week.plan_days ?? [];
  return days.map((day) => ({
    id: day.id,
    heading: `Week ${week.week_number} · Day ${day.day_number}`,
    date: dayDates[day.id] ?? null,
    lessons: (day.lessons ?? []).map((lesson) => ({
      id: lesson.id,
      subject: lesson.subject,
      title: lesson.title,
      objective: lesson.objective,
      instructions: lesson.instructions ?? [],
      materials: lesson.materials ?? [],
      fit: lessonFitSummary(lesson),
      done: ["completed", "skipped"].includes(activitiesByLessonId[lesson.id]?.status) ? activitiesByLessonId[lesson.id].status : null,
      movedTo: activitiesByLessonId[lesson.id]?.scheduled_for ?? null,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Weekly story (#43): evidence that learning happened, without school-style judgement -- no
// percentages, no red/green, no "behind". Weeks run Monday to Sunday in the family's own calendar.
export function weekBounds(date, offsetWeeks = 0) {
  const ms = toUtc(date) + offsetWeeks * 7 * DAY_MS;
  const start = ms - (isoWeekday(ms) - 1) * DAY_MS;
  return { start: fromUtc(start), end: fromUtc(start + 6 * DAY_MS) };
}

export function weeklyStory({ weeks = [], activities = [], captures = [], schedule = null, today, offsetWeeks = 0, toLocalDate = (iso) => localDateString(new Date(iso)) } = {}) {
  const { start, end } = weekBounds(today, offsetWeeks);
  const inWeek = (date) => Boolean(date) && date >= start && date <= end;
  const lessons = new Map(weeks.flatMap((week) => (week.plan_days ?? []).flatMap((day) => day.lessons ?? [])).map((lesson) => [lesson.id, lesson]));
  const completed = activities
    .filter((activity) => activity.status === "completed" && inWeek(toLocalDate(activity.updated_at)))
    .map((activity) => lessons.get(activity.lesson_id))
    .filter(Boolean)
    .map((lesson) => ({ id: lesson.id, title: lesson.title, subject: lesson.subject }));
  const notes = captures.filter((capture) => inWeek(capture.captured_on));
  const subjects = [...new Set([...completed.map((item) => item.subject), ...notes.flatMap((item) => item.subjects ?? [])])].sort();
  const daysOff = (schedule?.days_off ?? []).filter(inWeek);
  const moved = activities.filter((activity) => activity.scheduled_for && inWeek(activity.scheduled_for) && activity.status !== "completed" && activity.status !== "skipped").length;
  return { start, end, completed, notes, subjects, daysOff, moved, isEmpty: !completed.length && !notes.length };
}

// Today's list for the student view (#49): unfinished lessons due today or earlier (or undated, for
// families at their own pace), in plan order, capped so a child sees a short, finishable list.
export function dueLessonsForToday(weeks = [], activitiesByLessonId = {}, today, dayDates = {}, limit = 5, paused = []) {
  const due = [];
  for (const week of weeks) {
    for (const day of week.plan_days ?? []) {
      for (const lesson of day.lessons ?? []) {
        const activity = activitiesByLessonId[lesson.id];
        if (["completed", "skipped"].includes(activity?.status)) continue;
        if (paused.includes(lesson.subject)) continue;
        const date = activity?.scheduled_for ?? dayDates[day.id] ?? null;
        if (date && date > today) continue;
        due.push(lesson);
        if (due.length >= limit) return due;
      }
    }
  }
  return due;
}

// The subjects a plan actually teaches, for "Pause a subject" (#40), in first-appearance order.
export function planSubjects(weeks = []) {
  return [...new Set(weeks.flatMap((week) => (week.plan_days ?? []).flatMap((day) => (day.lessons ?? []).map((lesson) => lesson.subject))).filter(Boolean))];
}

// Before the plan arrives (#53): where the family's case really is, in their words. Driven only by
// the recorded case status -- never an ETA, never an invented "your educator is online".
const PLAN_STEP_BY_STATUS = {
  paid: 0, intake_pending: 0,
  submitted: 1, triage: 1, clarification: 1, assigned: 1,
  drafting: 2, internal_review: 2, overdue: 2, revision_requested: 2, revised: 2,
  published: 3, delivered: 3, acknowledged: 3,
};

export function planProgress(caseStatus, learnerName = "your learner") {
  const labels = [
    `Tell us about ${learnerName}`,
    "An educator reviews your answers",
    "The plan is written and independently checked",
    "Your plan arrives here",
  ];
  if (["on_hold", "cancelled", "refunded", "chargeback", "closed"].includes(caseStatus)) {
    return {
      steps: labels.map((label) => ({ label, state: "upcoming" })),
      note: caseStatus === "on_hold"
        ? "Work on this plan is paused. Check your messages and consent below, or message your educator."
        : "This case is closed. Message BriteLink if you think that is a mistake.",
    };
  }
  const current = PLAN_STEP_BY_STATUS[caseStatus] ?? 0;
  const note = caseStatus === "clarification"
    ? "Your educator asked a question. Check your messages below."
    : current === 0
      ? "Start with the intake form above."
      : "There is nothing you need to do right now. We will show the plan here as soon as it is ready.";
  return { steps: labels.map((label, index) => ({ label, state: index < current ? "done" : index === current ? "current" : "upcoming" })), note };
}

// Whole-family day (#45, first slice): each learner's due lessons side by side, and the subjects that
// more than one child has today -- candidates to teach together. Suggestions only; nothing changes
// in anyone's plan.
export function familyDay(entries = []) {
  const byLearner = entries.map(({ learner, lessons }) => ({ learner, lessons }));
  const bySubject = new Map();
  for (const { learner, lessons } of byLearner) {
    for (const lesson of lessons) {
      if (!bySubject.has(lesson.subject)) bySubject.set(lesson.subject, new Set());
      bySubject.get(lesson.subject).add(learner.preferred_name);
    }
  }
  const shared = [...bySubject.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([subject, names]) => ({ subject, learners: [...names] }))
    .sort((a, b) => b.learners.length - a.learners.length || a.subject.localeCompare(b.subject));
  return { byLearner, shared };
}
