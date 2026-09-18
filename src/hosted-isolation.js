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

// ---------------------------------------------------------------------------
// The hosted mutation-denial matrix
//
// docs/HOSTED_STAGING_VERIFICATION.md is explicit that the verifier above covers reads only.
// This is the write half: every surface on which household A's guardian, educator, or admin
// could reach household B, plus the forged-attribution inserts, the lesson-activity write, and
// the bucket.
//
// Two properties make this discriminating rather than merely green:
//
// 1. Every probe must fail for an AUTHORIZATION reason, not merely fail. A validation error
//    raised before the role check looks identical from the outside -- same HTTP status, same
//    opaque shape -- so an RPC probe only counts as denied when the error message is one of
//    the four authorization messages the migrations actually raise. Anything else is
//    INCONCLUSIVE, and inconclusive fails the gate. Without this, a probe with a misspelled
//    argument name would read as a passing cross-household denial.
// 2. Every actor must be proved to hold the role it claims before its probes run. A guardian
//    token belonging to an unrelated account would deny every probe with "guardian access
//    required" -- for entirely the wrong reason -- and the matrix would pass while proving
//    nothing.
// ---------------------------------------------------------------------------

const AUTHORIZATION_MESSAGES = [
  "household membership required",
  "guardian access required",
  "staff access required",
  "admin access required",
];

// Codes that mean the probe never reached an authorization decision. Note how many of them a
// naive implementation would read as "denied":
//   PGRST202  no function matches this name and argument-name set -- a typo, not a denial
//   42883     function does not exist
//   PGRST204, 42703  unknown column, so the probe body is malformed
//   42P01     relation does not exist
//   23502     not-null violation. Postgres can report a constraint failure before RLS
//             WITH CHECK, so it does not prove the insert would otherwise have been allowed
//   23503, 23505, 23514, 22P02, 22023  foreign key, unique, check, and cast failures, by the
//             same reasoning as 23502
const INCONCLUSIVE_CODES = new Set([
  "PGRST100",
  "PGRST102",
  "PGRST202",
  "PGRST204",
  "PGRST300",
  "42P01",
  "42703",
  "42883",
  "22P02",
  "22023",
  "23502",
  "23503",
  "23505",
  "23514",
]);

// What the matrix assumes about the staging fixtures it is pointed at. These cannot be checked
// from here, and each one silently weakens a probe if it is false, so they are reported
// alongside the evidence rather than left implicit.
const MUTATION_ASSUMPTIONS = [
  "every id in `foreign` refers to a row that exists in household B",
  "the activity id used for the no-effect probe refers to a row that exists, or '0 rows affected' proves nothing",
  "the object path used for the storage probes exists in the bucket, which the household B sign control confirms",
  "the matrix proves each denial is household-specific given the actor's role; it does not prove the same RPC succeeds on the actor's own household, which would require writing to staging",
];

