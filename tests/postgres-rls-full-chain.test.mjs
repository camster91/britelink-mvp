// Cross-household isolation over the FULL migration chain, driven by the catalog.
//
// Why this exists: tests/postgres-rls.test.mjs deliberately loads only migrations 001-021, and the
// migration harness (scripts/migration-harness) sweeps reads only, needs Docker, and only runs
// when the CI runner does. Nothing exercised the 022+ hardening -- or a new SECURITY DEFINER RPC --
// for cross-household writes. That gap hid 037's anon-callable signup function (fixed in 041).
//
// Everything below is derived from pg_catalog rather than hand-listed, so a new table or a new
// RPC granted to `authenticated` fails this file until it is either covered or explicitly
// accounted for here with a reason. The fixture is the real staging seed
// (supabase/seed/synthetic-staging.sql) on top of the harness shim, so it models the same
// Supabase surface the harness does.

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const users = {
  adminA: "5eed0000-0000-4000-8000-00000000ad01",
  guardianA: "5eed0000-0000-4000-8000-00000000ad02",
  educatorA: "5eed0000-0000-4000-8000-00000000ad03",
  adminB: "5eed0000-0000-4000-8000-00000000ad04",
};
const houseA = "5eed0000-0000-4000-8000-0000000000a1";
const houseB = "5eed0000-0000-4000-8000-0000000000b1";
const actorsA = [["admin A", users.adminA], ["guardian A", users.guardianA], ["educator A", users.educatorA]];

// Household-scoped tables the staging seed leaves empty. Their foreign-read check is vacuous, so
// each one is named with a reason instead of passing silently. A table that gains seed rows must
// be removed from here (the test enforces that too).
const UNSEEDED = new Map([
  ["attachment_object_observations", "written only by the service-role reconciler; no client grant"],
]);

// Authenticated-executable SECURITY DEFINER functions that take no target_household. Every other
// one must accept target_household and is swept below.
const NON_HOUSEHOLD_RPCS = new Map([
  ["can_read_plan", "policy helper; asserted false for a foreign plan below"],
  ["activity_plan_id", "policy helper; returns only the opaque plan uuid for a child uuid the caller must already hold"],
  ["lesson_plan_id", "policy helper; as above"],
  ["day_plan_id", "policy helper; as above"],
  ["package_plan_weeks", "pure lookup over package codes; no household data"],
  ["provision_beta_household", "caller-scoped by auth.uid(); covered by its own test below"],
]);

// Which of household B's rows to hand an RPC for each uuid parameter.
const FOREIGN_ARGUMENT = {
  target_household: `select '${houseB}'::uuid as id`,
  target_case: `select id from public.service_cases where household_id='${houseB}' limit 1`,
  target_plan: `select id from public.plans where household_id='${houseB}' limit 1`,
  target_lesson: `select id from public.lessons where household_id='${houseB}' limit 1`,
  target_day: `select id from public.plan_days where household_id='${houseB}' limit 1`,
  target_activity: `select id from public.lesson_activities where household_id='${houseB}' limit 1`,
  target_attachment: `select id from public.case_attachments where household_id='${houseB}' limit 1`,
  target_message: `select id from public.case_messages where household_id='${houseB}' limit 1`,
  target_delivery: `select id from public.deliveries where household_id='${houseB}' limit 1`,
  target_revision: `select id from public.revision_requests where household_id='${houseB}' limit 1`,
  target_consent: `select id from public.guardian_consents where household_id='${houseB}' limit 1`,
  target_learner: `select id from public.learners where household_id='${houseB}' limit 1`,
  target_job: `select id from public.deletion_jobs where household_id='${houseB}' limit 1`,
  target_request: `select id from public.privacy_requests where household_id='${houseB}' limit 1`,
  target_educator: `select '${users.adminB}'::uuid as id`,
};
// Plausible values for every other parameter type, so a call reaches its authorization check.
const PLACEHOLDER = {
  text: "'synthetic cross-household probe'",
  integer: "4",
  boolean: "true",
  "timestamp with time zone": "now()",
  jsonb: "'{}'::jsonb",
  "text[]": "array['personalized_learning_plan']",
  "membership_role[]": "array['guardian','educator','admin']::public.membership_role[]",
  case_status: "(enum_range(null::public.case_status))[2]",
};
const DENIED = /access required|membership required|not found|permission denied|row-level security|response owner or admin required/i;

