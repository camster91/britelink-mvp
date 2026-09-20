// Regression test for migration 040: a guardian can insert a lesson activity and read it back.
//
// Why this exists: saving lesson progress failed with 42501 for every signed-in guardian even
// though the INSERT was always allowed. PostgREST wraps writes in a CTE that re-reads the
// inserted row, so the SELECT policy runs on the new row. The SELECT policy required
// can_read_plan(activity_plan_id(id)), but a brand-new activity has no plan link, so
// can_read_plan(NULL) was false and the whole statement aborted with a misleading
// "new row violates row-level security policy" error against the INSERT.
//
// Migration 040 permits unlinked rows (activity_plan_id(id) IS NULL) within the caller's own
// household. This test pins that behaviour, and pins that cross-household reads stay blocked.
//
// The fixture loads only the migrations this behaviour needs, so it stays independent of the
// broader RLS fixture (which models a partial Supabase surface and cannot load 022-040 without
// a test-modernisation pass).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ids = {
  houseA: "10000000-0000-0000-0000-000000000001",
  houseB: "10000000-0000-0000-0000-000000000002",
  guardianA: "20000000-0000-0000-0000-000000000001",
  guardianB: "20000000-0000-0000-0000-000000000002",
  educatorA: "20000000-0000-0000-0000-000000000003",
  learnerA: "30000000-0000-0000-0000-000000000001",
  learnerB: "30000000-0000-0000-0000-000000000002",
  caseA: "40000000-0000-0000-0000-000000000001",
  planA: "50000000-0000-0000-0000-000000000001",
  weekA: "60000000-0000-0000-0000-000000000001",
  dayA: "70000000-0000-0000-0000-000000000001",
  lessonA: "80000000-0000-0000-0000-000000000001",
};

// Only what this behaviour needs: core schema, the policy-gate chain, and migration 040.
const FIXTURE_MIGRATIONS = [
  "202608280001_core.sql",
  "202608280002_operations.sql",
  "202608280007_staff_authoring_delivery.sql",
  "202608280024_plan_publication_isolation.sql",
  "202608280030_fix_activities_publication_leak.sql",
  "202608280031_close_for_all_select_bypass.sql",
  "202608280040_lesson_activity_readback.sql",
];

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(
    `create schema auth;
     create table auth.users(id uuid primary key);
     create role authenticated nologin; create role service_role nologin;
     create function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
     $$;`,
  );
  for (const file of FIXTURE_MIGRATIONS) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec(`grant usage on schema public,auth to authenticated;
                 grant select,insert,update,delete on all tables in schema public to authenticated;
                 grant usage,select on all sequences in schema public to authenticated;`);
  await db.query(`insert into auth.users(id) values ($1),($2),($3)`, [
    ids.guardianA, ids.guardianB, ids.educatorA,
  ]);
  await db.query(`insert into public.households(id,display_name) values ($1,'Morgan'),($2,'Taylor')`, [
    ids.houseA, ids.houseB,
  ]);
  await db.query(
    `insert into public.memberships(household_id,user_id,role)
     values ($1,$2,'guardian'),($1,$3,'educator'),($4,$5,'guardian')`,
    [ids.houseA, ids.guardianA, ids.educatorA, ids.houseB, ids.guardianB],
  );
  await db.query(
    `insert into public.learners(id,household_id,preferred_name,grade_label,jurisdiction)
     values ($1,$2,'Riley','Grade 4','Ontario'),($3,$4,'Sam','Grade 5','Ontario')`,
    [ids.learnerA, ids.houseA, ids.learnerB, ids.houseB],
  );
  await db.query(`insert into public.service_cases(id,household_id,learner_id,package_code)
                  values ($1,$2,$3,'complete')`, [ids.caseA, ids.houseA, ids.learnerA]);
  await db.query(
    `insert into public.plans(id,household_id,case_id,learner_id,status,authored_by)
     values ($1,$2,$3,$4,'published',$5)`,
    [ids.planA, ids.houseA, ids.caseA, ids.learnerA, ids.educatorA],
  );
  await db.query(`insert into public.plan_weeks(id,household_id,plan_id,week_number,theme)
                  values ($1,$2,$3,1,'Patterns')`, [ids.weekA, ids.houseA, ids.planA]);
  await db.query(`insert into public.plan_days(id,household_id,week_id,day_number)
                  values ($1,$2,$3,1)`, [ids.dayA, ids.houseA, ids.weekA]);
  await db.query(
    `insert into public.lessons(id,household_id,day_id,position,subject,title,objective,instructions)
     values ($1,$2,$3,1,'Math','Patterns','Notice patterns','[]')`,
    [ids.lessonA, ids.houseA, ids.dayA],
  );
  return db;
}

async function asUser(db, userId, fn) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

test("a guardian can insert a lesson activity and read the row back (migration 040)", async () => {
  const db = await database();

  // The exact shape the app issues: insert and ask for the row back. Before migration 040 this
  // aborted with 42501 because the read-back hit the SELECT policy on an unlinked row.
  const inserted = await asUser(db, ids.guardianA, () =>
    db.query(
      `insert into public.lesson_activities(household_id,learner_id,lesson_id,status,updated_by)
       values ($1,$2,$3,'in_progress',$4)
       returning id, status`,
      [ids.houseA, ids.learnerA, ids.lessonA, ids.guardianA],
    ),
  );
  assert.equal(inserted.rows.length, 1, "the guardian's insert must return the new row");
  assert.equal(inserted.rows[0].status, "in_progress");

  // The same statement must also work without asking for the row back.
  await asUser(db, ids.guardianA, () =>
    db.query(
      `insert into public.lesson_activities(household_id,learner_id,lesson_id,status,updated_by)
       values ($1,$2,$3,'completed',$4)`,
      [ids.houseA, ids.learnerA, ids.lessonA, ids.guardianA],
    ),
  );
});

test("the read-back fix does not widen cross-household access (migration 040)", async () => {
  const db = await database();

  // Seed an unlinked activity in household A as its guardian.
  await asUser(db, ids.guardianA, () =>
    db.query(
      `insert into public.lesson_activities(household_id,learner_id,lesson_id,status,updated_by)
       values ($1,$2,$3,'in_progress',$4)`,
      [ids.houseA, ids.learnerA, ids.lessonA, ids.guardianA],
    ),
  );

  // Household B's guardian must still see nothing, and must not be able to write into A.
  const seen = await asUser(db, ids.guardianB, () =>
    db.query(`select id from public.lesson_activities`),
  );
  assert.equal(seen.rows.length, 0, "cross-household reads must remain blocked");

  await assert.rejects(
    () =>
      asUser(db, ids.guardianB, () =>
        db.query(
          `insert into public.lesson_activities(household_id,learner_id,lesson_id,status,updated_by)
           values ($1,$2,$3,'in_progress',$4)`,
          [ids.houseA, ids.learnerA, ids.lessonA, ids.guardianB],
        ),
      ),
    /row-level security/i,
    "a foreign guardian must not write into another household",
  );
});