// RPC probes, declared as contracts so tests/hosted-isolation.test.mjs can hold them to the
// migrations: each argument name is checked against the SQL, each gate message against
// AUTHORIZATION_MESSAGES, and each `values` result against its own `args` list.
export const MUTATION_RPC_CONTRACTS = [
  {
    id: "guardian.send_case_message",
    actor: "guardian",
    requirement: "a guardian cannot message another household's case",
    args: ["target_household", "target_case", "message_kind", "message_body"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_case: ctx.foreign.caseId,
      message_kind: "general",
      message_body: PROBE_NOTE,
    }),
  },
  {
    id: "guardian.submit_intake",
    actor: "guardian",
    requirement: "a guardian cannot submit intake into another household",
    args: [
      "target_household",
      "target_learner",
      "notice_version",
      "consent_purposes",
      "context",
    ],
    // consent_purposes must be exactly ['personalized_learning_plan']: the RPC raises 22023
    // for anything else, and a validation error is not evidence of isolation.
    values: (ctx) => ({
      target_household: ctx.b,
      target_learner: ctx.foreign.learnerId,
      notice_version: "staging-isolation-probe",
      consent_purposes: ["personalized_learning_plan"],
      context: {},
    }),
  },
  {
    id: "guardian.export_household",
    actor: "guardian",
    requirement: "a guardian cannot export another household",
    args: ["target_household"],
    values: (ctx) => ({ target_household: ctx.b }),
  },
  {
    id: "guardian.request_deletion",
    actor: "guardian",
    requirement: "a guardian cannot request deletion for another household",
    args: ["target_household", "request_reason"],
    values: (ctx) => ({ target_household: ctx.b, request_reason: PROBE_NOTE }),
  },
  {
    id: "guardian.withdraw_consent",
    actor: "guardian",
    requirement: "a guardian cannot withdraw another household's consent",
    args: ["target_household", "target_consent"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_consent: ctx.foreign.consentId,
    }),
  },
  {
    id: "guardian.request_revision",
    actor: "guardian",
    requirement: "a guardian cannot request a revision on another household's case",
    args: ["target_household", "target_case", "request_reason"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_case: ctx.foreign.caseId,
      request_reason: PROBE_NOTE,
    }),
  },
  {
    id: "guardian.acknowledge_delivery",
    actor: "guardian",
    requirement: "a guardian cannot acknowledge another household's delivery",
    args: ["target_household", "target_delivery"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_delivery: ctx.foreign.deliveryId,
    }),
  },
  {
    id: "guardian.create_attachment_upload",
    actor: "guardian",
    requirement: "a guardian cannot open an upload slot on another household's message",
    args: [
      "target_household",
      "target_message",
      "attachment_file_name",
      "attachment_mime_type",
      "attachment_size_bytes",
    ],
    values: (ctx) => ({
      target_household: ctx.b,
      target_message: ctx.foreign.messageId,
      attachment_file_name: "isolation-probe.txt",
      attachment_mime_type: "text/plain",
      attachment_size_bytes: 32,
    }),
  },
  {
    id: "guardian.complete_attachment_upload",
    actor: "guardian",
    requirement: "a guardian cannot complete another household's attachment upload",
    args: [
      "target_household",
      "target_attachment",
      "content_sha256",
      "upload_succeeded",
    ],
    values: (ctx) => ({
      target_household: ctx.b,
      target_attachment: ctx.foreign.attachmentId,
      content_sha256: "a".repeat(64),
      upload_succeeded: true,
    }),
  },
  {
    id: "guardian.retry_attachment_upload",
    actor: "guardian",
    requirement: "a guardian cannot retry another household's attachment upload",
    args: ["target_household", "target_attachment"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_attachment: ctx.foreign.attachmentId,
    }),
  },
  {
    id: "educator.transition_case",
    actor: "educator",
    requirement: "an educator cannot transition another household's case",
    args: ["target_household", "target_case", "next_status", "transition_reason"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_case: ctx.foreign.caseId,
      next_status: "triage",
      transition_reason: PROBE_NOTE,
    }),
  },
  {
    id: "educator.author_plan_version",
    actor: "educator",
    requirement: "an educator cannot author a plan version for another household",
    args: ["target_household", "target_case", "plan_document"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_case: ctx.foreign.caseId,
      plan_document: { weeks: [] },
    }),
  },
  {
    id: "educator.add_plan_resource",
    actor: "educator",
    requirement: "an educator cannot attach a resource to another household's lesson",
    args: ["target_household", "target_plan", "target_lesson", "resource_document"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_plan: ctx.foreign.planId,
      target_lesson: ctx.foreign.lessonId,
      resource_document: {
        title: "isolation probe",
        url: "https://example.invalid/isolation-probe",
        accessType: "included",
        requirement: "required",
      },
    }),
  },
  {
    id: "educator.review_plan",
    actor: "educator",
    requirement: "an educator cannot sign off another household's plan review",
    args: [
      "target_household",
      "target_plan",
      "curriculum_checked",
      "safeguarding_checked",
      "accessibility_checked",
      "resource_rights_checked",
      "review_notes",
    ],
    values: (ctx) => ({
      target_household: ctx.b,
      target_plan: ctx.foreign.planId,
      curriculum_checked: true,
      safeguarding_checked: true,
      accessibility_checked: true,
      resource_rights_checked: true,
      review_notes: PROBE_NOTE,
    }),
  },
  {
    id: "educator.record_delivery",
    actor: "educator",
    requirement: "an educator cannot deliver another household's plan",
    args: ["target_household", "target_case", "delivery_channel"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_case: ctx.foreign.caseId,
      delivery_channel: "secure_portal",
    }),
  },
  {
    id: "educator.message_case",
    actor: "educator",
    requirement: "an educator cannot message another household's case",
    args: ["target_household", "target_case", "message_kind", "message_body"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_case: ctx.foreign.caseId,
      message_kind: "service",
      message_body: PROBE_NOTE,
    }),
  },
  {
    id: "educator.decide_revision",
    actor: "educator",
    requirement: "an educator cannot decide another household's revision request",
    args: ["target_household", "target_revision", "decision", "decision_reason"],
    values: (ctx) => ({
      target_household: ctx.b,
      target_revision: ctx.foreign.revisionId,
      decision: "accepted",
      decision_reason: null,
    }),
  },
  {
    id: "admin.assign_case",
    actor: "admin",
    requirement: "an admin cannot assign staff to another household's case",
    args: ["target_household", "target_case", "target_educator"],
    // Run as household A's admin, assigning household A's own educator. Both facts matter: an
    // educator token would be denied for lacking the admin role at all, which says nothing
    // about household isolation.
    values: (ctx) => ({
      target_household: ctx.b,
      target_case: ctx.foreign.caseId,
      target_educator: ctx.educator.userId,
    }),
  },
];

