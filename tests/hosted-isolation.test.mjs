import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVATE_TABLES,
  verifyHostedIsolation,
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
  assert.equal(report.tableCount, 25);
  assert.equal(report.checkCount, 104);
  assert.equal(
    requests.filter((item) => item.url.includes("/rest/v1/")).length,
    PRIVATE_TABLES.length * 4,
  );
  assert.equal(
    requests.filter((item) => item.url.includes("/storage/v1/object/list/"))
      .length,
    4,
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
