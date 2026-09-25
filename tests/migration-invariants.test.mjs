// Static checks over the migration SQL that no other test covers.
//
// These are cheap structural invariants that are easy to break silently and
// expensive to notice: a SECURITY DEFINER function without a pinned search_path
// is a privilege-escalation footgun, and it looks identical to a correct one.
//
// Verified against the live database on 2026-09-21: 0 of 62 definer functions
// lacked search_path, so these tests describe real, currently-held properties
// rather than aspirations.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

/** Split a migration into its create-function statements, roughly but usefully. */
function functionDefinitions(sql) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*[\s\S]*?(?=create\s+(?:or\s+replace\s+)?function\s+|$)/gi;
  for (const match of sql.matchAll(re)) {
    out.push({ name: match[1], body: match[0] });
  }
  return out;
}

test("every SECURITY DEFINER function pins search_path", () => {
  const offenders = [];
  let count = 0;
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    for (const fn of functionDefinitions(sql)) {
      if (!/security\s+definer/i.test(fn.body)) continue;
      count += 1;
      if (!/set\s+search_path\s*=/i.test(fn.body)) {
        offenders.push(`${file}: ${fn.name}`);
      }
    }
  }
  assert.ok(count > 0, "expected to find SECURITY DEFINER functions; the detector may be broken");
  assert.deepEqual(
    offenders,
    [],
    `SECURITY DEFINER without a pinned search_path is a privilege-escalation risk:\n${offenders.join("\n")}`,
  );
});

test("RLS is enabled on every table a migration creates in public", () => {
  // A table created without `enable row level security` is world-readable to any
  // role holding a grant, which silently defeats the household isolation model.
  const created = new Set();
  const enabled = new Set();
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8").toLowerCase();
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/g)) {
      created.add(m[1]);
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?public\.(\w+)\s+enable\s+row\s+level\s+security/g)) {
      enabled.add(m[1]);
    }
  }
  const missing = [...created].filter((t) => !enabled.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `tables created in public without RLS enabled:\n${missing.join("\n")}`,
  );
});

test("direct client write grants are narrow, allowlisted, and policy-backed", () => {
  // Writes are meant to go through SECURITY DEFINER functions with their own checks.
  // A broad INSERT/UPDATE/DELETE grant to `authenticated` would let a client skip
  // those checks, so the set of tables carrying one is small on purpose.
  //
  // Allowlisted rather than banned: migration 014 grants insert/update on exactly
  // two tables where the row is guardian-authored (a lesson activity and a message
  // read receipt), and RLS remains the row-level boundary with a WITH CHECK on each.
  // Pinning the exact set means a new grant has to be added here deliberately
  // instead of arriving unnoticed.
  const ALLOWED = new Set([
    "lesson_activities",
    "case_message_reads",
  ]);

  const granted = new Map();
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    for (const m of sql.matchAll(/grant\s+([a-z,\s]+?)\s+on\s+table\s+public\.(\w+)\s+to\s+(authenticated|anon)\b[^;]*;/gi)) {
      const [, privileges, table] = m;
      if (!/insert|update|delete/i.test(privileges)) continue;
      granted.set(table, file);
    }
  }

  const unexpected = [...granted.keys()].filter((t) => !ALLOWED.has(t)).sort();
  assert.deepEqual(
    unexpected,
    [],
    `tables granted direct client write access without being allowlisted:\n${unexpected.join("\n")}`,
  );

  // And the allowlisted ones must still be there, so removing the guard silently
  // is not a way to make this pass.
  for (const table of ALLOWED) {
    assert.ok(
      granted.has(table),
      `${table} is allowlisted but no longer carries a write grant; update the allowlist`,
    );
  }
});

test("migrations are numbered, unique, and ordered without gaps in naming", () => {
  const prefixes = files.map((f) => f.slice(0, 12));
  assert.equal(new Set(prefixes).size, prefixes.length, "duplicate migration prefix");
  for (const [index, file] of files.entries()) {
    assert.match(file, /^\d{12}_[\w-]+\.sql$/, `unexpected migration filename: ${file}`);
    if (index > 0) {
      assert.ok(
        file.localeCompare(files[index - 1]) > 0,
        `migration order is not lexicographic at ${file}`,
      );
    }
  }
});

// A later migration that `create or replace`s a function replaces its whole body. Twice here that
// silently dropped checks: 037's signup shape was fixed in 041, and 034 rebuilt
// submit_guardian_intake without any of 004's context validation (restored in 045). This pins the
// final state: every `raise exception` a function has ever had must still be in its final body,
// unless it is listed below with the reason it was deliberately removed. Renames
// (`alter function a rename to b`, as 021 and 043 do to wrap a function) move the history with the
// body, so a wrapper is not mistaken for a loss.
const DELIBERATELY_DROPPED = new Map([
  // name -> Map(message -> reason)
]);

test("a redefined function keeps every check it has ever raised", () => {
  const history = new Map(); // name -> { messages: Map(message -> first file), body }
  const re = /(create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\([\s\S]*?\)\s*returns[\s\S]*?(\$\w*\$)([\s\S]*?)\3)|(alter\s+function\s+public\.(\w+)\s*\([^)]*\)\s+rename\s+to\s+(\w+))/gi;
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    for (const m of sql.matchAll(re)) {
      if (m[5]) {
        const [from, to] = [m[6], m[7]];
        if (history.has(from)) { history.set(to, history.get(from)); history.delete(from); }
        continue;
      }
      const name = m[2];
      const body = m[4];
      const raised = [...body.matchAll(/raise\s+exception\s+'([^']*)'/gi)].map((x) => x[1]);
      const entry = history.get(name) ?? { messages: new Map(), body: "" };
      for (const message of raised) if (!entry.messages.has(message)) entry.messages.set(message, file);
      entry.body = body;
      history.set(name, entry);
    }
  }
  // Guard the guard: if the parser stopped seeing functions, this test would pass vacuously.
  assert.ok(history.size >= 40, `expected to parse the migration functions, parsed ${history.size}`);
  assert.ok((history.get("submit_guardian_intake")?.messages.size ?? 0) >= 10, "submit_guardian_intake's checks were not parsed");
  assert.ok(history.has("export_guardian_household_core"), "renames are not being followed");
  const lost = [];
  for (const [name, { messages, body }] of history) {
    for (const [message, file] of messages) {
      if (body.includes(`'${message}'`)) continue;
      if (DELIBERATELY_DROPPED.get(name)?.has(message)) continue;
      lost.push(`${name}: '${message}' (first raised in ${file}) is gone from the final definition`);
    }
  }
  assert.deepEqual(lost, [], `redefinitions dropped checks; restore them or list them in DELIBERATELY_DROPPED with a reason:\n${lost.join("\n")}`);
});
