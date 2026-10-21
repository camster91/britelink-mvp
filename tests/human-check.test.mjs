import assert from "node:assert/strict";
import test from "node:test";
import { createHumanCheck, HUMAN_CHECK_MESSAGES, TURNSTILE_SCRIPT } from "../src/human-check.js";
import { SupabaseBriteLinkRepository } from "../src/supabase-repository.js";

// A tiny stand-in for the page: just enough DOM for the check's box and script tag.
function fakePage({ turnstile = null, scriptLoads = true } = {}) {
  const win = { turnstile: null };
  const added = [];
  const node = (tag) => {
    const el = { tag, children: [], attributes: {}, removed: false };
    el.append = (...kids) => el.children.push(...kids);
    el.setAttribute = (k, v) => { el.attributes[k] = v; };
    el.remove = () => { el.removed = true; };
    return el;
  };
  const doc = {
    createElement: node,
    head: { append(script) { added.push(script); queueMicrotask(() => { if (scriptLoads) { win.turnstile = turnstile; script.onload(); } else script.onerror(); }); } },
    body: { append(box) { added.push(box); } },
  };
  return { doc, win, added };
}

function fakeTurnstile(outcome) {
  const calls = { render: [], remove: [] };
  return {
    calls,
    render(slot, options) { calls.render.push(options); queueMicrotask(() => (outcome === "ok" ? options.callback("token-1") : options["error-callback"]())); return "widget-1"; },
    remove(id) { calls.remove.push(id); },
  };
}

test("no site key means no person check", () => {
  assert.equal(createHumanCheck(null), null);
  assert.equal(createHumanCheck(""), null);
});

test("the check loads Turnstile once, returns its token and tidies up", async () => {
  const turnstile = fakeTurnstile("ok");
  const page = fakePage({ turnstile });
  const check = createHumanCheck("site-key", page);
  assert.equal(await check(), "token-1");
  const script = page.added.find((el) => el.tag === "script");
  assert.equal(script.src, TURNSTILE_SCRIPT);
  assert.equal(turnstile.calls.render[0].sitekey, "site-key");
  assert.equal(turnstile.calls.render[0].appearance, "interaction-only");
  assert.deepEqual(turnstile.calls.remove, ["widget-1"]);
  assert.ok(page.added.find((el) => el.tag === "div").removed, "the box is removed");
});

test("a failed check and a blocked script each give a plain message", async () => {
  const failing = fakePage({ turnstile: fakeTurnstile("error") });
  await assert.rejects(createHumanCheck("site-key", failing)(), { message: HUMAN_CHECK_MESSAGES.failed });
  const blocked = fakePage({ turnstile: fakeTurnstile("ok"), scriptLoads: false });
  const check = createHumanCheck("site-key", blocked);
  await assert.rejects(check(), { message: HUMAN_CHECK_MESSAGES.loadFailed });
  // The next attempt tries to load the script again.
  await assert.rejects(check(), { message: HUMAN_CHECK_MESSAGES.loadFailed });
  assert.equal(blocked.added.filter((el) => el.tag === "script").length, 2);
});

test("sign-in links carry the token only when the check is on", async () => {
  const sent = [];
  const client = { auth: { signInWithOtp: async (request) => { sent.push(request); return { data: {} }; } } };
  await new SupabaseBriteLinkRepository(client).signInWithEmail("a@example.com", "https://britelink.test");
  await new SupabaseBriteLinkRepository(client, { humanCheck: async () => "token-2" }).signInWithEmail("a@example.com", "https://britelink.test");
  await new SupabaseBriteLinkRepository(client, { humanCheck: async () => "token-3" }).joinBeta("b@example.com", "https://britelink.test", { learnerName: "Ada", learnerGrade: "3" });
  await new SupabaseBriteLinkRepository(client, { humanCheck: async () => "token-4" }).requestFreshSignIn("c@example.com", "https://britelink.test");
  assert.deepEqual(sent.map((request) => request.options.captchaToken), [undefined, "token-2", "token-3", "token-4"]);
  assert.equal(sent[2].options.data.beta_learner_name, "Ada");
  // A refused check never sends an email.
  const refused = new SupabaseBriteLinkRepository(client, { humanCheck: async () => { throw new Error(HUMAN_CHECK_MESSAGES.failed); } });
  await assert.rejects(refused.signInWithEmail("d@example.com", "https://britelink.test"), { message: HUMAN_CHECK_MESSAGES.failed });
  assert.equal(sent.length, 4);
});

test("the sign-in service's captcha refusal reads as a plain message", async () => {
  const client = { auth: { signInWithOtp: async () => ({ error: { message: "captcha protection: request disallowed (invalid-input-response)", status: 400 } }) } };
  await assert.rejects(new SupabaseBriteLinkRepository(client).signInWithEmail("a@example.com", "https://britelink.test"), /couldn't confirm you're a person/);
});
