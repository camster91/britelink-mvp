import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  MUTATION_RPC_BY_ID,
  MUTATION_RPC_CONTRACTS,
  PRIVATE_TABLES,
  verifyHostedIsolation,
  verifyHostedMutationDenial,
} from "../src/hosted-isolation.js";

const config = {
  environment: "staging",
  supabaseUrl: "https://example.supabase.co",
  apiKey: "public-project-key",
  householdA: "10000000-0000-4000-8000-000000000001",
  householdB: "10000000-0000-4000-8000-000000000002",
  tokenA: "jwt-a",
  tokenB: "jwt-b",
};

const response = (body = [], status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return body;
  },
});

test("hosted isolation checks every private table in both directions and the bucket", async () => {
  const requests = [];
  const report = await verifyHostedIsolation({
    ...config,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      const actorA = options.headers.authorization === "Bearer jwt-a";
      const ownHousehold = actorA ? config.householdA : config.householdB;
      const target = String(url).includes("/storage/")
        ? JSON.parse(options.body).prefix.slice(0, -1)
        : new URL(url).searchParams.get("household_id").slice(3);
      return response(target === ownHousehold ? [{}] : []);
    },
  });
  assert.equal(report.status, "passed");
  // Derived from the list, not hardcoded. The sweep previously asserted a literal 25,
  // which let three RLS-enabled household tables sit outside the isolation proof while
  // this test stayed green. A count that cannot drift from its source is the fix.
  assert.equal(report.tableCount, PRIVATE_TABLES.length);
  assert.equal(PRIVATE_TABLES.length, 28);
  // checkCount = four table checks per table, plus four bucket checks (two actors x
  // own-prefix visible / foreign-prefix denied). The bucket contribution is additive and
  // was previously folded into a hardcoded 104, which hid the arithmetic.
  const TABLE_CHECKS_PER_TABLE = 4;
  const BUCKET_CHECKS = 4;
  assert.equal(
    report.checkCount,
    PRIVATE_TABLES.length * TABLE_CHECKS_PER_TABLE + BUCKET_CHECKS,
  );
  // The /rest/v1/ count is NOT purely the table sweep: the D2 mutation matrix adds
  // membership role-control reads, RPC probes, forged-attribution inserts, and one update.
  // Asserting the sweep size here would have been wrong at any table count. What must hold
  // is that the sweep contributes exactly four calls per table, so assert that directly.
  // The sweep is the read-only pass: per table it issues four GETs carrying
  // select=household_id and limit=1 (two actors x own/foreign). Match that exact
  // signature so the mutation-matrix probes against the same tables are excluded.
  const sweepCalls = requests.filter(
    (item) =>
      item.url.includes("select=household_id") &&
      item.url.includes("limit=1") &&
      PRIVATE_TABLES.some((table) => item.url.includes(`/rest/v1/${table}?`)),
  );
  assert.equal(sweepCalls.length, PRIVATE_TABLES.length * 4);
  // Bucket checks are additive: two list calls per actor (own prefix, foreign prefix),
  // on top of the per-table sweep.
  assert.equal(
    requests.filter((item) => item.url.includes("/storage/v1/object/list/"))
      .length,
    2 * 2,
  );
  assert.ok(
    requests.every(
      (item) =>
        item.options.headers.apikey === config.apiKey &&
        item.options.headers.authorization.startsWith("Bearer jwt-"),
    ),
  );
});

test("hosted isolation fails closed on leaked rows and HTTP errors", async () => {
  await assert.rejects(
    () =>
      verifyHostedIsolation({
        ...config,
        fetchImpl: async () => response([]),
      }),
    /no visible own-household sentinel/,
  );
  await assert.rejects(
    () =>
      verifyHostedIsolation({
        ...config,
        fetchImpl: async () => response([{ household_id: config.householdB }]),
      }),
    /leaked cross-household rows/,
  );
  await assert.rejects(
    () =>
      verifyHostedIsolation({
        ...config,
        fetchImpl: async () => response([], 401),
      }),
    /HTTP 401/,
  );
});

test("hosted isolation rejects unsafe or ambiguous configuration before network calls", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response();
  };
  await assert.rejects(
    () =>
      verifyHostedIsolation({
        ...config,
        supabaseUrl: "http://example.supabase.co",
        fetchImpl,
      }),
    /HTTPS/,
  );
  await assert.rejects(
    () =>
      verifyHostedIsolation({
        ...config,
        householdB: config.householdA,
        fetchImpl,
      }),
    /distinct households/,
  );
  await assert.rejects(
    () =>
      verifyHostedIsolation({ ...config, tokenB: config.tokenA, fetchImpl }),
    /distinct access tokens/,
  );
  await assert.rejects(
    () =>
      verifyHostedIsolation({
        ...config,
        environment: "production",
        fetchImpl,
      }),
    /staging-only/,
  );
  assert.equal(calls, 0);
});