// The RPC each contract calls. A contract's id is `actor.label` for reporting, and the label is
// deliberately not the function name: send_case_message is probed twice, as
// guardian.send_case_message and educator.send_case_message, because the guardian and staff
// paths reach it differently. Deriving the URL from the id would have sent every probe to a
// function that does not exist, which PostgREST answers with PGRST202 -- indistinguishable from
// a denial to anything that only checks the status code.
export const MUTATION_RPC_BY_ID = {
  "guardian.send_case_message": "send_case_message",
  "guardian.submit_intake": "submit_guardian_intake",
  "guardian.export_household": "export_guardian_household",
  "guardian.request_deletion": "request_guardian_household_deletion",
  "guardian.withdraw_consent": "withdraw_guardian_consent",
  "guardian.request_revision": "request_guardian_revision",
  "guardian.acknowledge_delivery": "acknowledge_guardian_delivery",
  "guardian.create_attachment_upload": "create_message_attachment_upload",
  "guardian.complete_attachment_upload": "complete_message_attachment_upload",
  "guardian.retry_attachment_upload": "retry_message_attachment_upload",
  "educator.transition_case": "staff_transition_case",
  "educator.author_plan_version": "staff_create_plan_version",
  "educator.add_plan_resource": "staff_add_plan_resource",
  "educator.review_plan": "staff_review_plan",
  "educator.record_delivery": "staff_record_delivery",
  "educator.message_case": "send_case_message",
  "educator.decide_revision": "staff_decide_revision",
  "admin.assign_case": "staff_assign_case",
};

const PROBE_NOTE = "isolation probe - no client content";

function errorField(body, field) {
  if (body && typeof body === "object" && !Array.isArray(body))
    return String(body[field] ?? "");
  return "";
}

function describeError(body) {
  const code = errorField(body, "code");
  const message =
    errorField(body, "message") || errorField(body, "error") || errorField(body, "msg");
  return [code && `[${code}]`, message].filter(Boolean).join(" ").slice(0, 200);
}

async function sendProbe(fetchImpl, url, options) {
  const response = await fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Storage denials are not always JSON; keeping the raw text is what makes the detail useful.
  }
  return { status: response.status, ok: response.ok, body, text };
}

