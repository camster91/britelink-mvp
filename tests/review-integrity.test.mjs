// Migrations 053 (review integrity) and 054 (privacy integrity), exercised against the real migration chain in PGlite with the
// synthetic staging seed: co-guardian lesson updates, delivered-requires-delivery, the approved-plan
// resource freeze, same-plan substitutes, and publication requiring the latest review to approve.
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
const id = (suffix) => `5eed0000-0000-4000-8000-000000000${suffix}`;
const CASE_A = id("a20"), PLAN_A = id("a30"), LESSON_A = id("a50"), ACTIVITY_A = id("a51"), RESOURCE_A = id("a60"), RESOURCE_B = id("b60");

function preprocessSeed(sql, vars) {
  const out = [];
  const branch = [];
  for (const line of sql.split("\n")) {
    if (/^\\if\b/.test(line)) { branch.push(true); continue; }
    if (/^\\else\b/.test(line)) { branch.push(!branch.pop()); continue; }
    if (/^\\endif\b/.test(line)) { branch.pop(); continue; }
    if (branch.includes(false) || line.startsWith("\\") || /^\s*--/.test(line)) continue;
    out.push(line.replace(/:'(\w+)'/g, (_, name) => `'${vars[name]}'`));
  }
  return out.join("\n");
}

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(await read("scripts/migration-harness/supabase-shim.sql"));
  await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  const files = (await readdir(new URL("supabase/migrations/", root))).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) await db.exec(await read(`supabase/migrations/${file}`));
  await db.exec(await read("supabase/storage-policies.sql"));
  await db.exec(preprocessSeed(await read("supabase/seed/synthetic-staging.sql"), {
    admin_a: users.adminA, guardian_a: users.guardianA, educator_a: users.educatorA, admin_b: users.adminB,
  }));
  return db;
}

// Runs sql as an authenticated user inside a transaction that is always rolled back.
async function asUser(db, userId, sql) {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
    return { result: await db.query(sql) };
  } catch (error) {
    return { error };
  } finally {
    await db.exec("rollback");
  }
}

// Runs sql as the superuser (triggers still apply) inside a rolled-back transaction.
async function asOwner(db, sql) {
  await db.exec("begin");
  try { await db.exec(sql); return {}; } catch (error) { return { error }; } finally { await db.exec("rollback"); }
}

