const PRIVATE_TABLES = [
  "memberships",
  "learners",
  "guardian_consents",
  "learner_profiles",
  "service_cases",
  "plans",
  "plan_weeks",
  "plan_days",
  "lessons",
  "lesson_activities",
  "audit_events",
  "orders",
  "payment_events",
  "operation_rate_windows",
  "operational_events",
  "deletion_jobs",
  "educator_capacities",
  "case_messages",
  "case_message_reads",
  "case_attachments",
  "plan_reviews",
  "resources",
  "deliveries",
  "revision_requests",
  "privacy_requests",
];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${label} is required`);
  return value.trim();
}

function householdId(value, label) {
  const id = required(value, label);
  if (!UUID.test(id)) throw new TypeError(`${label} must be a UUID`);
  return id;
}

function baseUrl(value) {
  const url = new URL(required(value, "Supabase URL"));
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new TypeError("Supabase URL must use HTTPS");
  return url;
}

async function json(response, label) {
  if (!response.ok)
    throw new Error(`${label} failed with HTTP ${response.status}`);
  const value = await response.json();
  if (!Array.isArray(value))
    throw new Error(`${label} returned an invalid response`);
  return value;
}

function headers(apiKey, token) {
  return { apikey: apiKey, authorization: `Bearer ${token}` };
}

export { PRIVATE_TABLES };

export async function verifyHostedIsolation({
  environment,
  supabaseUrl,
  apiKey,
  householdA,
  householdB,
  tokenA,
  tokenB,
  bucket = "case-attachments",
  fetchImpl = globalThis.fetch,
}) {
  if (required(environment, "Test environment") !== "staging")
    throw new TypeError("Hosted isolation check is staging-only");
  const origin = baseUrl(supabaseUrl);
  const key = required(apiKey, "Supabase public API key");
  const a = householdId(householdA, "Household A ID");
  const b = householdId(householdB, "Household B ID");
  const jwtA = required(tokenA, "Household A access token");
  const jwtB = required(tokenB, "Household B access token");
  const bucketName = required(bucket, "Storage bucket");
  if (a === b) throw new TypeError("Two distinct households are required");
  if (jwtA === jwtB)
    throw new TypeError("Two distinct access tokens are required");
  if (typeof fetchImpl !== "function")
    throw new TypeError("Fetch implementation is required");

  const checks = [];
  for (const table of PRIVATE_TABLES) {
    for (const [actor, token, ownHousehold, foreignHousehold] of [
      ["A", jwtA, a, b],
      ["B", jwtB, b, a],
    ]) {
      const ownUrl = new URL(`/rest/v1/${table}`, origin);
      ownUrl.searchParams.set("select", "household_id");
      ownUrl.searchParams.set("household_id", `eq.${ownHousehold}`);
      ownUrl.searchParams.set("limit", "1");
      const ownRows = await json(
        await fetchImpl(ownUrl, {
          headers: headers(key, token),
          signal: AbortSignal.timeout(10000),
        }),
        `${table} own-household control for actor ${actor}`,
      );
      if (!ownRows.length)
        throw new Error(
          `${table} has no visible own-household sentinel for actor ${actor}`,
        );
      checks.push({ surface: `table:${table}`, actor, ownVisible: true });

      const url = new URL(`/rest/v1/${table}`, origin);
      url.searchParams.set("select", "household_id");
      url.searchParams.set("household_id", `eq.${foreignHousehold}`);
      url.searchParams.set("limit", "1");
      const rows = await json(
        await fetchImpl(url, {
          headers: headers(key, token),
          signal: AbortSignal.timeout(10000),
        }),
        `${table} cross-household read for actor ${actor}`,
      );
      if (rows.length)
        throw new Error(
          `${table} leaked cross-household rows to actor ${actor}`,
        );
      checks.push({ surface: `table:${table}`, actor, denied: true });
    }
  }

  for (const [actor, token, ownHousehold, foreignHousehold] of [
    ["A", jwtA, a, b],
    ["B", jwtB, b, a],
  ]) {
    const storageUrl = new URL(`/storage/v1/object/list/${bucketName}`, origin);
    const ownRows = await json(
      await fetchImpl(storageUrl, {
        method: "POST",
        headers: {
          ...headers(key, token),
          "content-type": "application/json",
        },
        body: JSON.stringify({ prefix: `${ownHousehold}/`, limit: 1 }),
        signal: AbortSignal.timeout(10000),
      }),
      `storage own-household control for actor ${actor}`,
    );
    if (!ownRows.length)
      throw new Error(
        `Storage has no visible own-household sentinel for actor ${actor}`,
      );
    checks.push({ surface: `bucket:${bucketName}`, actor, ownVisible: true });

    const rows = await json(
      await fetchImpl(storageUrl, {
        method: "POST",
        headers: {
          ...headers(key, token),
          "content-type": "application/json",
        },
        body: JSON.stringify({ prefix: `${foreignHousehold}/`, limit: 1 }),
        signal: AbortSignal.timeout(10000),
      }),
      `storage cross-household list for actor ${actor}`,
    );
    if (rows.length)
      throw new Error(
        `Storage leaked cross-household objects to actor ${actor}`,
      );
    checks.push({ surface: `bucket:${bucketName}`, actor, denied: true });
  }

  return {
    status: "passed",
    tableCount: PRIVATE_TABLES.length,
    checkCount: checks.length,
    storageBucket: bucketName,
    checks,
  };
}