// Apply the psql seed without psql: evaluate its \if guards as "variable set and true" (we pass
// every variable), drop the other meta-commands, and substitute :'var' literals.
function preprocessSeed(sql, vars) {
  const out = [];
  const branch = [];
  for (const line of sql.split("\n")) {
    if (/^\\if\b/.test(line)) { branch.push(true); continue; }
    if (/^\\else\b/.test(line)) { branch.push(!branch.pop()); continue; }
    if (/^\\endif\b/.test(line)) { branch.pop(); continue; }
    if (branch.includes(false) || line.startsWith("\\") || /^\s*--/.test(line)) continue;
    out.push(line.replace(/:'(\w+)'/g, (_, name) => {
      assert.ok(name in vars, `seed references :'${name}', which this test does not supply`);
      return `'${vars[name]}'`;
    }));
  }
  return out.join("\n");
}

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(await read("scripts/migration-harness/supabase-shim.sql"));
  const files = (await readdir(new URL("supabase/migrations/", root))).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) await db.exec(await read(`supabase/migrations/${file}`));
  await db.exec(await read("supabase/storage-policies.sql"));
  await db.exec(preprocessSeed(await read("supabase/seed/synthetic-staging.sql"), {
    admin_a: users.adminA, guardian_a: users.guardianA, educator_a: users.educatorA, admin_b: users.adminB,
  }));
  await db.exec(`update auth.users set email_confirmed_at = now()`);
  return { db, files };
}

async function as(db, role, userId, operation) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', false);`);
  try { return await operation(); } finally { await db.exec("reset role; reset request.jwt.claim.sub; reset request.jwt.claim.iat;"); }
}

// Run a statement as a user inside a transaction that is always rolled back. Role and claims are
// set transaction-locally, so the rollback restores them even after an error. `watch` runs as the
// superuser *before* the rollback, so it sees what the statement actually changed.
async function attempt(db, userId, sql, watch) {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
    const result = await db.query(sql);
    await db.exec("reset role");
    return { result, after: watch ? await watch() : undefined };
  } catch (error) {
    return { error };
  } finally {
    await db.exec("rollback");
  }
}

async function catalog(db) {
  const tables = (await db.query(`
    select c.relname as name, c.relrowsecurity as rls,
           exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='household_id' and not a.attisdropped) as scoped,
           (select a.attname from pg_attribute a where a.attrelid=c.oid and not a.attisdropped
             and a.atttypid='timestamptz'::regtype and a.attname in ('updated_at','created_at')
             order by a.attname desc limit 1) as touchable
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' order by 1`)).rows;
  const rpcs = (await db.query(`
    select p.proname as name, coalesce(p.proargnames[1:p.pronargs], '{}') as argnames,
           array(select format_type(t, null) from unnest(p.proargtypes) t) as argtypes
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
     order by 1`)).rows;
  return { tables, rpcs };
}

// Everything household B owns, as the superuser sees it. Used to prove a probe changed nothing.
async function fingerprintB(db, tables) {
  const parts = [];
  for (const { name } of tables.filter((t) => t.scoped)) {
    parts.push((await db.query(`select coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from public.${name} t where household_id=$1`, [houseB])).rows[0].h);
  }
  parts.push((await db.query(`select md5(t::text) as h from public.households t where id=$1`, [houseB])).rows[0].h);
  return parts.join(":");
}

async function uuidsOfB(db, tables) {
  const found = new Set();
  for (const { name } of tables.filter((t) => t.scoped)) {
    for (const row of (await db.query(`select t::text as r from public.${name} t where household_id=$1`, [houseB])).rows) {
      for (const id of row.r.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) found.add(id);
    }
  }
  for (const id of [houseA, users.adminA, users.guardianA, users.educatorA]) found.delete(id);
  return found;
}

test("the full migration chain applies in order, ending with the 041 signup fix", async () => {
  const { db, files } = await database();
  try {
    assert.ok(files.length >= 41, `expected at least 41 migrations, found ${files.length}`);
    assert.equal(files.at(-1), "202608280041_secure_beta_signup.sql");
    const old = await db.query(`select 1 from pg_proc where proname='provision_household_from_signup'`);
    assert.equal(old.rows.length, 0, "037's anon-callable signup function must be gone");
  } finally { await db.close(); }
});

