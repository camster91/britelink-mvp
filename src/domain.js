export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const WEEK_THEMES = [
  ["Patterns in our world", "Patterns"],
  ["Stories and point of view", "Perspective"],
  ["Habitats and adaptation", "Habitats"],
  ["Fractions in everyday life", "Fractions"],
  ["Communities and change", "Community"],
  ["Forces, motion and design", "Motion"],
  ["Measurement through making", "Measurement"],
  ["Reflection and celebration", "Reflection"],
];

const BLOCKS = [
  { time: "9:00", subject: "Mathematics", minutes: 35, adultHelp: "5–10 min" },
  { time: "9:50", subject: "Language", minutes: 45, adultHelp: "10 min" },
  { time: "11:00", subject: "Science & Social Studies", minutes: 40, adultHelp: "Check-in" },
  { time: "1:00", subject: "Independent project", minutes: 30, adultHelp: "Independent" },
];

export const LESSON_STATES = ["not_started", "in_progress", "paused", "completed", "skipped"];
export const SCHEDULE_REASONS = ["illness", "travel", "caregiver_schedule", "catch_up", "other"];

export function createDemoPlan() {
  return {
    id: "demo-plan-riley-2026-fall",
    learnerId: "demo-learner-riley",
    title: "Riley’s eight-week learning plan",
    grade: "Ontario Grade 4",
    version: 1,
    status: "demo_published",
    weeks: WEEK_THEMES.map(([theme, focus], weekIndex) => ({
      id: `week-${weekIndex + 1}`,
      number: weekIndex + 1,
      theme,
      days: DAYS.map((day, dayIndex) => ({
        id: `week-${weekIndex + 1}-day-${dayIndex + 1}`,
        label: day,
        dateLabel: `Day ${weekIndex * 5 + dayIndex + 1}`,
        lessons: BLOCKS.map((block, blockIndex) => ({
          id: `w${weekIndex + 1}-d${dayIndex + 1}-l${blockIndex + 1}`,
          ...block,
          title: lessonTitle(focus, block.subject, dayIndex),
          objective: `Use ${focus.toLowerCase()} to practise ${block.subject.toLowerCase()} through a clear, age-appropriate task.`,
          steps: ["Review the example", "Complete the guided task", "Record one thing you noticed"],
          materials: blockIndex === 3 ? ["Notebook", "Pencil", "Household materials"] : ["Plan workbook", "Pencil"],
          accommodation: "Short written directions with a visual example and an optional movement break.",
        })),
      })),
    })),
  };
}

function lessonTitle(focus, subject, dayIndex) {
  const actions = ["Notice", "Describe", "Compare", "Create", "Reflect on"];
  return `${actions[dayIndex]} ${focus.toLowerCase()} through ${subject.toLowerCase()}`;
}

export function updateLessonActivity(activity, lessonId, status, note = "") {
  if (!LESSON_STATES.includes(status)) throw new Error(`Unknown lesson status: ${status}`);
  return {
    ...activity,
    [lessonId]: {
      ...activity[lessonId],
      status,
      note,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function updateLessonSchedule(activity, lessonId, reason, scheduledFor) {
  if (!SCHEDULE_REASONS.includes(reason)) throw new Error(`Unknown schedule reason: ${reason}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) throw new Error("Choose a valid reschedule date");
  return {
    ...activity,
    [lessonId]: {
      status: "not_started",
      note: "",
      ...activity[lessonId],
      scheduleReason: reason,
      scheduledFor,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function getLessonStatus(activity, lessonId) {
  return activity[lessonId]?.status ?? "not_started";
}

export function calculateProgress(plan, activity) {
  const lessonIds = plan.weeks.flatMap((week) => week.days.flatMap((day) => day.lessons.map((lesson) => lesson.id)));
  const completed = lessonIds.filter((id) => getLessonStatus(activity, id) === "completed").length;
  return { completed, total: lessonIds.length, percent: lessonIds.length ? Math.round((completed / lessonIds.length) * 100) : 0 };
}

export function validateProfile(profile) {
  const errors = {};
  if (!profile.grade?.trim()) errors.grade = "Choose a grade level.";
  if (!profile.jurisdiction?.trim()) errors.jurisdiction = "Choose a curriculum jurisdiction.";
  if (!profile.interests?.trim()) errors.interests = "Tell the educator about at least one interest.";
  if (!profile.goals?.trim()) errors.goals = "Add at least one goal for the term.";
  if (!profile.guardianConsent) errors.guardianConsent = "Guardian consent is required before submitting an intake.";
  return errors;
}

export const DEMO_PROFILE = {
  learnerName: "Riley Morgan",
  grade: "Grade 4",
  jurisdiction: "Ontario",
  language: "English",
  preferredTime: "Morning, after breakfast",
  interests: "Animals, building things, drawing maps, and everyday machines.",
  goals: "Start work more independently and build confidence with longer reading assignments.",
  deviceAccess: "Shared laptop and printer",
  caregiverAvailability: "Short check-ins between work blocks",
  guardianConsent: false,
};

export const STORAGE_KEYS = {
  activity: "britelink-demo-activity-v2",
  profile: "britelink-demo-profile-v2",
};

export function safeParseStored(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