function judgeRpc(result) {
  const message = (
    errorField(result.body, "message") ||
    errorField(result.body, "error") ||
    ""
  ).toLowerCase();
  const authorization = AUTHORIZATION_MESSAGES.find((entry) =>
    message.includes(entry),
  );
  if (authorization) return { outcome: "denied", detail: authorization };
  if (result.status === 401)
    return { outcome: "denied", detail: "unauthenticated" };
  if (result.status >= 200 && result.status < 300)
    return {
      outcome: "allowed",
      detail: `RPC returned HTTP ${result.status}, so the mutation was accepted`,
    };
  return {
    outcome: "inconclusive",
    detail: `HTTP ${result.status} was not an authorization denial: ${describeError(result.body) || "no error detail"}`,
  };
}

function judgeInsert(result) {
  const code = errorField(result.body, "code");
  if (result.status === 401 || result.status === 403 || code === "42501")
    return {
      outcome: "denied",
      detail: describeError(result.body) || `HTTP ${result.status}`,
    };
  if (result.status >= 200 && result.status < 300)
    return {
      outcome: "allowed",
      detail: `insert returned HTTP ${result.status}, so the row was written`,
    };
  // Everything else, including every constraint failure, is inconclusive rather than denied.
  return {
    outcome: "inconclusive",
    detail: `HTTP ${result.status} was not an authorization denial: ${describeError(result.body) || "no error detail"}`,
  };
}

function judgeNoEffect(result) {
  if (result.status === 401 || result.status === 403)
    return { outcome: "denied", detail: `HTTP ${result.status}` };
  if (result.status >= 200 && result.status < 300) {
    const rows = Array.isArray(result.body) ? result.body : [];
    return rows.length
      ? {
          outcome: "allowed",
          detail: `updated ${rows.length} row(s) belonging to the other household`,
        }
      : { outcome: "denied", detail: "0 rows affected" };
  }
  return {
    outcome: "inconclusive",
    detail: `HTTP ${result.status}: ${describeError(result.body) || "no error detail"}`,
  };
}

function judgeStorage(result) {
  // 404 counts as denied here only because the household B sign control proves the object
  // exists and the request shape is right. Without that control a 404 would be uninformative.
  if ([400, 403, 404].includes(result.status))
    return {
      outcome: "denied",
      detail: describeError(result.body) || `HTTP ${result.status}`,
    };
  if (result.status >= 200 && result.status < 300)
    return {
      outcome: "allowed",
      detail: `storage returned HTTP ${result.status}, so access was granted`,
    };
  return {
    outcome: "inconclusive",
    detail: `HTTP ${result.status}: ${describeError(result.body) || "no error detail"}`,
  };
}