// ---------------------------------------------------------------------------
// D2: the hosted mutation-denial matrix
// ---------------------------------------------------------------------------

const mutationConfig = {
  environment: "staging",
  supabaseUrl: "https://example.supabase.co",
  apiKey: "public-project-key",
  householdA: "20000000-0000-4000-8000-000000000001",
  householdB: "20000000-0000-4000-8000-000000000002",
  actors: {
    guardian: {
      token: "jwt-guardian",
      userId: "30000000-0000-4000-8000-000000000001",
    },
    educator: {
      token: "jwt-educator",
      userId: "30000000-0000-4000-8000-000000000002",
    },
    admin: { token: "jwt-admin", userId: "30000000-0000-4000-8000-000000000003" },
  },
  adminTokenB: "jwt-admin-b",
  foreign: {
    caseId: "40000000-0000-4000-8000-000000000001",
    planId: "40000000-0000-4000-8000-000000000002",
    lessonId: "40000000-0000-4000-8000-000000000003",
    activityId: "40000000-0000-4000-8000-000000000004",
    messageId: "40000000-0000-4000-8000-000000000005",
    deliveryId: "40000000-0000-4000-8000-000000000006",
    revisionId: "40000000-0000-4000-8000-000000000007",
    attachmentId: "40000000-0000-4000-8000-000000000008",
    consentId: "40000000-0000-4000-8000-000000000009",
    learnerId: "40000000-0000-4000-8000-00000000000b",
    objectPath:
      "20000000-0000-4000-8000-000000000002/40000000-0000-4000-8000-000000000005/40000000-0000-4000-8000-000000000008.pdf",
  },
};

const ROLE_BY_TOKEN = {
  "jwt-guardian": "guardian",
  "jwt-educator": "educator",
  "jwt-admin": "admin",
};

// The authorization message each RPC raises first, taken from its opening gate in the
// migrations. Kept here so the fake denies the way the real schema does; the static test below
// is what holds this list to the SQL.
const GATE_BY_RPC = {
  send_case_message: "household membership required",
  create_message_attachment_upload: "household membership required",
  complete_message_attachment_upload: "household membership required",
  retry_message_attachment_upload: "household membership required",
  submit_guardian_intake: "guardian access required",
  export_guardian_household: "guardian access required",
  request_guardian_household_deletion: "guardian access required",
  withdraw_guardian_consent: "guardian access required",
  request_guardian_revision: "guardian access required",
  acknowledge_guardian_delivery: "guardian access required",
  staff_transition_case: "staff access required",
  staff_create_plan_version: "staff access required",
  staff_add_plan_resource: "staff access required",
  staff_review_plan: "staff access required",
  staff_record_delivery: "staff access required",
  staff_decide_revision: "staff access required",
  staff_assign_case: "admin access required",
};

const stagingResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return typeof body === "string" ? body : JSON.stringify(body);
  },
});

// A staging stand-in that denies the way the real schema does, with one hook for deviating.
function stagingProbe({ override = () => null, roleOverride = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const token = String(options.headers.authorization ?? "").replace(
      "Bearer ",
      "",
    );
    const isText = options.headers["content-type"] === "text/plain";
    const call = {
      path: parsed.pathname,
      query: parsed.search,
      method: options.method ?? "GET",
      token,
      body:
        typeof options.body !== "string"
          ? (options.body ?? null)
          : isText
            ? options.body
            : JSON.parse(options.body),
    };
    calls.push(call);

    const replaced = override(call);
    if (replaced) return replaced;

    if (call.path === "/rest/v1/memberships" && call.method === "GET")
      return stagingResponse([{ role: roleOverride ?? ROLE_BY_TOKEN[token] }]);
    if (call.path.startsWith("/storage/v1/object/sign/"))
      return token === mutationConfig.adminTokenB
        ? stagingResponse({ signedURL: "https://example.invalid/signed" })
        : stagingResponse({ statusCode: "403", message: "denied" }, 403);
    if (call.path.startsWith("/storage/v1/object/"))
      return stagingResponse(
        { statusCode: "403", message: "row-level security policy violated" },
        403,
      );
    if (call.path.startsWith("/rest/v1/rpc/")) {
      const message = GATE_BY_RPC[call.path.slice("/rest/v1/rpc/".length)];
      return message.includes("guardian")
        ? stagingResponse({ code: "42501", message }, 403)
        : stagingResponse({ code: "P0001", message }, 400);
    }
    if (call.method === "PATCH") return stagingResponse([]);
    if (call.method === "POST")
      return stagingResponse(
        { code: "42501", message: "row-level security policy violated" },
        403,
      );
    return stagingResponse([], 404);
  };
  return { calls, fetchImpl };
}

