import { useState } from "react";
import {
  activityMap,
  dueLessonsForToday,
  familyDay,
  latestPublishedPlan,
  orderedPlanWeeks,
  planDayDates,
} from "./authenticated-workspace.js";

// Whole-family day (#45, first slice): for households with more than one learner, today's lists
// side by side and the subjects they could do together. Loaded only when opened, so a one-child
// family and a closed panel cost nothing.
export function FamilyDay({ repository, householdId, learners, today }) {
  const [state, setState] = useState({ status: "idle", entries: [], error: null });
  const load = async () => {
    setState({ status: "loading", entries: [], error: null });
    try {
      const entries = await Promise.all(
        learners.map(async (learner) => {
          const [plans, activities] = await Promise.all([
            repository.loadPublishedPlans(householdId, learner.id),
            repository.listLessonActivities(householdId, learner.id),
          ]);
          const plan = latestPublishedPlan(plans);
          const weeks = orderedPlanWeeks(plan);
          const schedule = Array.isArray(plan?.plan_schedules) ? (plan.plan_schedules[0] ?? null) : (plan?.plan_schedules ?? null);
          return {
            learner,
            hasPlan: Boolean(plan),
            lessons: dueLessonsForToday(weeks, activityMap(activities), today, planDayDates(weeks, schedule), 5, schedule?.paused_subjects ?? []),
          };
        }),
      );
      setState({ status: "success", entries, error: null });
    } catch (error) {
      setState({ status: "error", entries: [], error: error.message });
    }
  };
  if (learners.length < 2) return null;
  const day = familyDay(state.entries);
  return (
    <details
      className="family-day"
      onToggle={(event) => {
        // Reload on every open: lessons may have been marked done since it was last shown.
        if (event.currentTarget.open && state.status !== "loading") load();
      }}
    >
      <summary>Whole family today</summary>
      <div>
        {state.status === "loading" ? <p role="status">Loading everyone’s day…</p> : null}
        {state.status === "error" ? (
          <p role="alert">
            {state.error}{" "}
            <button type="button" className="ghost" onClick={load}>
              Try again
            </button>
          </p>
        ) : null}
        {state.status === "success" ? (
          <>
            {day.shared.length ? (
              <p className="family-shared">
                Could do together today:{" "}
                {day.shared.map((item) => `${item.subject} (${item.learners.join(", ")})`).join("; ")}
              </p>
            ) : (
              <p className="family-shared">No subject overlaps today.</p>
            )}
            <div className="family-columns">
              {state.entries.map(({ learner, hasPlan, lessons }) => (
                <section key={learner.id} aria-label={`${learner.preferred_name}’s day`}>
                  <h3>{learner.preferred_name}</h3>
                  {!hasPlan ? (
                    <p>No published plan yet.</p>
                  ) : lessons.length ? (
                    <ul>
                      {lessons.map((lesson) => (
                        <li key={lesson.id}>
                          <span>{lesson.subject}</span> {lesson.title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Nothing due today.</p>
                  )}
                </section>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </details>
  );
}