test("anon can execute no SECURITY DEFINER function in public", async () => {
  const { db } = await database();
  try {
    const exposed = (await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
         and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')`)).rows.map((r) => r.proname);
    assert.deepEqual(exposed, [], `definer functions an unauthenticated caller can run: ${exposed.join(", ")}`);
  } finally { await db.close(); }
});

test("every public table has RLS, and no household A actor reads a household B row", async () => {
  const { db } = await database();
  try {
    const { tables } = await catalog(db);
    assert.deepEqual(tables.filter((t) => !t.rls).map((t) => t.name), [], "tables without RLS");
    const scoped = tables.filter((t) => t.scoped).map((t) => t.name);
    for (const name of UNSEEDED.keys()) assert.ok(scoped.includes(name), `UNSEEDED names ${name}, which is not a household table`);

    const problems = [];
    for (const name of scoped) {
      const seededB = Number((await db.query(`select count(*) as n from public.${name} where household_id=$1`, [houseB])).rows[0].n);
      if (UNSEEDED.has(name)) {
        if (seededB > 0) problems.push(`${name} is seeded now; remove it from UNSEEDED`);
      } else if (seededB === 0) {
        problems.push(`${name}: the seed gives household B no rows, so the check would be vacuous (seed it, or add it to UNSEEDED with a reason)`);
      }
      for (const [label, id] of [...actorsA, ["admin B", users.adminB]]) {
        const foreign = label === "admin B" ? houseA : houseB;
        const { rows } = await as(db, "authenticated", id, () => db.query(`select count(*) as n from public.${name} where household_id=$1`, [foreign]));
        if (Number(rows[0].n) !== 0) problems.push(`${name}: ${label} reads ${rows[0].n} foreign row(s)`);
      }
    }
    for (const [label, id] of actorsA) {
      const { rows } = await as(db, "authenticated", id, () => db.query(`select count(*) as n from public.households where id=$1`, [houseB]));
      if (Number(rows[0].n) !== 0) problems.push(`households: ${label} reads household B`);
    }
    assert.deepEqual(problems, []);
  } finally { await db.close(); }
});

test("no household A actor can update or delete a household B row", async () => {
  const { db } = await database();
  try {
    const { tables } = await catalog(db);
    const problems = [];
    for (const table of tables.filter((t) => t.scoped)) {
      const { name } = table;
      const before = await fingerprintB(db, [table]);
      // Targeted probes read household_id, so SELECT policies also apply. The blind ones read no
      // column, so only the UPDATE/DELETE policies stand between the caller and household B.
      const probes = [
        [`update public.${name} set household_id=household_id where household_id='${houseB}'`, true],
        [`update public.${name} set household_id='${houseA}' where household_id='${houseB}'`, true],
        [`delete from public.${name} where household_id='${houseB}'`, true],
        [`update public.${name} set household_id='${houseA}'`, false],
        [`delete from public.${name}`, false],
      ];
      // Rewriting household_id is also stopped by the tenant foreign keys (017), which would mask
      // a permissive UPDATE policy. A constant write to an unconstrained column is not.
      if (table.touchable) probes.push([`update public.${name} set ${table.touchable} = now()`, false]);
      for (const [label, id] of actorsA) {
        for (const [sql, targeted] of probes) {
          const { result, error, after } = await attempt(db, id, sql, () => fingerprintB(db, [table]));
          if (error && targeted && !DENIED.test(error.message)) problems.push(`${label}: "${sql}" failed for a non-authorization reason: ${error.message}`);
          if (result && targeted && result.affectedRows !== 0) problems.push(`${label}: "${sql}" affected ${result.affectedRows} row(s)`);
          if (result && after !== before) problems.push(`${label}: "${sql}" changed household B's ${name}`);
        }
      }
    }
    const house = await fingerprintB(db, []);
    for (const [label, id] of actorsA) {
      for (const sql of [`delete from public.households where id='${houseB}'`, `delete from public.households`, `update public.households set display_name='probe'`]) {
        const { result, after } = await attempt(db, id, sql, () => fingerprintB(db, []));
        if (result && after !== house) problems.push(`${label}: "${sql}" changed household B`);
      }
    }
    assert.deepEqual(problems, []);
  } finally { await db.close(); }
});

test("every SECURITY DEFINER RPC refuses household A actors aimed at household B", async () => {
  const { db } = await database();
  try {
    const { tables, rpcs } = await catalog(db);
    const foreignIds = await uuidsOfB(db, tables);
    const before = await fingerprintB(db, tables);
    const problems = [];
    let swept = 0;
    for (const rpc of rpcs) {
      if (NON_HOUSEHOLD_RPCS.has(rpc.name)) continue;
      if (!rpc.argnames.includes("target_household")) {
        problems.push(`${rpc.name} takes no target_household; sweep it or list it in NON_HOUSEHOLD_RPCS with a reason`);
        continue;
      }
      const args = [];
      for (const [index, name] of rpc.argnames.entries()) {
        const type = rpc.argtypes[index];
        if (type === "uuid") {
          if (!FOREIGN_ARGUMENT[name]) { problems.push(`${rpc.name}(${name} uuid): add a FOREIGN_ARGUMENT mapping`); continue; }
          const value = (await db.query(FOREIGN_ARGUMENT[name])).rows[0]?.id;
          if (!value) { problems.push(`${rpc.name}: the seed has no household B row for ${name}`); continue; }
          args.push(`'${value}'::uuid`);
        } else if (PLACEHOLDER[type]) {
          args.push(PLACEHOLDER[type]);
        } else {
          problems.push(`${rpc.name}(${name} ${type}): add a PLACEHOLDER for this type`);
        }
      }
      if (args.length !== rpc.argnames.length) continue;
      swept += 1;
      const sql = `select * from public.${rpc.name}(${args.join(", ")})`;
      const passed = new Set(args.map((a) => a.match(/'([0-9a-f-]{36})'/)?.[1]).filter(Boolean));
      for (const [label, id] of actorsA) {
        const { result, error, after } = await attempt(db, id, sql, () => fingerprintB(db, tables));
        if (error) {
          if (!DENIED.test(error.message)) problems.push(`${rpc.name} as ${label}: inconclusive -- failed before any authorization check: ${error.message}`);
          continue;
        }
        const leaked = (JSON.stringify(result.rows).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])
          .filter((value) => foreignIds.has(value) && !passed.has(value));
        if (after !== before) problems.push(`${rpc.name} as ${label}: changed household B's data`);
        if (leaked.length) problems.push(`${rpc.name} as ${label}: returned household B identifiers ${[...new Set(leaked)].join(", ")}`);
      }
    }
    assert.deepEqual(problems, []);
    assert.ok(swept >= 30, `expected to sweep the household RPC surface, swept ${swept}`);
    assert.equal(await fingerprintB(db, tables), before, "an RPC probe changed household B");

    const plan = (await db.query(`select id from public.plans where household_id=$1 limit 1`, [houseB])).rows[0].id;
    for (const [label, id] of actorsA) {
      const { rows } = await as(db, "authenticated", id, () => db.query(`select public.can_read_plan($1) as ok`, [plan]));
      assert.equal(rows[0].ok, false, `can_read_plan admits ${label} to household B's plan`);
    }
  } finally { await db.close(); }
});

