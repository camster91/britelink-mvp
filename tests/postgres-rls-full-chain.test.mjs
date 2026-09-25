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
  target_capture: `select id from public.learning_captures where household_id='${houseB}' limit 1`,
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
  date: "current_date",
  "smallint[]": "array[1,3,5]::smallint[]",
  "date[]": "array[current_date]::date[]",
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
  // Supabase's own init script (supabase/postgres, migrations/db/init-scripts/00000000000000-
  // initial-schema.sql, as shipped in the 15.8.1.060 image the self-hosted stack runs) grants these
  // to every client role for everything later created in public. A migration's "revoke ... from
  // public" does not remove a grant made directly to anon or authenticated, so without this line
  // the fixture would be stricter than production and hide exactly that class of mistake.
  await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
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

test("the full migration chain applies in order, including the 041 signup fix", async () => {
  const { db, files } = await database();
  try {
    assert.ok(files.length >= 42, `expected at least 42 migrations, found ${files.length}`);
    assert.ok(files.includes("202608280041_secure_beta_signup.sql"));
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

// Client write privileges, as the catalog reports them under Supabase's default grants. 014 meant
// writes to be this narrow; 042 makes it true on a real project. It is also what makes the hosted
// D2 probe insert.case_messages conclusive: the privilege check refuses the forged row with 42501
// before the rate-limit trigger (011) can answer with an ambiguous P0001.
const CLIENT_WRITABLE = new Map([
  ["lesson_activities", "INSERT,UPDATE"],
  ["case_message_reads", "INSERT,UPDATE"],
]);

test("client roles hold only the allowlisted write privileges, and forged inserts are refused as authorization denials", async () => {
  const { db } = await database();
  try {
    const writable = (await db.query(`
      select c.relname as name, r.rolname as role,
             string_agg(p.privilege_type, ',' order by p.privilege_type) as privileges
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        cross join (values ('anon'), ('authenticated')) as r(rolname)
        cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(privilege_type)
       where n.nspname='public' and c.relkind='r' and has_table_privilege(r.rolname, c.oid, p.privilege_type)
       group by 1, 2 order by 1, 2`)).rows;
    const expected = [...CLIENT_WRITABLE].map(([name, privileges]) => ({ name, role: "authenticated", privileges })).sort((x, y) => x.name.localeCompare(y.name));
    assert.deepEqual(writable, expected);

    const problems = [];
    const guarded = (await db.query(`
      select distinct c.relname as name from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_proc p on p.oid=t.tgfoid where p.proname='enforce_insert_rate_limit' and not t.tgisinternal order by 1`)).rows.map((r) => r.name);
    assert.ok(guarded.includes("case_messages"));
    for (const name of guarded) {
      for (const [label, id] of actorsA) {
        const { error } = await attempt(db, id, `insert into public.${name}(household_id) values ('${houseB}')`);
        if (!error) problems.push(`${label}: ${name} accepted a household B row`);
        else if (error.code !== "42501") problems.push(`${label}: ${name} refused with ${error.code} (${error.message}), not 42501`);
      }
    }
    assert.deepEqual(problems, []);

    // The scanner still works: service_role keeps what 023's adapter calls.
    for (const fn of ["admin_list_pending_scan_attachments(integer)", "admin_reconcile_attachment_objects(uuid,text[])"]) {
      const { rows } = await db.query(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') as ok, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as client`);
      assert.deepEqual(rows[0], { ok: true, client: false }, fn);
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

test("a guardian sets their own plan calendar; staff cannot; the export carries it", async () => {
  const { db } = await database();
  try {
    const planA = "5eed0000-0000-4000-8000-000000000a30";
    const set = (who, days, off = "array[]::date[]", plan = planA) => as(db, "authenticated", who, () => db.query(
      `select * from public.set_plan_schedule('${houseA}', '${plan}', '2026-10-05', ${days}, ${off})`));
    const saved = (await set(users.guardianA, "array[5,1,1,3]::smallint[]", "array['2026-10-09','2026-10-09']::date[]")).rows[0];
    assert.deepEqual([saved.start_date instanceof Date ? saved.start_date.toISOString().slice(0, 10) : saved.start_date, saved.school_days, saved.days_off.length],
      ["2026-10-05", [1, 3, 5], 1], "school days are de-duplicated and sorted, days off de-duplicated");
    await assert.rejects(() => set(users.educatorA, "array[1]::smallint[]"), /guardian access required/);
    await assert.rejects(() => set(users.guardianA, "array[8]::smallint[]"), /school days are invalid/);
    await assert.rejects(() => set(users.guardianA, "array[]::smallint[]"), /school days are invalid/);
    // Only published plans get a family calendar.
    await db.query(`update public.plans set status='draft' where id=$1`, [planA]);
    await assert.rejects(() => set(users.guardianA, "array[1]::smallint[]"), /plan not found/);
    await db.query(`update public.plans set status='published' where id=$1`, [planA]);

    // The export sits behind require_recent_authentication (021), which reads the token's iat.
    const exported = (await as(db, "authenticated", users.guardianA, () => db.query(`select public.export_guardian_household($1) as payload`, [houseA]))).rows[0].payload;
    assert.equal(exported.schemaVersion, 2);
    assert.ok(exported.manifest.included.includes("planSchedules"));
    assert.deepEqual(exported.planSchedules.map((row) => [row.plan_id, row.school_days]), [[planA, [1, 3, 5]]]);
    assert.ok(Array.isArray(exported.lessons), "the wrapped export keeps the original payload");
  } finally { await db.close(); }
});

test("educators can tag lessons with what fits today; bad tags are refused; the export carries them", async () => {
  const { db } = await database();
  try {
    const caseA = "5eed0000-0000-4000-8000-000000000a20";
    // 028's package entitlement caps plan weeks per case; a one-week plan stays inside it.
    await db.query(`update public.service_cases set status='drafting' where id=$1`, [caseA]);
    const lesson = (extra) => ({ position: 1, subject: "Math", title: "Count", objective: "Count to 20", instructions: ["Count"], ...extra });
    const author = (lessons) => as(db, "authenticated", users.educatorA, () => db.query(
      `select * from public.staff_create_plan_version($1, $2, $3::jsonb)`,
      [houseA, caseA, JSON.stringify({ weeks: [{ number: 1, theme: "Numbers", days: [{ number: 1, lessons }] }] })]));
    const created = (await author([
      lesson({ estimatedMinutes: 20, helpLevel: "independent", needsScreen: false }),
      lesson({ position: 2 }),
    ])).rows[0];
    const stored = (await db.query(`
      select l.position, l.estimated_minutes, l.help_level, l.needs_screen from public.lessons l
        join public.plan_days d on d.id=l.day_id join public.plan_weeks w on w.id=d.week_id
       where w.plan_id=$1 order by l.position`, [created.plan_id])).rows;
    assert.deepEqual(stored, [
      { position: 1, estimated_minutes: 20, help_level: "independent", needs_screen: false },
      { position: 2, estimated_minutes: null, help_level: null, needs_screen: null },
    ], "tags are stored; an untagged lesson stays untagged");
    for (const [bad, message] of [
      [{ estimatedMinutes: 3 }, /estimated minutes are invalid/],
      [{ estimatedMinutes: "twenty" }, /estimated minutes are invalid/],
      [{ helpLevel: "mostly" }, /help level is invalid/],
      [{ needsScreen: "yes" }, /needs screen must be true or false/],
    ]) await assert.rejects(() => author([lesson(bad)]), message);

    const exported = (await as(db, "authenticated", users.guardianA, () => db.query(`select public.export_guardian_household($1) as payload`, [houseA]))).rows[0].payload;
    const tagged = exported.lessons.find((row) => row.estimated_minutes === 20);
    assert.deepEqual([tagged?.help_level, tagged?.needs_screen], ["independent", false]);
    assert.ok(exported.manifest.included.includes("planSchedules"), "044's wrapper keeps 043's addition");
  } finally { await db.close(); }
});

// 034 rebuilt submit_guardian_intake to advance the case and silently dropped every check 004 made on
// the planning context; 045 restores them. This pins both halves: the validation and the advance.
test("guardian intake refuses unsupported or oversized context and still advances the case", async () => {
  const { db } = await database();
  try {
    const learnerA = "5eed0000-0000-4000-8000-000000000a10", caseA = "5eed0000-0000-4000-8000-000000000a20";
    const context = { subjects: ["Language", "Math"], priorAttainment: "Reads short paragraphs", strengthsInterests: "Machines", goals: "Fluency", learningSupports: "", language: "English", weeklySchedule: "Mornings", caregiverAvailability: "Daily", deviceAccess: "tablet", resourceBudget: "free_only", contentConstraints: "", accessibilityNeeds: "", planningStructure: "weekly_goals" };
    const submit = (ctx, who = users.guardianA) => as(db, "authenticated", who, () => db.query(
      `select * from public.submit_guardian_intake($1, $2, 'notice-v1', array['personalized_learning_plan'], $3::jsonb)`, [houseA, learnerA, JSON.stringify(ctx)]));
    for (const [bad, message] of [
      [{ ...context, diagnosis: "ADHD" }, /unsupported fields/],
      [{ ...context, goals: "x".repeat(1001) }, /goals are required/],
      [{ ...context, subjects: ["Diagnosis"] }, /subject is invalid/],
      [{ ...context, deviceAccess: "always_online" }, /access or budget option is invalid/],
      [{ ...context, planningStructure: "school_at_home" }, /planning structure is invalid/],
    ]) await assert.rejects(() => submit(bad), message);
    await assert.rejects(() => submit(context, users.adminA), /guardian access required/);

    await db.query(`update public.service_cases set status='intake_pending' where id=$1`, [caseA]);
    const saved = (await submit(context)).rows[0];
    assert.ok(saved.profile_version >= 1);
    const stored = (await db.query(`select planning_context->>'planningStructure' as structure from public.learner_profiles where id=$1`, [saved.profile_id])).rows[0];
    assert.equal(stored.structure, "weekly_goals");
    const { planningStructure, ...olderClient } = context;
    await submit(olderClient); // an older client that does not send the new key still works
    const advanced = (await db.query(`select status from public.service_cases where id=$1`, [caseA])).rows[0];
    assert.equal(advanced.status, "submitted", "034's case advance is kept");

    await db.query(`update public.learners set deleted_at=now() where id=$1`, [learnerA]);
    await assert.rejects(() => submit(context), /learner not found in household/);
  } finally { await db.close(); }
});

test("a guardian records and removes learning outside the plan; bad input and staff are refused; the export carries it", async () => {
  const { db } = await database();
  try {
    const learnerA = "5eed0000-0000-4000-8000-000000000a10";
    const record = (who, { date = "current_date", kind = "'book'", subjects = "array['Language','Language']::text[]", note = "'Read a chapter book together'" } = {}) =>
      as(db, "authenticated", who, () => db.query(`select * from public.record_learning_capture('${houseA}', '${learnerA}', ${date}, ${kind}, ${subjects}, ${note})`));
    const saved = (await record(users.guardianA)).rows[0];
    const row = (await db.query(`select kind, subjects, note from public.learning_captures where id=$1`, [saved.capture_id])).rows[0];
    assert.deepEqual(row, { kind: "book", subjects: ["Language"], note: "Read a chapter book together" });
    await assert.rejects(() => record(users.educatorA), /guardian access required/);
    for (const [bad, message] of [
      [{ date: "current_date + 30" }, /capture date is out of range/],
      [{ kind: "'therapy'" }, /capture kind is invalid/],
      [{ subjects: "array['Diagnosis']::text[]" }, /subject is invalid/],
      [{ note: "'   '" }, /capture note is required/],
      [{ note: `'${"x".repeat(1001)}'` }, /capture note is required/],
    ]) await assert.rejects(() => record(users.guardianA, bad), message);

    const removedAt = (await as(db, "authenticated", users.guardianA, () => db.query(`select public.remove_learning_capture($1, $2) as at`, [houseA, saved.capture_id]))).rows[0].at;
    assert.ok(removedAt);
    await assert.rejects(() => as(db, "authenticated", users.guardianA, () => db.query(`select public.remove_learning_capture($1, $2)`, [houseA, saved.capture_id])), /capture not found/);

    const exported = (await as(db, "authenticated", users.guardianA, () => db.query(`select public.export_guardian_household($1) as payload`, [houseA]))).rows[0].payload;
    assert.ok(exported.manifest.included.includes("learningCaptures"));
    const mine = exported.learningCaptures.find((item) => item.id === saved.capture_id);
    assert.ok(mine?.removed_at, "a removed capture is still accounted for in the export");
    assert.ok(exported.learningCaptures.every((item) => item.learner_id === learnerA), "only household A's captures are exported");
    assert.ok(exported.manifest.included.includes("planSchedules") && Array.isArray(exported.planSchedules), "043's addition is kept");
  } finally { await db.close(); }
});

test("a guardian pauses and resumes a plan subject; unknown subjects and staff are refused; the export carries it", async () => {
  const { db } = await database();
  try {
    const planA = "5eed0000-0000-4000-8000-000000000a30";
    const subject = (await db.query(`select l.subject from public.lessons l join public.plan_days d on d.id=l.day_id join public.plan_weeks w on w.id=d.week_id where w.plan_id=$1 limit 1`, [planA])).rows[0].subject;
    const pause = (who, subjects) => as(db, "authenticated", who, () => db.query(`select public.set_paused_subjects($1, $2, $3::text[]) as paused`, [houseA, planA, subjects]));
    assert.deepEqual((await pause(users.guardianA, [subject, subject, " "])).rows[0].paused, [subject]);
    await assert.rejects(() => pause(users.guardianA, ["Underwater basket weaving"]), /subject is not in this plan/);
    await assert.rejects(() => pause(users.educatorA, [subject]), /guardian access required/);
    const exported = (await as(db, "authenticated", users.guardianA, () => db.query(`select public.export_guardian_household($1) as payload`, [houseA]))).rows[0].payload;
    assert.deepEqual(exported.planSchedules.find((row) => row.plan_id === planA)?.paused_subjects, [subject]);
    assert.ok(Array.isArray(exported.learningCaptures), "046's addition is kept");
    assert.deepEqual((await pause(users.guardianA, [])).rows[0].paused, [], "resume by clearing");

    // A calendar row created only by pausing is not a calendar choice; choosing one keeps the pause.
    await db.query(`delete from public.plan_schedules where plan_id=$1`, [planA]);
    await pause(users.guardianA, [subject]);
    assert.deepEqual((await db.query(`select calendar_set, start_date, paused_subjects from public.plan_schedules where plan_id=$1`, [planA])).rows[0], { calendar_set: false, start_date: null, paused_subjects: [subject] });
    await as(db, "authenticated", users.guardianA, () => db.query(`select * from public.set_plan_schedule($1, $2, current_date, array[1,2,3]::smallint[], array[]::date[])`, [houseA, planA]));
    const chosen = (await db.query(`select calendar_set, paused_subjects from public.plan_schedules where plan_id=$1`, [planA])).rows[0];
    assert.deepEqual(chosen, { calendar_set: true, paused_subjects: [subject] });
  } finally { await db.close(); }
});
