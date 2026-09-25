import { useId } from "react";

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const list = (items) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// The weekly story (#43): what happened this week, told plainly. Evidence without judgement --
// no percentages, no red/green, no "behind" -- per BUILD-PRIORITIES' "never use anxiety as retention".
export function WeeklyStory({ learnerName, story, offsetWeeks, onOffset, notes = [], report = null }) {
  const headingId = useId();
  const title =
    offsetWeeks === 0 ? "This week" : offsetWeeks === -1 ? "Last week" : `Week of ${story.start}`;
  const educatorNote = notes.find((item) => item.week_start === story.start)?.note ?? "";
  const parts = [];
  if (story.completed.length) parts.push(`${plural(story.completed.length, "lesson")} done`);
  if (story.notes.length) parts.push(`${plural(story.notes.length, "note")} from outside the plan`);
  return (
    <section className="weekly-story" aria-labelledby={headingId}>
      <header>
        <div>
          <span className="eyebrow">{learnerName}’s learning record</span>
          <h2 id={headingId}>{title}</h2>
          <small>
            {story.start} to {story.end}
          </small>
        </div>
        <div className="weekly-story-nav">
          <button type="button" className="ghost" onClick={() => onOffset(offsetWeeks - 1)}>
            Previous week
          </button>
          <button
            type="button"
            className="ghost"
            disabled={offsetWeeks >= 0}
            onClick={() => onOffset(Math.min(0, offsetWeeks + 1))}
          >
            Next week
          </button>
        </div>
      </header>
      {story.isEmpty ? (
        <p className="weekly-story-lead">
          Nothing recorded for this week yet.
          {offsetWeeks === 0
            ? " Learning outside the plan counts too; you can add it below."
            : ""}
        </p>
      ) : (
        <p className="weekly-story-lead">
          {parts.join(", ")}
          {story.subjects.length ? `, across ${list(story.subjects)}.` : "."}
        </p>
      )}
      {educatorNote ? (
        <blockquote className="weekly-educator-note">
          <h3>A note from your educator</h3>
          <p>{educatorNote}</p>
        </blockquote>
      ) : null}
      {story.completed.length ? (
        <>
          <h3>Lessons done</h3>
          <ul>
            {story.completed.map((item) => (
              <li key={item.id}>
                {item.subject}: {item.title}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {story.notes.length ? (
        <>
          <h3>Outside the plan</h3>
          <ul>
            {story.notes.map((item) => (
              <li key={item.id ?? `${item.captured_on}-${item.note}`}>
                {item.captured_on}: {item.note}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {story.daysOff.length || story.moved ? (
        <p className="weekly-story-rhythm">
          {[
            story.daysOff.length ? `Took ${plural(story.daysOff.length, "day")} off.` : "",
            story.moved ? `${plural(story.moved, "lesson")} moved to later in the week.` : "",
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
      {report}
    </section>
  );
}
