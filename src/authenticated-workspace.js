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

// The next honest action for today. A lesson moved to a later date is not "next" until that date,
// so it is skipped; lessons moved to today or earlier stay in plan order with everything else.
// When every unfinished lesson has been moved ahead, say when work resumes -- never report the
// plan as finished while moved work remains.
//   { kind: "due", week, day, lesson, status, weekIndex, dayIndex }
//   { kind: "later", resumesOn, week, day, lesson, status, weekIndex, dayIndex }  earliest moved lesson
//   { kind: "done" }
export function nextLessonForToday(weeks = [], activitiesByLessonId = {}, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) throw new TypeError("today must be a YYYY-MM-DD date");
  let later = null;
  for (const [weekIndex, week] of weeks.entries()) {
    for (const [dayIndex, day] of (week.plan_days ?? []).entries()) {
      for (const lesson of day.lessons ?? []) {
        const activity = activitiesByLessonId[lesson.id];
        const status = activity?.status ?? "not_started";
        if (status === "completed" || status === "skipped") continue;
        const entry = { week, day, lesson, status, weekIndex, dayIndex };
        const movedTo = activity?.scheduled_for ?? null;
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
