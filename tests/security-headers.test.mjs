// Regression tests for the shipped security headers.
//
// These headers existed in the nginx template and the Sites worker with no test
// coverage, which is how the BriteLink routes ended up without HSTS while other
// routes on the same Traefik instance had it: nothing failed when a header went
// missing.
//
// The policy itself is deliberately strict, so these tests also pin the strictness.
// A future "fix" that re-adds 'unsafe-inline' or an external font origin should
// have to argue with a failing test rather than pass silently.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nginx = readFileSync(path.join(root, "nginx.conf.template"), "utf8");
const worker = readFileSync(path.join(root, "worker", "index.js"), "utf8");

test("nginx serves HSTS", () => {
  // TLS terminates at Traefik, whose britelink routers do not set stsSeconds, so
  // this header is the only HSTS a BriteLink visitor receives.
  assert.match(nginx, /Strict-Transport-Security\s+"max-age=\d+"/);
  assert.match(nginx, /add_header Strict-Transport-Security[^;]*always/);
});

test("nginx serves the baseline hardening headers", () => {
  assert.match(nginx, /X-Content-Type-Options\s+nosniff/);
  assert.match(nginx, /X-Frame-Options\s+DENY/);
  assert.match(nginx, /Referrer-Policy\s+strict-origin-when-cross-origin/);
  assert.match(nginx, /Permissions-Policy\s+"camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\)"/);
});

test("the Content-Security-Policy stays strict in nginx", () => {
  const match = nginx.match(/add_header Content-Security-Policy\s+"([^"]+)"/);
  assert.ok(match, "nginx must emit a Content-Security-Policy");
  const policy = match[1];
  // 'self' only for styles: inline style attributes were removed from src/main.jsx
  // precisely so this exception could be dropped origin-wide.
  assert.doesNotMatch(policy, /style-src[^;]*'unsafe-inline'/);
  // Fonts are self-hosted under /fonts; no external font origin belongs here.
  assert.doesNotMatch(policy, /font-src[^;]*fonts\.(googleapis|gstatic)\.com/);
  assert.doesNotMatch(policy, /font-src[^;]*https?:/);
  // connect-src names one concrete origin via substitution, never a wildcard.
  assert.doesNotMatch(policy, /connect-src[^;]*\*/);
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /form-action 'self'/);
});

test("the Sites worker policy matches the nginx policy in strictness", () => {
  const match = worker.match(/"Content-Security-Policy":\s*"([^"]+)"/);
  assert.ok(match, "worker must emit a Content-Security-Policy");
  const policy = match[1];
  assert.doesNotMatch(policy, /style-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /font-src[^;]*https?:/);
  assert.doesNotMatch(policy, /connect-src[^;]*\*/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test("the worker sets HSTS only over HTTPS", () => {
  assert.match(worker, /Strict-Transport-Security/);
  assert.match(
    worker,
    /protocol === "https:"[\s\S]{0,120}Strict-Transport-Security/,
    "HSTS must be conditional on an HTTPS request",
  );
});

test("no source file emits an inline style attribute", () => {
  // The CSP depends on this. If a component reintroduces style="...", the browser
  // silently drops those styles and the page renders wrong with no visible error.
  const main = readFileSync(path.join(root, "src", "main.jsx"), "utf8");
  assert.doesNotMatch(main, /style="/, "src/main.jsx must not use inline style attributes");
  const app = readFileSync(path.join(root, "src", "App.jsx"), "utf8");
  assert.doesNotMatch(app, /\sstyle="/, "src/App.jsx must not use inline style attributes");
});

test("nginx makes browsers revalidate the page so a deploy never strands an old index.html", () => {
  // Server-level, before the first location: applies to index.html, app routes and /version.json.
  const serverLevel = nginx.slice(0, nginx.indexOf("location / {"));
  assert.match(serverLevel, /add_header Cache-Control "no-cache" always;/);
  // Hashed assets keep their own long-lived caching in the static location.
  assert.match(nginx, /add_header Cache-Control "public, immutable" always;/);
});
