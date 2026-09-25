import assert from "node:assert/strict";
import test from "node:test";
import { stagingJourneyConfig } from "../scripts/staging-journey-config.mjs";

const ok = {
  BRITELINK_TEST_ENVIRONMENT: "staging",
  BRITELINK_STAGING_APP_URL: "https://staging.britelink.example",
  BRITELINK_SUPABASE_URL: "https://staging-api.britelink.example",
  BRITELINK_STAGING_SERVICE_ROLE_KEY: "service-key",
  BRITELINK_TEST_GUARDIAN_A_USER_ID: "g",
  BRITELINK_TEST_EDUCATOR_A_USER_ID: "e",
  BRITELINK_TEST_HOUSEHOLD_A_ID: "h",
};

test("the staging journey runs only against a declared, non-production staging stack", () => {
  assert.equal(stagingJourneyConfig(ok).appUrl, "https://staging.britelink.example");
  const refused = (overrides, pattern) => assert.throws(() => stagingJourneyConfig({ ...ok, ...overrides }), pattern);
  refused({ BRITELINK_TEST_ENVIRONMENT: "production" }, /exactly 'staging'/);
  refused({ BRITELINK_STAGING_APP_URL: "https://britelink.ashbi.ca" }, /points at production/);
  refused({ BRITELINK_SUPABASE_URL: "https://britelink-api.ashbi.ca" }, /points at production/);
  refused({ BRITELINK_STAGING_APP_URL: "http://staging.britelink.example" }, /must use https/);
  refused({ BRITELINK_STAGING_SERVICE_ROLE_KEY: "" }, /BRITELINK_STAGING_SERVICE_ROLE_KEY is not set/);
  assert.equal(stagingJourneyConfig({ ...ok, BRITELINK_STAGING_APP_URL: "http://localhost:4173" }).appUrl, "http://localhost:4173", "a local stack is allowed over http");
});