export async function verifyHostedMutationDenial({
  environment,
  supabaseUrl,
  apiKey,
  householdA,
  householdB,
  actors,
  adminTokenB,
  foreign = {},
  bucket = "case-attachments",
  fetchImpl = globalThis.fetch,
}) {
  if (required(environment, "Test environment") !== "staging")
    throw new TypeError("Hosted isolation check is staging-only");
  const origin = baseUrl(supabaseUrl);
  const key = required(apiKey, "Supabase public API key");
  const a = householdId(householdA, "Household A ID");
  const b = householdId(householdB, "Household B ID");
  if (a === b) throw new TypeError("Two distinct households are required");
  const bucketName = required(bucket, "Storage bucket");
  if (typeof fetchImpl !== "function")
    throw new TypeError("Fetch implementation is required");

  if (!actors || typeof actors !== "object")
    throw new TypeError("Three household A actors are required");
  const roles = [
    ["guardian", "guardian"],
    ["educator", "educator"],
    ["admin", "admin"],
  ];
  const resolved = {};
  for (const [name, role] of roles) {
    const actor = actors[name];
    if (!actor || typeof actor !== "object")
      throw new TypeError(`Household A ${name} actor is required`);
    resolved[name] = {
      role,
      token: required(actor.token, `Household A ${name} access token`),
      userId: householdId(actor.userId, `Household A ${name} user ID`),
    };
  }
  const tokens = roles.map(([name]) => resolved[name].token);
  if (new Set(tokens).size !== tokens.length)
    throw new TypeError("Each household A actor needs a distinct access token");
  const userIds = roles.map(([name]) => resolved[name].userId);
  if (new Set(userIds).size !== userIds.length)
    throw new TypeError("Each household A actor needs a distinct user ID");
  const tokenB = required(adminTokenB, "Household B admin access token");
  if (tokens.includes(tokenB))
    throw new TypeError("Household B needs a token distinct from household A's");

  const ids = {
    caseId: "case",
    planId: "plan",
    lessonId: "lesson",
    activityId: "activity",
    messageId: "message",
    deliveryId: "delivery",
    revisionId: "revision",
    attachmentId: "attachment",
    consentId: "consent",
    learnerId: "learner",
  };
  for (const [field, label] of Object.entries(ids))
    householdId(foreign[field], `Household B ${label} ID`);
  const objectPath = required(foreign.objectPath, "Household B object path");
  if (!objectPath.startsWith(`${b}/`))
    throw new TypeError(
      "The cross-household object path must sit under household B's prefix",
    );

  const ctx = { a, b, foreign, ...resolved };
  const jsonHeaders = (token) => ({
    ...headers(key, token),
    "content-type": "application/json",
  });

  const controls = [];
  for (const [name] of roles) {
    const actor = resolved[name];
    const url = new URL("/rest/v1/memberships", origin);
    url.searchParams.set("household_id", `eq.${a}`);
    url.searchParams.set("user_id", `eq.${actor.userId}`);
    url.searchParams.set("select", "role");
    const result = await sendProbe(fetchImpl, url, {
      headers: headers(key, actor.token),
    });
    const rows = Array.isArray(result.body) ? result.body : [];
    if (result.status !== 200 || !rows.some((row) => row.role === actor.role))
      throw new Error(
        `Household A ${name} control failed: the token does not hold the ${actor.role} role in household A (HTTP ${result.status}${describeError(result.body) ? `, ${describeError(result.body)}` : ""}), so every probe below would deny for the wrong reason`,
      );
    controls.push({ surface: `actor:${name}`, outcome: "confirmed" });
  }

  const signUrl = new URL(
    `/storage/v1/object/sign/${bucketName}/${objectPath}`,
    origin,
  );
  const signResult = await sendProbe(fetchImpl, signUrl, {
    method: "POST",
    headers: jsonHeaders(tokenB),
    body: JSON.stringify({ expiresIn: 60 }),
  });
  if (signResult.status < 200 || signResult.status >= 300)
    throw new Error(
      `Household B storage control failed: household B cannot sign its own object (HTTP ${signResult.status}${describeError(signResult.body) ? `, ${describeError(signResult.body)}` : ""}), so the cross-household storage denials below prove nothing`,
    );
  controls.push({ surface: "bucket:household-b-control", outcome: "confirmed" });

  const probes = [];
  for (const contract of MUTATION_RPC_CONTRACTS) {
    const actor = resolved[contract.actor];
    const rpc = MUTATION_RPC_BY_ID[contract.id];
    if (!rpc)
      throw new Error(
        `No RPC is mapped for contract ${contract.id}, so the probe cannot be addressed`,
      );
    probes.push({
      id: contract.id,
      surface: `rpc:${rpc}`,
      requirement: contract.requirement,
      actor: contract.actor,
      judge: judgeRpc,
      url: new URL(`/rest/v1/rpc/${rpc}`, origin),
      options: {
        method: "POST",
        headers: jsonHeaders(actor.token),
        body: JSON.stringify(contract.values(ctx)),
      },
    });
  }

  // Forged-attribution inserts. Every NOT NULL column is supplied so a not-null violation
  // cannot be mistaken for a denial -- which is exactly what leaving them out would produce.
  const forgedInserts = [
    {
      id: "insert.memberships",
      surface: "table:memberships",
      requirement:
        "a guardian cannot insert a membership granting itself access to another household",
      actor: "guardian",
      body: {
        household_id: b,
        user_id: resolved.guardian.userId,
        role: "guardian",
      },
    },
    {
      id: "insert.case_messages",
      surface: "table:case_messages",
      requirement:
        "a guardian cannot insert a message forging another household's case and sender",
      actor: "guardian",
      body: {
        household_id: b,
        case_id: foreign.caseId,
        sender_user_id: resolved.guardian.userId,
        kind: "general",
        body: PROBE_NOTE,
      },
    },
    {
      id: "insert.lesson_activities",
      surface: "table:lesson_activities",
      requirement:
        "a guardian cannot record activity against another household's lesson",
      actor: "guardian",
      body: {
        household_id: b,
        learner_id: foreign.learnerId,
        lesson_id: foreign.lessonId,
        updated_by: resolved.guardian.userId,
      },
    },
  ];
  for (const item of forgedInserts) {
    probes.push({
      id: item.id,
      surface: item.surface,
      requirement: item.requirement,
      actor: item.actor,
      judge: judgeInsert,
      url: new URL(`/rest/v1/${item.surface.split(":")[1]}`, origin),
      options: {
        method: "POST",
        headers: {
          ...jsonHeaders(resolved[item.actor].token),
          prefer: "return=representation",
        },
        body: JSON.stringify(item.body),
      },
    });
  }

  // The one update in the matrix. It is judged by rows affected rather than by status: RLS
  // filters the row out of the UPDATE, so PostgREST answers 200 with an empty array. The probe
  // is only meaningful because the id refers to a row that exists -- a missing row would give
  // the same empty array for an innocent reason.
  const activityUrl = new URL("/rest/v1/lesson_activities", origin);
  activityUrl.searchParams.set("id", `eq.${foreign.activityId}`);
  activityUrl.searchParams.set("select", "household_id");
  probes.push({
    id: "update.lesson_activities",
    surface: "table:lesson_activities",
    requirement:
      "a guardian cannot update another household's lesson activity by id",
    actor: "guardian",
    judge: judgeNoEffect,
    url: activityUrl,
    options: {
      method: "PATCH",
      headers: {
        ...jsonHeaders(resolved.guardian.token),
        prefer: "return=representation",
      },
      body: JSON.stringify({ caregiver_note: PROBE_NOTE }),
    },
  });

  // The bucket. Upload into the other household's prefix, then attempt the clean-download
  // path -- a signed URL -- for an object that belongs to that household.
  probes.push({
    id: "storage.upload",
    surface: `bucket:${bucketName}`,
    requirement: "a guardian cannot upload into another household's prefix",
    actor: "guardian",
    judge: judgeStorage,
    url: new URL(
      `/storage/v1/object/${bucketName}/${b}/isolation-probe.txt`,
      origin,
    ),
    options: {
      method: "POST",
      headers: {
        ...headers(key, resolved.guardian.token),
        "content-type": "text/plain",
      },
      body: PROBE_NOTE,
    },
  });
  probes.push({
    id: "storage.sign",
    surface: `bucket:${bucketName}`,
    requirement:
      "a guardian cannot obtain a clean download of another household's object",
    actor: "guardian",
    judge: judgeStorage,
    url: new URL(`/storage/v1/object/sign/${bucketName}/${objectPath}`, origin),
    options: {
      method: "POST",
      headers: jsonHeaders(resolved.guardian.token),
      body: JSON.stringify({ expiresIn: 60 }),
    },
  });

  const results = [];
  for (const item of probes) {
    const result = await sendProbe(fetchImpl, item.url, item.options);
    const { outcome, detail } = item.judge(result);
    results.push({
      id: item.id,
      surface: item.surface,
      requirement: item.requirement,
      actor: item.actor,
      status: result.status,
      outcome,
      detail,
    });
  }

  const failed = results.filter((entry) => entry.outcome !== "denied");
  const report = {
    status: failed.length ? "failed" : "passed",
    targetHousehold: b,
    probeCount: results.length,
    deniedCount: results.length - failed.length,
    controlCount: controls.length,
    storageBucket: bucketName,
    assumptions: MUTATION_ASSUMPTIONS,
    controls,
    probes: results,
  };
  if (failed.length) {
    const error = new Error(
      `${failed.length} of ${results.length} cross-household mutations were not denied: ${failed
        .map((entry) => `${entry.id} (${entry.outcome}: ${entry.detail})`)
        .join("; ")}`,
    );
    // The dated report is the whole deliverable, including on failure, so it rides along.
    error.report = report;
    throw error;
  }
  return report;
}