test("migration 053 integrity rules", async (t) => {
  const db = await database();
  try {
    await t.test("a second guardian/admin can update a lesson another guardian last touched", async () => {
      const { error, result } = await asUser(db, users.adminA,
        `update public.lesson_activities set status='completed', updated_by='${users.adminA}' where id='${ACTIVITY_A}' returning id`);
      assert.equal(error, undefined, error?.message);
      assert.equal(result.rows.length, 1);
    });

    await t.test("a writer still cannot stamp someone else as updated_by", async () => {
      const { error } = await asUser(db, users.adminA,
        `update public.lesson_activities set status='completed', updated_by='${users.guardianA}' where id='${ACTIVITY_A}'`);
      assert.match(String(error?.message), /row-level security/);
    });

    await t.test("another household still cannot update the lesson", async () => {
      const { result } = await asUser(db, users.adminB,
        `update public.lesson_activities set status='completed', updated_by='${users.adminB}' where id='${ACTIVITY_A}' returning id`);
      assert.equal(result?.rows.length ?? 0, 0);
    });

    await t.test("a case cannot become delivered without a sent delivery of its published plan", async () => {
      const { error } = await asOwner(db, `delete from public.deliveries where case_id='${CASE_A}';
        update public.service_cases set status='published' where id='${CASE_A}';
        update public.service_cases set status='delivered' where id='${CASE_A}';`);
      assert.match(String(error?.message), /record the delivery/);
    });

    await t.test("a case with a sent delivery can become delivered", async () => {
      const { error } = await asOwner(db, `update public.service_cases set status='published' where id='${CASE_A}';
        update public.service_cases set status='delivered' where id='${CASE_A}';`);
      assert.equal(error, undefined, error?.message);
    });

    await t.test("resources cannot be added to an approved plan", async () => {
      const { error } = await asOwner(db, `insert into public.resources (household_id, plan_id, lesson_id, title, requirement, access_type)
        values ('5eed0000-0000-4000-8000-0000000000a1', '${PLAN_A}', '${LESSON_A}', 'Late addition', 'optional', 'free');`);
      assert.match(String(error?.message), /approved/);
    });

    await t.test("a substitute must be another resource on the same plan", async () => {
      const unapprove = `delete from public.plan_reviews where plan_id='${PLAN_A}';`;
      const foreign = await asOwner(db, `${unapprove} update public.resources set substitute_resource_id='${RESOURCE_B}' where id='${RESOURCE_A}';`);
      assert.match(String(foreign.error?.message), /same plan/);
      const self = await asOwner(db, `${unapprove} update public.resources set substitute_resource_id='${RESOURCE_A}' where id='${RESOURCE_A}';`);
      assert.match(String(self.error?.message), /same plan/);
      const sameHouse = "5eed0000-0000-4000-8000-0000000000a1";
      const ok = await asOwner(db, `${unapprove}
        insert into public.resources (id, household_id, plan_id, lesson_id, title, requirement, access_type)
          values ('5eed0000-0000-4000-8000-0000000000c1', '${sameHouse}', '${PLAN_A}', '${LESSON_A}', 'Library copy', 'substitute', 'library');
        update public.resources set substitute_resource_id='5eed0000-0000-4000-8000-0000000000c1' where id='${RESOURCE_A}';`);
      assert.equal(ok.error, undefined, ok.error?.message);
    });

    await t.test("publication needs the latest review to be an approval", async () => {
      const house = "5eed0000-0000-4000-8000-0000000000a1";
      const reopen = `update public.plans set status='internal_review', published_at=null where id='${PLAN_A}';`;
      const rejectedLater = await asOwner(db, `${reopen}
        insert into public.plan_reviews (household_id, plan_id, reviewer_user_id, created_at)
          values ('${house}', '${PLAN_A}', '${users.adminA}', now() + interval '1 minute');
        update public.plans set status='published', published_at=now() where id='${PLAN_A}';`);
      assert.match(String(rejectedLater.error?.message), /latest internal review/);
      const approved = await asOwner(db, `${reopen} update public.plans set status='published', published_at=now() where id='${PLAN_A}';`);
      assert.equal(approved.error, undefined, approved.error?.message);
      const none = await asOwner(db, `${reopen} delete from public.plan_reviews where plan_id='${PLAN_A}';
        update public.plans set status='published', published_at=now() where id='${PLAN_A}';`);
      assert.match(String(none.error?.message), /latest internal review/);
    });
    await t.test("054: withdrawing consent withdraws every active consent that guardian gave for the learner", async () => {
      const house = "5eed0000-0000-4000-8000-0000000000a1", learner = id("a10");
      await db.exec("begin");
      try {
        // A second intake version records a second, newer consent.
        await db.query(`insert into public.guardian_consents (id, household_id, learner_id, guardian_user_id, notice_version, purposes, consented_at)
          values ('5eed0000-0000-4000-8000-0000000000c2', $1, $2, $3, 'synthetic-v1', array['service_delivery'], now() + interval '1 minute')`, [house, learner, users.guardianA]);
        await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${users.guardianA}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
        await db.query(`select public.withdraw_guardian_consent($1, '5eed0000-0000-4000-8000-0000000000c2')`, [house]);
        await db.exec("reset role");
        const active = (await db.query(`select count(*)::int as n from public.guardian_consents where learner_id=$1 and withdrawn_at is null`, [learner])).rows[0].n;
        assert.equal(active, 0, "the older consent from the first intake is withdrawn too");
        const consent = (await db.query(`select public.has_active_guardian_consent($1, $2) as on`, [house, learner])).rows[0].on;
        assert.equal(consent, false);
        const held = (await db.query(`select status from public.service_cases where id=$1`, [CASE_A])).rows[0].status;
        assert.equal(held, "on_hold");
        await assert.rejects(() => db.query(`update public.service_cases set status='assigned' where id=$1`, [CASE_A]), /no active guardian consent/,
          "staff cannot resume a case whose consent was withdrawn");
      } finally {
        await db.exec("rollback");
      }
    });

    await t.test("054: a paused case with active consent can resume", async () => {
      const { error } = await asOwner(db, `update public.service_cases set status='on_hold' where id='${CASE_A}';
        update public.service_cases set status='assigned' where id='${CASE_A}';`);
      assert.equal(error, undefined, error?.message);
    });

    await t.test("055: a paused, cancelled or chargeback case cannot be marked revised", async () => {
      for (const from of ["on_hold", "chargeback", "cancelled", "acknowledged"]) {
        const { error } = await asOwner(db, `update public.service_cases set status='${from}' where id='${CASE_A}';
          update public.service_cases set status='revised' where id='${CASE_A}';`);
        assert.match(String(error?.message), /open revision request/, `from ${from}`);
      }
    });

    await t.test("055: a case with an open revision request can be marked revised", async () => {
      const { error } = await asOwner(db, `update public.service_cases set status='revision_requested' where id='${CASE_A}';
        update public.service_cases set status='revised' where id='${CASE_A}';`);
      assert.equal(error, undefined, error?.message);
    });
  } finally {
    await db.close();
  }
});
