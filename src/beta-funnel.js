// Beta funnel summary (#53, #13) over rows from public.service_beta_funnel() (migration 051).
// Aggregates only: how many households reached each milestone, how many reached their first
// completed lesson without sending a message first, and median days to that first completion.
// Synthetic staging households are excluded unless asked for.

const DAY_MS = 24 * 60 * 60 * 1000;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const days = (from, to) => Math.round(((new Date(to) - new Date(from)) / DAY_MS) * 10) / 10;

export function summarizeBetaFunnel(rows = [], { includeSynthetic = false } = {}) {
  const households = rows.filter((row) => includeSynthetic || !row.synthetic);
  const reached = (field) => households.filter((row) => row[field]).length;
  const completed = households.filter((row) => row.first_completed_at);
  return {
    households: households.length,
    reached: {
      intakeSubmitted: reached("intake_submitted_at"),
      planPublished: reached("plan_published_at"),
      deliveryAcknowledged: reached("delivery_acknowledged_at"),
      firstLessonCompleted: completed.length,
    },
    // The beta's success measure: first completed lesson with no guardian message before it.
    firstLessonWithoutContacting: completed.filter((row) => Number(row.guardian_messages_before_first_completion) === 0).length,
    medianDaysToFirstLesson: median(completed.map((row) => days(row.created_at, row.first_completed_at))),
    medianDaysPublishedToFirstLesson: median(
      completed.filter((row) => row.plan_published_at).map((row) => days(row.plan_published_at, row.first_completed_at)),
    ),
  };
}
