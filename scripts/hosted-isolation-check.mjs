// Hosted staging isolation evidence, in two parts.
//
//   read isolation   every private table, both directions, plus bucket listing (D1)
//   mutation denial  every cross-household write, forged insert, and bucket write (D2)
//
// Exit codes are load-bearing. This is release evidence, so "we could not check" must never be
// recorded as "we checked and it was clean":
//
//   0  every configured check passed
//   2  a check failed
//   3  the read check passed but the mutation matrix could not run for lack of configuration
//
// Nothing here is safe to point at production: src/hosted-isolation.js refuses any environment
// other than "staging".
import {
  verifyHostedIsolation,
  verifyHostedMutationDenial,
} from "../src/hosted-isolation.js";

const env = process.env;

// The mutation matrix needs far more of staging than the read check: three household A actors
// proved to hold three different roles, household B's admin for the storage control, and one
// real row id per surface.
const MUTATION_ENV = {
  guardianTokenA: "BRITELINK_TEST_GUARDIAN_A_JWT",
  guardianUserIdA: "BRITELINK_TEST_GUARDIAN_A_USER_ID",
  educatorTokenA: "BRITELINK_TEST_EDUCATOR_A_JWT",
  educatorUserIdA: "BRITELINK_TEST_EDUCATOR_A_USER_ID",
  adminTokenA: "BRITELINK_TEST_ADMIN_A_JWT",
  adminUserIdA: "BRITELINK_TEST_ADMIN_A_USER_ID",
  adminTokenB: "BRITELINK_TEST_ADMIN_B_JWT",
  caseId: "BRITELINK_TEST_HOUSEHOLD_B_CASE_ID",
  planId: "BRITELINK_TEST_HOUSEHOLD_B_PLAN_ID",
  lessonId: "BRITELINK_TEST_HOUSEHOLD_B_LESSON_ID",
  activityId: "BRITELINK_TEST_HOUSEHOLD_B_ACTIVITY_ID",
  messageId: "BRITELINK_TEST_HOUSEHOLD_B_MESSAGE_ID",
  deliveryId: "BRITELINK_TEST_HOUSEHOLD_B_DELIVERY_ID",
  revisionId: "BRITELINK_TEST_HOUSEHOLD_B_REVISION_ID",
  attachmentId: "BRITELINK_TEST_HOUSEHOLD_B_ATTACHMENT_ID",
  consentId: "BRITELINK_TEST_HOUSEHOLD_B_CONSENT_ID",
  learnerId: "BRITELINK_TEST_HOUSEHOLD_B_LEARNER_ID",
  objectPath: "BRITELINK_TEST_HOUSEHOLD_B_OBJECT_PATH",
};

function emit(summary) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function main() {
  const summary = { checked_at: new Date().toISOString() };
  const shared = {
    environment: env.BRITELINK_TEST_ENVIRONMENT,
    supabaseUrl: env.BRITELINK_SUPABASE_URL,
    apiKey: env.BRITELINK_SUPABASE_ANON_KEY,
    householdA: env.BRITELINK_TEST_HOUSEHOLD_A_ID,
    householdB: env.BRITELINK_TEST_HOUSEHOLD_B_ID,
  };

  try {
    const read = await verifyHostedIsolation({
      ...shared,
      tokenA: env.BRITELINK_TEST_ADMIN_A_JWT,
      tokenB: env.BRITELINK_TEST_ADMIN_B_JWT,
    });
    summary.read_isolation = {
      status: read.status,
      table_count: read.tableCount,
      check_count: read.checkCount,
      storage_bucket: read.storageBucket,
    };
  } catch (error) {
    emit({
      ...summary,
      status: "isolation_check_failed",
      stage: "read_isolation",
      message:
        error instanceof Error ? error.message : "Unknown isolation error",
    });
    return 2;
  }

  const missing = Object.values(MUTATION_ENV).filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length) {
    emit({
      ...summary,
      status: "mutation_matrix_not_run",
      mutation_denial: null,
      missing_configuration: missing,
      message:
        "The read check passed. The mutation matrix did not run, so it is not evidence of anything. Set the variables above and run this again before recording hosted mutation denial against the release.",
    });
    return 3;
  }

  try {
    const mutation = await verifyHostedMutationDenial({
      ...shared,
      bucket: env.BRITELINK_TEST_ATTACHMENT_BUCKET || "case-attachments",
      actors: {
        guardian: {
          token: env[MUTATION_ENV.guardianTokenA],
          userId: env[MUTATION_ENV.guardianUserIdA],
        },
        educator: {
          token: env[MUTATION_ENV.educatorTokenA],
          userId: env[MUTATION_ENV.educatorUserIdA],
        },
        admin: {
          token: env[MUTATION_ENV.adminTokenA],
          userId: env[MUTATION_ENV.adminUserIdA],
        },
      },
      adminTokenB: env[MUTATION_ENV.adminTokenB],
      foreign: {
        caseId: env[MUTATION_ENV.caseId],
        planId: env[MUTATION_ENV.planId],
        lessonId: env[MUTATION_ENV.lessonId],
        activityId: env[MUTATION_ENV.activityId],
        messageId: env[MUTATION_ENV.messageId],
        deliveryId: env[MUTATION_ENV.deliveryId],
        revisionId: env[MUTATION_ENV.revisionId],
        attachmentId: env[MUTATION_ENV.attachmentId],
        consentId: env[MUTATION_ENV.consentId],
        learnerId: env[MUTATION_ENV.learnerId],
        objectPath: env[MUTATION_ENV.objectPath],
      },
    });
    emit({
      ...summary,
      mutation_denial: mutation,
      status: "passed",
      message: `${mutation.deniedCount} cross-household mutations denied across ${mutation.probeCount} probes, behind ${mutation.controlCount} passed controls.`,
    });
    return 0;
  } catch (error) {
    // The dated report is the deliverable, so a failed run still publishes the evidence it has.
    emit({
      ...summary,
      status: "mutation_matrix_failed",
      mutation_denial: error?.report ?? null,
      message:
        error instanceof Error ? error.message : "Unknown mutation matrix error",
    });
    return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    emit({
      checked_at: new Date().toISOString(),
      status: "isolation_check_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    process.exitCode = 2;
  });
