import { verifyHostedIsolation } from "../src/hosted-isolation.js";

try {
  const report = await verifyHostedIsolation({
    environment: process.env.BRITELINK_TEST_ENVIRONMENT,
    supabaseUrl: process.env.BRITELINK_SUPABASE_URL,
    apiKey: process.env.BRITELINK_SUPABASE_ANON_KEY,
    householdA: process.env.BRITELINK_TEST_HOUSEHOLD_A_ID,
    householdB: process.env.BRITELINK_TEST_HOUSEHOLD_B_ID,
    tokenA: process.env.BRITELINK_TEST_ADMIN_A_JWT,
    tokenB: process.env.BRITELINK_TEST_ADMIN_B_JWT,
  });
  process.stdout.write(
    `${JSON.stringify({
      checked_at: new Date().toISOString(),
      status: report.status,
      table_count: report.tableCount,
      check_count: report.checkCount,
      storage_bucket: report.storageBucket,
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: "isolation_check_failed",
      message:
        error instanceof Error ? error.message : "Unknown isolation error",
    })}\n`,
  );
  process.exitCode = 2;
}
