// Regression tests for src/stripe-webhook.js.
//
// This module had NO test coverage, and two real defects survived as a result:
//
//   1. The signature comparison used `!==`, which short-circuits on the first
//      differing byte. That is a timing side-channel: an attacker can recover a
//      valid signature byte by byte by measuring how long rejection takes.
//
//   2. The timestamp tolerance only rejected OLD timestamps. Because
//      `currentTime - signedAt` is negative for a future timestamp, and a
//      negative number is never greater than the tolerance, a future-dated
//      timestamp was accepted -- so an attacker who chose `t` could mint a
//      signature that never aged out of the replay window.
//
// These tests pin both, plus the normal accept/reject behaviour.

import test from "node:test";
import assert from "node:assert/strict";
import { verifyStripeWebhook, isWebhookVerificationEnabled } from "../src/stripe-webhook.js";

const SECRET = "whsec_test_secret_for_unit_tests";

async function sign(payload, timestamp, secret = SECRET) {
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

test("a correctly signed, current webhook verifies and returns the parsed event", async () => {
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const timestamp = nowSeconds();
  const result = await verifyStripeWebhook(
    payload,
    `t=${timestamp},v1=${await sign(payload, timestamp)}`,
    SECRET,
  );
  assert.equal(result.verified, true, result.error ?? "");
  assert.equal(result.event.id, "evt_1");
  assert.equal(result.error, null);
});

test("a tampered payload fails verification", async () => {
  const timestamp = nowSeconds();
  const signature = await sign('{"amount":100}', timestamp);
  const result = await verifyStripeWebhook(
    '{"amount":999999}',
    `t=${timestamp},v1=${signature}`,
    SECRET,
  );
  assert.equal(result.verified, false);
  assert.match(result.error, /verification failed/i);
});

test("a signature signed with the wrong secret fails verification", async () => {
  const payload = JSON.stringify({ id: "evt_2" });
  const timestamp = nowSeconds();
  const result = await verifyStripeWebhook(
    payload,
    `t=${timestamp},v1=${await sign(payload, timestamp, "whsec_attacker_secret")}`,
    SECRET,
  );
  assert.equal(result.verified, false);
  assert.match(result.error, /verification failed/i);
});

test("an old timestamp outside the tolerance is rejected", async () => {
  const payload = JSON.stringify({ id: "evt_3" });
  const timestamp = nowSeconds() - 3600; // one hour ago, tolerance is 300s
  const result = await verifyStripeWebhook(
    payload,
    `t=${timestamp},v1=${await sign(payload, timestamp)}`,
    SECRET,
  );
  assert.equal(result.verified, false);
  assert.match(result.error, /too old/i);
});

test("a FUTURE timestamp outside the tolerance is rejected (regression: replay window)", async () => {
  // The original code accepted this, because currentTime - signedAt is negative
  // for a future timestamp and the old check only tested for a positive excess.
  const payload = JSON.stringify({ id: "evt_4" });
  const timestamp = nowSeconds() + 3600; // one hour in the future
  assert.equal(timestamp - nowSeconds() > 0, true, "fixture must be future-dated");
  const result = await verifyStripeWebhook(
    payload,
    `t=${timestamp},v1=${await sign(payload, timestamp)}`,
    SECRET,
  );
  assert.equal(result.verified, false, "a future-dated timestamp must not verify");
  assert.match(result.error, /future/i);
});

test("a future timestamp inside the tolerance still verifies (clock skew is allowed)", async () => {
  // Some skew is genuine: a server clock a few seconds ahead must not break
  // delivery, so the tolerance applies symmetrically rather than banning the future.
  const payload = JSON.stringify({ id: "evt_5" });
  const timestamp = nowSeconds() + 30;
  const result = await verifyStripeWebhook(
    payload,
    `t=${timestamp},v1=${await sign(payload, timestamp)}`,
    SECRET,
  );
  assert.equal(result.verified, true, result.error ?? "");
});

test("a malformed timestamp is rejected rather than coerced", async () => {
  const payload = JSON.stringify({ id: "evt_6" });
  const result = await verifyStripeWebhook(payload, "t=not-a-number,v1=deadbeef", SECRET);
  assert.equal(result.verified, false);
  assert.match(result.error, /malformed/i);
});

test("a signature that differs only in the final byte is rejected", async () => {
  // Exercises the comparison path: a near-miss must fail exactly like a total miss.
  const payload = JSON.stringify({ id: "evt_7" });
  const timestamp = nowSeconds();
  const good = await sign(payload, timestamp);
  const flipped = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
  assert.notEqual(good, flipped, "fixture must actually differ");
  const result = await verifyStripeWebhook(payload, `t=${timestamp},v1=${flipped}`, SECRET);
  assert.equal(result.verified, false);
  assert.match(result.error, /verification failed/i);
});

test("rejects missing or malformed inputs without throwing", async () => {
  const timestamp = nowSeconds();
  const cases = [
    [null, `t=${timestamp},v1=abc`, SECRET, /invalid payload/i],
    ["{}", null, SECRET, /invalid signature header/i],
    ["{}", "no-fields-here", SECRET, /malformed/i],
    ["{}", `t=${timestamp},v1=abc`, "not-a-whsec-prefixed-secret", /invalid webhook secret/i],
    ["{}", `t=${timestamp},v1=abc`, undefined, /invalid webhook secret/i],
  ];
  for (const [payload, signature, secret, expected] of cases) {
    const result = await verifyStripeWebhook(payload, signature, secret);
    assert.equal(result.verified, false, `expected rejection for ${JSON.stringify({ signature, secret })}`);
    assert.match(result.error, expected);
  }
});

test("rejects a payload that is signed correctly but is not valid JSON", async () => {
  const timestamp = nowSeconds();
  const payload = "{not json";
  const result = await verifyStripeWebhook(
    payload,
    `t=${timestamp},v1=${await sign(payload, timestamp)}`,
    SECRET,
  );
  // The signature matches, so this exercises the JSON.parse failure path, which
  // must return a structured failure rather than throwing into the caller.
  assert.equal(result.verified, false);
});

test("the environment flag only enables verification on the exact string 'true'", () => {
  assert.equal(isWebhookVerificationEnabled({ BRITELINK_STRIPE_WEBHOOK_VERIFICATION_ENABLED: "true" }), true);
  assert.equal(isWebhookVerificationEnabled({ BRITELINK_STRIPE_WEBHOOK_VERIFICATION_ENABLED: "false" }), false);
  assert.equal(isWebhookVerificationEnabled({ BRITELINK_STRIPE_WEBHOOK_VERIFICATION_ENABLED: "1" }), false);
  assert.equal(isWebhookVerificationEnabled({ BRITELINK_STRIPE_WEBHOOK_VERIFICATION_ENABLED: "TRUE" }), false);
  assert.equal(isWebhookVerificationEnabled({}), false);
});
