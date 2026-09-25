// Configuration and the safety guard for the staging journey suite (#39). Kept separate from the
// browser script so the guard is unit-tested: this suite signs real accounts in and writes rows, so
// it must never be pointed at production.
export const PRODUCTION_HOSTS = ["britelink.ashbi.ca", "britelink-api.ashbi.ca"];

export function stagingJourneyConfig(env = process.env) {
  const problems = [];
  const read = (name) => {
    const value = env[name]?.trim();
    if (!value) problems.push(`${name} is not set`);
    return value ?? "";
  };
  const config = {
    environment: read("BRITELINK_TEST_ENVIRONMENT"),
    appUrl: read("BRITELINK_STAGING_APP_URL"),
    supabaseUrl: read("BRITELINK_SUPABASE_URL"),
    serviceRoleKey: read("BRITELINK_STAGING_SERVICE_ROLE_KEY"),
    guardianUserId: read("BRITELINK_TEST_GUARDIAN_A_USER_ID"),
    educatorUserId: read("BRITELINK_TEST_EDUCATOR_A_USER_ID"),
    householdId: read("BRITELINK_TEST_HOUSEHOLD_A_ID"),
  };
  if (config.environment && config.environment !== "staging") problems.push("BRITELINK_TEST_ENVIRONMENT must be exactly 'staging'");
  for (const key of ["appUrl", "supabaseUrl"]) {
    if (!config[key]) continue;
    let url;
    try { url = new URL(config[key]); } catch { problems.push(`${key} is not a URL`); continue; }
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) problems.push(`${key} must use https`);
    if (PRODUCTION_HOSTS.includes(url.hostname)) problems.push(`${key} points at production (${url.hostname}); this suite writes data and only runs against staging`);
  }
  if (problems.length) {
    const error = new Error(`Refusing to run the staging journey suite:\n- ${problems.join("\n- ")}`);
    error.problems = problems;
    throw error;
  }
  return config;
}