test("every mutation contract names a real RPC and its real arguments", async () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const sql = (
    await Promise.all(
      files.map((name) => readFile(new URL(name, directory), "utf8")),
    )
  ).join("\n");
  // The migrations redefine functions -- 016 replaces 006's staff_review_plan -- and PostgREST
  // serves the last definition, so the last header is the one that counts.
  const authorizationMessages = [
    "household membership required",
    "guardian access required",
    "staff access required",
    "admin access required",
  ];

  const ids = MUTATION_RPC_CONTRACTS.map((contract) => contract.id);
  assert.equal(new Set(ids).size, ids.length, "contract ids are unique");
  for (const id of ids)
    assert.ok(MUTATION_RPC_BY_ID[id], `contract ${id} names an RPC to call`);

  const rpcs = new Set();
  for (const contract of MUTATION_RPC_CONTRACTS) {
    const rpc = MUTATION_RPC_BY_ID[contract.id];
    rpcs.add(rpc);
    const headers = [
      ...sql.matchAll(
        new RegExp(
          `create or replace function public\\.${rpc}\\(([^)]*)\\)`,
          "gs",
        ),
      ),
    ];
    assert.ok(headers.length, `${rpc} is defined by a migration`);
    for (const header of headers) {
      const params = header[1]
        .split(",")
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter(Boolean)
        .sort();
      assert.deepEqual(
        params,
        [...contract.args].sort(),
        `${rpc} takes exactly the arguments the probe sends`,
      );
    }
    // The gate has to be the first failure the function can produce, or a cross-household call
    // could be rejected by a validation error and read as isolation.
    const gate = /raise exception '([^']*)'/.exec(sql.slice(headers.at(-1).index));
    assert.ok(gate, `${rpc} raises an exception`);
    assert.ok(
      authorizationMessages.some((message) => gate[1].includes(message)),
      `${rpc} opens with an authorization gate, not a validation error (found: ${gate[1]})`,
    );
  }
  assert.equal(
    rpcs.size,
    new Set(Object.values(MUTATION_RPC_BY_ID)).size,
    "the mapping names as many RPCs as it declares",
  );
});

test("the mutation matrix denies every cross-household write and reports each one", async () => {
  const { calls, fetchImpl } = stagingProbe();
  const report = await verifyHostedMutationDenial({ ...mutationConfig, fetchImpl });

  assert.equal(report.status, "passed");
  assert.equal(report.probeCount, 24);
  assert.equal(report.deniedCount, 24);
  assert.equal(report.controlCount, 4);
  assert.equal(new Set(report.probes.map((entry) => entry.id)).size, 24);
  assert.ok(report.probes.every((entry) => entry.outcome === "denied"));
  assert.ok(
    report.probes.every((entry) => entry.requirement && entry.surface),
    "every probe names the requirement it evidences",
  );

  // The probes must carry the arguments the contracts declare, not merely the right function.
  const rpcCalls = calls.filter((call) => call.path.startsWith("/rest/v1/rpc/"));
  assert.equal(rpcCalls.length, MUTATION_RPC_CONTRACTS.length);
  for (const call of rpcCalls) {
    const rpc = call.path.slice("/rest/v1/rpc/".length);
    const sent = Object.keys(call.body).sort();
    const allowed = MUTATION_RPC_CONTRACTS.filter(
      (contract) => MUTATION_RPC_BY_ID[contract.id] === rpc,
    ).map((contract) => [...contract.args].sort());
    assert.ok(
      allowed.some((args) => args.join() === sent.join()),
      `${rpc} was sent ${sent.join(",")}, which no contract declares`,
    );
  }

  // The bucket probes target the other household, and the forged inserts carry every NOT NULL
  // column -- otherwise a not-null violation would stand in for a denial.
  const upload = calls.find((call) =>
    call.path.startsWith("/storage/v1/object/case-attachments/"),
  );
  assert.ok(upload.path.includes(`/${mutationConfig.householdB}/`));
  const forged = calls.find(
    (call) => call.path === "/rest/v1/memberships" && call.method === "POST",
  );
  assert.deepEqual(Object.keys(forged.body).sort(), [
    "household_id",
    "role",
    "user_id",
  ]);
  assert.equal(forged.body.user_id, mutationConfig.actors.guardian.userId);
});