test("beta signup provisions only the signed-in, email-confirmed caller", async () => {
  const { db } = await database();
  try {
    const call = `select * from public.provision_beta_household('SYNTHETIC Signup Learner', 'Grade 3', 'Ontario')`;
    // No caller at all: the anon role cannot even execute it.
    await assert.rejects(() => as(db, "anon", null, () => db.query(call)), /permission denied/);

    const fresh = "5eed0000-0000-4000-8000-0000000000f1";
    await db.query(`insert into auth.users(id, email) values ($1, 'seed-fresh@britelink.invalid')`, [fresh]);
    // Signed up but never followed the link.
    await assert.rejects(() => as(db, "authenticated", fresh, () => db.query(call)), /confirmed email required/);

    await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [fresh]);
    const first = (await as(db, "authenticated", fresh, () => db.query(call))).rows[0];
    assert.equal(first.created, true);
    const again = (await as(db, "authenticated", fresh, () => db.query(call))).rows[0];
    assert.deepEqual(again, { ...first, created: false }, "a second call must return the same household, not a new one");
    const role = (await db.query(`select role, household_id from public.memberships where user_id=$1`, [fresh])).rows;
    assert.deepEqual(role, [{ role: "guardian", household_id: first.household_id }]);

    // An existing member gets their own household back and nothing is created.
    const existing = (await as(db, "authenticated", users.guardianA, () => db.query(call))).rows[0];
    assert.deepEqual([existing.household_id, existing.created], [houseA, false]);
    const households = Number((await db.query(`select count(*) as n from public.households`)).rows[0].n);
    assert.equal(households, 3, "only the fresh account's household is new");
  } finally { await db.close(); }
});
