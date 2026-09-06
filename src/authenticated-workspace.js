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

export function findNextPublishedLesson(weeks = [], activitiesByLessonId = {}) {
  for (const [weekIndex, week] of weeks.entries()) {
    for (const [dayIndex, day] of (week.plan_days ?? []).entries()) {
      for (const lesson of day.lessons ?? []) {
        const status = activitiesByLessonId[lesson.id]?.status ?? "not_started";
        if (status !== "completed" && status !== "skipped") {
          return { week, day, lesson, status, weekIndex, dayIndex };
        }
      }
    }
  }
  return null;
}