test("the mutation matrix fails when a cross-household mutation is allowed", async () => {
  const { fetchImpl } = stagingProbe({
    override: (call) =>
      call.path === "/rest/v1/rpc/staff_transition_case"
        ? stagingResponse([{ case_id: mutationConfig.foreign.caseId }])
        : null,
  });
  await assert.rejects(
    () => verifyHostedMutationDenial({ ...mutationConfig, fetchImpl }),
    (error) => {
      assert.match(error.message, /were not denied/);
      // The dated report is the deliverable, so it has to survive the failure.
      assert.equal(error.report.status, "failed");
      const failed = error.report.probes.filter(
        (entry) => entry.outcome !== "denied",
      );
      assert.deepEqual(
        failed.map((entry) => entry.id),
        ["educator.transition_case"],
      );
      assert.match(failed[0].detail, /mutation was accepted/);
      return true;
    },
  );
});

test("the mutation matrix fails when an update touches the other household's row", async () => {
  const { fetchImpl } = stagingProbe({
    override: (call) =>
      call.method === "PATCH"
        ? stagingResponse([
            { household_id: mutationConfig.householdB },
          ])
        : null,
  });
  await assert.rejects(
    () => verifyHostedMutationDenial({ ...mutationConfig, fetchImpl }),
    /update\.lesson_activities \(allowed: updated 1 row\(s\)/,
  );
});

// This is the difference between a discriminating gate and a green one. Each of these answers
// looks like a denial from the outside and must not be accepted as evidence of isolation.
test("the mutation matrix refuses to read anything but an authorization denial as denial", async () => {
  const cases = [
    {
      label: "a validation error raised before the role check",
      override: (call) =>
        call.path === "/rest/v1/rpc/staff_review_plan"
          ? stagingResponse(
              { code: "P0001", message: "curriculum check is required" },
              400,
            )
          : null,
    },
    {
      label: "a misspelled argument name, which PostgREST reports as PGRST202",
      override: (call) =>
        call.path === "/rest/v1/rpc/staff_review_plan"
          ? stagingResponse(
              {
                code: "PGRST202",
                message:
                  "Could not find the function public.staff_review_plan in the schema cache",
              },
              404,
            )
          : null,
    },
    {
      label: "a not-null violation on a forged insert",
      override: (call) =>
        call.path === "/rest/v1/memberships" && call.method === "POST"
          ? stagingResponse(
              {
                code: "23502",
                message: 'null value in column "role" violates not-null constraint',
              },
              400,
            )
          : null,
    },
  ];
  for (const item of cases) {
    const { fetchImpl } = stagingProbe({ override: item.override });
    await assert.rejects(
      () => verifyHostedMutationDenial({ ...mutationConfig, fetchImpl }),
      (error) => {
        assert.match(error.message, /inconclusive/, item.label);
        return true;
      },
      item.label,
    );
  }
});

test("the mutation matrix refuses to run when an actor lacks the role it claims", async () => {
  const { calls, fetchImpl } = stagingProbe({ roleOverride: "educator" });
  await assert.rejects(
    () => verifyHostedMutationDenial({ ...mutationConfig, fetchImpl }),
    /does not hold the guardian role/,
  );
  // Nothing else was sent: a probe run behind a broken control would be vacuous.
  assert.equal(calls.length, 1);
});

test("the mutation matrix refuses to run when household B cannot sign its own object", async () => {
  const { fetchImpl } = stagingProbe({
    override: (call) =>
      call.path.startsWith("/storage/v1/object/sign/") &&
      call.token === mutationConfig.adminTokenB
        ? stagingResponse({ statusCode: "400", message: "Object not found" }, 400)
        : null,
  });
  await assert.rejects(
    () => verifyHostedMutationDenial({ ...mutationConfig, fetchImpl }),
    /storage control failed/,
  );
});

test("the mutation matrix rejects unsafe or ambiguous configuration before network calls", async () => {
  const { calls, fetchImpl } = stagingProbe();
  const rejects = async (overrides, pattern) => {
    await assert.rejects(
      () => verifyHostedMutationDenial({ ...mutationConfig, ...overrides, fetchImpl }),
      pattern,
    );
  };
  await rejects({ environment: "production" }, /staging-only/);
  await rejects(
    { foreign: { ...mutationConfig.foreign, objectPath: "some/other/prefix.pdf" } },
    /household B's prefix/,
  );
  await rejects(
    {
      actors: {
        ...mutationConfig.actors,
        educator: {
          ...mutationConfig.actors.educator,
          token: "jwt-guardian",
        },
      },
    },
    /distinct access token/,
  );
  await rejects({ adminTokenB: "jwt-guardian" }, /distinct from household A/);
  await rejects(
    {
      actors: {
        guardian: mutationConfig.actors.guardian,
        admin: mutationConfig.actors.admin,
      },
    },
    /educator actor is required/,
  );
  await rejects(
    { foreign: { ...mutationConfig.foreign, caseId: "not-a-uuid" } },
    /Household B case ID must be a UUID/,
  );
  assert.equal(calls.length, 0);
});
