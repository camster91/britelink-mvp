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

// Runs sql as a second guardian of household A (added for this transaction only), rolled back.
const coGuardianA = "5eed0000-0000-4000-8000-00000000ad05";
async function asCoGuardian(db, sql) {
  await db.exec("begin");
  try {
    await db.exec(`insert into auth.users(id, email, email_confirmed_at) values ('${coGuardianA}', 'co-guardian@britelink.invalid', now());
      insert into public.memberships(household_id, user_id, role) values ('5eed0000-0000-4000-8000-0000000000a1', '${coGuardianA}', 'guardian');`);
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${coGuardianA}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
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
    await t.test("a second guardian can update a lesson another guardian last touched", async () => {
      const { error, result } = await asCoGuardian(db,
        `update public.lesson_activities set status='completed', updated_by='${coGuardianA}' where id='${ACTIVITY_A}' returning id`);
      assert.equal(error, undefined, error?.message);
      assert.equal(result.rows.length, 1);
    });

    await t.test("a writer still cannot stamp someone else as updated_by", async () => {
      const { error } = await asCoGuardian(db,
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

    await t.test("056: revised needs a completed revision whose new plan is published", async () => {
      const toRequested = `update public.service_cases set status='revision_requested' where id='${CASE_A}';`;
      const bare = await asOwner(db, `${toRequested} update public.service_cases set status='revised' where id='${CASE_A}';`);
      assert.match(String(bare.error?.message), /complete the revision/, "the old published plan is not a revision");
      const done = await asOwner(db, `${toRequested}
        update public.revision_requests set status='completed', completed_plan_id='${PLAN_A}', completed_at=now() where id='${id("ab0")}';
        update public.service_cases set status='revised' where id='${CASE_A}';`);
      assert.equal(done.error, undefined, done.error?.message);
    });

    await t.test("056: acknowledged from a revision request needs the request declined", async () => {
      const toRequested = `update public.service_cases set status='revision_requested' where id='${CASE_A}';`;
      const open = await asOwner(db, `${toRequested} update public.service_cases set status='acknowledged' where id='${CASE_A}';`);
      assert.match(String(open.error?.message), /decline the revision request/);
      const declined = await asOwner(db, `${toRequested}
        update public.revision_requests set status='declined', disposition_reason='Out of scope' where id='${id("ab0")}';
        update public.service_cases set status='acknowledged' where id='${CASE_A}';`);
      assert.equal(declined.error, undefined, declined.error?.message);
    });

    await t.test("056: overdue marking skips delivered cases and includes internal review", async () => {
      const house = "5eed0000-0000-4000-8000-0000000000a1";
      const run = async (status) => {
        await db.exec("begin");
        try {
          await db.query(`update public.service_cases set status=$2, sla_due_at=now() - interval '1 day' where id=$1`, [CASE_A, status]);
          await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${users.adminA}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
          return (await db.query(`select case_id from public.staff_mark_overdue_cases($1)`, [house])).rows.map((row) => row.case_id);
        } finally {
          await db.exec("rollback");
        }
      };
      assert.deepEqual(await run("delivered"), [], "a plan delivered on time is not overdue");
      assert.deepEqual(await run("internal_review"), [CASE_A], "a plan stuck in review is overdue");
    });
  } finally {
    await db.close();
  }
});

test("migration 057 staff display names", async (t) => {
  const db = await database();
  // Runs several statements as one user in one rolled-back transaction, returning each result.
  const steps = async (userId, sqls) => {
    await db.exec("begin");
    try {
      await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
      const out = [];
      for (const sql of sqls) out.push((await db.query(sql)).rows);
      return out;
    } finally {
      await db.exec("rollback");
    }
  };
  const seedName = `insert into public.staff_display_names(user_id, display_name) values ('${users.educatorA}', 'Ms. Rivera');`;
  try {
    await t.test("staff set their own name and staff of the same household can read it", async () => {
      const [[set]] = await steps(users.educatorA, [`select public.set_staff_display_name('  Ms. Rivera ') as name`]);
      assert.equal(set.name, "Ms. Rivera");
      await db.exec("begin");
      try {
        await db.exec(seedName);
        await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${users.adminA}', true);`);
        const rows = (await db.query(`select display_name from public.staff_display_names where user_id = $1`, [users.educatorA])).rows;
        assert.deepEqual(rows, [{ display_name: "Ms. Rivera" }]);
      } finally {
        await db.exec("rollback");
      }
    });

    await t.test("guardians cannot set a staff name or read staff names", async () => {
      await assert.rejects(() => steps(users.guardianA, [`select public.set_staff_display_name('Parent')`]), /staff access required/);
      await db.exec("begin");
      try {
        await db.exec(seedName);
        await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${users.guardianA}', true);`);
        assert.equal((await db.query(`select 1 from public.staff_display_names`)).rows.length, 0);
      } finally {
        await db.exec("rollback");
      }
    });

    await t.test("another household's staff cannot read the name", async () => {
      await db.exec("begin");
      try {
        await db.exec(seedName);
        await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${users.adminB}', true);`);
        assert.equal((await db.query(`select 1 from public.staff_display_names`)).rows.length, 0);
      } finally {
        await db.exec("rollback");
      }
    });

    await t.test("a blank or too-long name is refused, and the table cannot be written directly", async () => {
      await assert.rejects(() => steps(users.educatorA, [`select public.set_staff_display_name('   ')`]), /1 to 80 characters/);
      await assert.rejects(() => steps(users.educatorA, [`select public.set_staff_display_name('${"x".repeat(81)}')`]), /1 to 80 characters/);
      await assert.rejects(() => steps(users.educatorA, [`insert into public.staff_display_names(user_id, display_name) values ('${users.adminA}', 'Not me')`]), /permission denied|row-level security/);
    });
  } finally {
    await db.close();
  }
});

test("migration 058 email notifications", async (t) => {
  const db = await database();
  const house = "5eed0000-0000-4000-8000-0000000000a1";
  // Runs fn inside a transaction that is always rolled back.
  const inTx = async (fn) => {
    await db.exec("begin");
    try {
      return await fn();
    } finally {
      await db.exec("rollback");
    }
  };
  const outbox = async (subject) =>
    (await db.query(`select recipient_user_id as who, kind from public.notification_outbox where subject_id = $1 order by 1`, [subject])).rows;
  try {
    await t.test("a parent's message notifies the assigned educator, not the parent", async () => {
      // Seeded message a70 was written by guardian A on case A, assigned to educator A.
      assert.deepEqual(await outbox(id("a70")), [{ who: users.educatorA, kind: "message_to_staff" }]);
    });

    await t.test("with no educator assigned, a parent's message goes to the household's admins", async () => {
      await inTx(async () => {
        await db.query(`update public.service_cases set assigned_educator_id = null where id = $1`, [CASE_A]);
        await db.query(`insert into public.case_messages(id, household_id, case_id, sender_user_id, body) values ('5eed0000-0000-4000-8000-0000000000d1', $1, $2, $3, 'Hello')`, [house, CASE_A, users.guardianA]);
        assert.deepEqual(await outbox("5eed0000-0000-4000-8000-0000000000d1"), [{ who: users.adminA, kind: "message_to_staff" }]);
      });
    });

    await t.test("a staff message notifies every guardian of the household", async () => {
      await inTx(async () => {
        await db.query(`insert into public.case_messages(id, household_id, case_id, sender_user_id, body) values ('5eed0000-0000-4000-8000-0000000000d2', $1, $2, $3, 'Plan update')`, [house, CASE_A, users.educatorA]);
        assert.deepEqual(await outbox("5eed0000-0000-4000-8000-0000000000d2"), [{ who: users.guardianA, kind: "message_to_guardian" }]);
      });
    });

    await t.test("a sent delivery notifies guardians once, even when the send is retried", async () => {
      // Seeded delivery aa0 was inserted as sent.
      assert.deepEqual(await outbox(id("aa0")), [{ who: users.guardianA, kind: "plan_delivered" }]);
      await inTx(async () => {
        await db.query(`update public.deliveries set status = 'failed' where id = $1`, [id("aa0")]);
        await db.query(`update public.deliveries set status = 'sent' where id = $1`, [id("aa0")]);
        assert.equal((await outbox(id("aa0"))).length, 1);
      });
    });

    await t.test("a revision decision notifies the guardian who asked", async () => {
      await inTx(async () => {
        await db.query(`update public.revision_requests set status = 'accepted' where id = $1`, [id("ab0")]);
        const rows = (await db.query(`select recipient_user_id as who from public.notification_outbox where kind = 'revision_decided'`)).rows;
        assert.deepEqual(rows, [{ who: users.guardianA }]);
      });
    });

    await t.test("the sender skips people who opted out and anything older than two days, then records the result", async () => {
      await inTx(async () => {
        await db.query(`insert into auth.users(id, email) values ($1, 'educator-a@example.test') on conflict (id) do update set email = excluded.email`, [users.educatorA]).catch(() => {});
        await db.query(`update auth.users set email = 'educator-a@example.test' where id = $1`, [users.educatorA]);
        await db.query(`insert into public.notification_preferences(user_id, email_enabled) values ($1, false)`, [users.guardianA]);
        await db.query(`insert into public.case_messages(id, household_id, case_id, sender_user_id, body) values ('5eed0000-0000-4000-8000-0000000000d3', $1, $2, $3, 'Old one')`, [house, CASE_A, users.guardianA]);
        await db.query(`update public.notification_outbox set created_at = now() - interval '3 days' where subject_id = '5eed0000-0000-4000-8000-0000000000d3'`);
        const claimed = (await db.query(`select * from public.notification_claim(50)`)).rows;
        assert.deepEqual(claimed.map((row) => [row.notice_kind, row.recipient_email]), [["message_to_staff", "educator-a@example.test"]], "only the fresh notice to the educator who did not opt out");
        const skipped = (await db.query(`select status, last_error from public.notification_outbox where status = 'skipped' order by last_error`)).rows;
        assert.deepEqual(skipped.map((row) => row.last_error), ["expired before sending", "recipient turned emails off"]);
        await db.query(`select public.notification_finish($1, true)`, [claimed[0].notice_id]);
        assert.equal((await db.query(`select status from public.notification_outbox where id = $1`, [claimed[0].notice_id])).rows[0].status, "sent");
      });
    });

    await t.test("a failed send is retried, then stops after three attempts", async () => {
      await inTx(async () => {
        const notice = (await db.query(`select id from public.notification_outbox where subject_id = $1`, [id("a70")])).rows[0].id;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          await db.query(`update public.notification_outbox set status = 'sending', attempts = $2 where id = $1`, [notice, attempt]);
          await db.query(`select public.notification_finish($1, false, 'mailbox unavailable')`, [notice]);
        }
        assert.equal((await db.query(`select status from public.notification_outbox where id = $1`, [notice])).rows[0].status, "failed");
      });
    });

    await t.test("people manage only their own setting, and no one can read the outbox or run the sender", async () => {
      await inTx(async () => {
        await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${users.guardianA}', true);`);
        assert.equal((await db.query(`select public.set_email_notifications(false) as on`)).rows[0].on, false);
        assert.deepEqual((await db.query(`select email_enabled from public.notification_preferences`)).rows, [{ email_enabled: false }]);
        assert.equal((await db.query(`select 1 from public.notification_outbox`)).rows.length, 0, "the outbox is sealed");
      });
      await inTx(async () => {
        await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${users.guardianA}', true);`);
        await assert.rejects(() => db.query(`select * from public.notification_claim(5)`), /permission denied/);
      });
      await inTx(async () => {
        await db.query(`insert into public.notification_preferences(user_id, email_enabled) values ($1, false)`, [users.guardianA]);
        await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${users.adminA}', true);`);
        assert.equal((await db.query(`select 1 from public.notification_preferences`)).rows.length, 0, "an admin cannot read a parent's setting");
      });
    });
  } finally {
    await db.close();
  }
});

test("migration 059 review follow-ups", async (t) => {
  const db = await database();
  const house = "5eed0000-0000-4000-8000-0000000000a1";
  const inTx = async (fn) => {
    await db.exec("begin");
    try {
      return await fn();
    } finally {
      await db.exec("rollback");
    }
  };
  const actAs = (userId) => db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
  try {
    await t.test("a family still sees a plan version that a revision archived, with its lessons", async () => {
      await inTx(async () => {
        await db.query(`update public.plans set status = 'archived' where id = $1`, [PLAN_A]);
        await actAs(users.guardianA);
        assert.equal((await db.query(`select 1 from public.plans where id = $1`, [PLAN_A])).rows.length, 1);
        assert.ok((await db.query(`select 1 from public.lessons where id = $1`, [LESSON_A])).rows.length === 1, "its lessons stay readable");
      });
    });

    await t.test("drafts and plans under review stay hidden from the family", async () => {
      for (const status of ["draft", "internal_review"]) {
        await inTx(async () => {
          await db.query(`update public.plans set status = $2, published_at = null where id = $1`, [PLAN_A, status]);
          await actAs(users.guardianA);
          assert.equal((await db.query(`select 1 from public.plans where id = $1`, [PLAN_A])).rows.length, 0, status);
          assert.equal((await db.query(`select 1 from public.lessons where id = $1`, [LESSON_A])).rows.length, 0, `${status} lessons`);
        });
      }
    });

    await t.test("an admin can close a case on hold, with a reason, and it is audited", async () => {
      await inTx(async () => {
        await db.query(`update public.service_cases set status = 'on_hold' where id = $1`, [CASE_A]);
        await actAs(users.adminA);
        await db.query(`select public.staff_close_held_case($1, $2, 'Family withdrew consent')`, [house, CASE_A]);
        await db.exec("reset role");
        const row = (await db.query(`select status, closed_at is not null as closed, previous_operational_status as prior from public.service_cases where id = $1`, [CASE_A])).rows[0];
        assert.deepEqual(row, { status: "closed", closed: true, prior: "on_hold" });
        assert.equal((await db.query(`select 1 from public.audit_events where event_type = 'case.closed_from_hold' and subject_id = $1`, [CASE_A])).rows.length, 1);
      });
    });

    await t.test("only a case on hold can be closed this way, only by an admin, and only with a reason", async () => {
      await inTx(async () => {
        await actAs(users.adminA);
        await assert.rejects(() => db.query(`select public.staff_close_held_case($1, $2, 'Not on hold')`, [house, CASE_A]), /only a case on hold/);
      });
      await inTx(async () => {
        await db.query(`update public.service_cases set status = 'on_hold' where id = $1`, [CASE_A]);
        await actAs(users.educatorA);
        await assert.rejects(() => db.query(`select public.staff_close_held_case($1, $2, 'Reason')`, [house, CASE_A]), /admin access required/);
      });
      await inTx(async () => {
        await db.query(`update public.service_cases set status = 'on_hold' where id = $1`, [CASE_A]);
        await actAs(users.adminA);
        await assert.rejects(() => db.query(`select public.staff_close_held_case($1, $2, '  ')`, [house, CASE_A]), /reason for closing/);
      });
    });

    await t.test("assignment still respects the educator's capacity", async () => {
      await inTx(async () => {
        await db.query(`update public.service_cases set status = 'triage', assigned_educator_id = null where id = $1`, [CASE_A]);
        await db.query(`update public.educator_capacities set max_active_cases = 0 where household_id = $1 and educator_user_id = $2`, [house, users.educatorA]);
        await actAs(users.adminA);
        await assert.rejects(() => db.query(`select * from public.staff_assign_case($1, $2, $3)`, [house, CASE_A, users.educatorA]), /capacity/);
      });
    });
  } finally {
    await db.close();
  }
});

test("migrations 060 and 061 staff team", async (t) => {
  const db = await database();
  const houseA = "5eed0000-0000-4000-8000-0000000000a1";
  const person = "5eed0000-0000-4000-8000-00000000ad60";
  const inTx = async (fn) => {
    await db.exec("begin");
    try {
      await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, 'new-staff@britelink.invalid', now())`, [person]);
      return await fn();
    } finally {
      await db.exec("rollback");
    }
  };
  const actAs = (userId) => db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
  // An expected failure, rolled back to a savepoint so the test's transaction carries on.
  const refuses = async (sql, pattern, params = []) => {
    await db.exec("savepoint expected_failure");
    await assert.rejects(() => db.query(sql, params), pattern);
    await db.exec("rollback to savepoint expected_failure");
  };
  const roleIn = async (household, userId) =>
    (await db.query(`select role from public.memberships where household_id = $1 and user_id = $2`, [household, userId])).rows[0]?.role;
  try {
    await t.test("adding an admin shares every existing family with them", async () => {
      await inTx(async () => {
        const shared = (await db.query(`select public.staff_team_add('New-Staff@britelink.invalid', 'admin') as n`)).rows[0].n;
        assert.equal(shared, 1, "household A is the only seeded family with a guardian");
        assert.equal(await roleIn(houseA, person), "admin");
        // Running it again changes nothing.
        assert.equal((await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'admin') as n`)).rows[0].n, 0);
      });
    });

    await t.test("061: adding an educator makes them assignable in every family, but a member of none", async () => {
      await inTx(async () => {
        const shared = (await db.query(`select public.staff_team_add('New-Staff@britelink.invalid', 'educator', 4) as n`)).rows[0].n;
        assert.equal(shared, 0);
        assert.equal(await roleIn(houseA, person), undefined, "an unassigned educator cannot read the family");
        const limit = (await db.query(`select max_active_cases from public.educator_capacities where household_id = $1 and educator_user_id = $2`, [houseA, person])).rows[0];
        assert.deepEqual(limit, { max_active_cases: 4 });
        // Running it again changes nothing but the limit.
        await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'educator', 6)`);
        const updated = (await db.query(`select max_active_cases from public.educator_capacities where household_id = $1 and educator_user_id = $2`, [houseA, person])).rows[0];
        assert.deepEqual(updated, { max_active_cases: 6 });
      });
    });

    await t.test("061: an admin assigning a case is what lets a staff educator into that family", async () => {
      await inTx(async () => {
        await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'educator', 4)`);
        await db.query(`update public.service_cases set status = 'triage', assigned_educator_id = null where id = $1`, [CASE_A]);
        await actAs(users.adminA);
        const assigned = (await db.query(`select * from public.staff_assign_case($1, $2, $3)`, [houseA, CASE_A, person])).rows[0];
        await db.exec("reset role");
        assert.equal(assigned.educator_user_id, person);
        assert.equal(await roleIn(houseA, person), "educator");
      });
    });

    await t.test("061: a new family gets the team's admins as members and its educators as assignable only", async () => {
      await inTx(async () => {
        await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'educator')`);
        const admin = "5eed0000-0000-4000-8000-00000000ad62";
        await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, 'team-admin@britelink.invalid', now())`, [admin]);
        await db.query(`select public.staff_team_add('team-admin@britelink.invalid', 'admin')`);
        const parent = "5eed0000-0000-4000-8000-00000000ad61";
        await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, 'parent@britelink.invalid', now())`, [parent]);
        await actAs(parent);
        const family = (await db.query(`select household_id from public.provision_beta_household('Ada', 'Grade 3', 'Ontario')`)).rows[0];
        await db.exec("reset role");
        assert.equal(await roleIn(family.household_id, admin), "admin");
        assert.equal(await roleIn(family.household_id, person), undefined);
        const capacity = (await db.query(`select count(*)::int as n from public.educator_capacities where household_id = $1 and educator_user_id = $2`, [family.household_id, person])).rows[0].n;
        assert.equal(capacity, 1);
      });
    });

    await t.test("061: an account that never confirmed its email cannot be made staff", async () => {
      await inTx(async () => {
        await db.query(`insert into auth.users(id, email) values ('5eed0000-0000-4000-8000-00000000ad63', 'unconfirmed@britelink.invalid')`);
        await refuses(`select public.staff_team_add('unconfirmed@britelink.invalid', 'admin')`, /confirmed its email/);
        assert.equal((await db.query(`select count(*)::int as n from public.staff_team`)).rows[0].n, 0, "nobody was added");
      });
    });

    await t.test("061: staff see an unassigned educator's name in the assign list, and the educator can set it", async () => {
      await inTx(async () => {
        await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'educator')`);
        await actAs(person);
        assert.equal((await db.query(`select public.set_staff_display_name('Ms. Rivera') as n`)).rows[0].n, "Ms. Rivera");
        assert.deepEqual((await db.query(`select * from public.my_staff_profile()`)).rows, [{ role: "educator", display_name: "Ms. Rivera" }]);
        await db.exec("reset role");
        await actAs(users.adminA);
        const names = (await db.query(`select display_name from public.staff_display_names where user_id = $1`, [person])).rows;
        assert.deepEqual(names, [{ display_name: "Ms. Rivera" }]);
        assert.deepEqual((await db.query(`select * from public.my_staff_profile()`)).rows, [], "the seeded admin is not on the team");
        await db.exec("reset role");
        await actAs(users.guardianA);
        const hidden = (await db.query(`select display_name from public.staff_display_names where user_id = $1`, [person])).rows;
        assert.deepEqual(hidden, [], "a parent does not see staff who are not in their family");
      });
    });

    await t.test("061: leaving a family revokes the calendar links that person made there", async () => {
      await inTx(async () => {
        // Only guardians make calendar links (062), so a co-guardian leaves here.
        await db.query(`insert into public.memberships(household_id, user_id, role) values ($1, $2, 'guardian')`, [houseA, person]);
        await actAs(person);
        const feed = (await db.query(`select feed_id from public.create_calendar_feed($1, $2, false)`, [houseA, id("a10")])).rows[0].feed_id;
        await db.exec("reset role");
        await db.query(`delete from public.memberships where household_id = $1 and user_id = $2`, [houseA, person]);
        const revoked = (await db.query(`select revoked_at is not null as r from public.calendar_feeds where id = $1`, [feed])).rows[0].r;
        assert.equal(revoked, true);
      });
    });

    await t.test("061: erasing a household with live calendar links still works", async () => {
      await inTx(async () => {
        await actAs(users.guardianA);
        await db.query(`select feed_id from public.create_calendar_feed($1, $2, false)`, [houseA, id("a10")]);
        await db.exec("reset role");
        await db.query(`delete from public.households where id = $1`, [houseA]);
        assert.equal((await db.query(`select count(*)::int as n from public.calendar_feeds where household_id = $1`, [houseA])).rows[0].n, 0);
      });
    });

    await t.test("a new family is shared with the whole team the moment it signs up", async () => {
      await inTx(async () => {
        await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'admin')`);
        const parent = "5eed0000-0000-4000-8000-00000000ad61";
        await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, 'parent@britelink.invalid', now())`, [parent]);
        await actAs(parent);
        const family = (await db.query(`select household_id, created from public.provision_beta_household('Ada', 'Grade 3', 'Ontario')`)).rows[0];
        await db.exec("reset role");
        assert.equal(family.created, true);
        assert.equal(await roleIn(family.household_id, parent), "guardian");
        assert.equal(await roleIn(family.household_id, person), "admin");
      });
    });

    await t.test("a staff member who signs up as a parent gets their own family, not someone else's", async () => {
      await inTx(async () => {
        await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'admin')`);
        assert.equal(await roleIn(houseA, person), "admin");
        await actAs(person);
        const family = (await db.query(`select household_id, created from public.provision_beta_household('Ben', 'Grade 1', 'Ontario')`)).rows[0];
        await db.exec("reset role");
        assert.equal(family.created, true);
        assert.notEqual(family.household_id, houseA);
        assert.equal(await roleIn(family.household_id, person), "guardian", "they stay their own family's guardian");
      });
    });

    await t.test("adding refuses an unknown email, a bad role and a role change", async () => {
      await inTx(async () => {
        await refuses(`select public.staff_team_add('nobody@britelink.invalid', 'educator')`, /invite them first/);
        await refuses(`select public.staff_team_add('new-staff@britelink.invalid', 'guardian')`, /educator or admin/);
        await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'educator')`);
        await refuses(`select public.staff_team_add('new-staff@britelink.invalid', 'admin')`, /remove them first/);
      });
    });

    await t.test("removing refuses while they hold an open case, then removes only staff access", async () => {
      await inTx(async () => {
        await db.query(`select public.staff_team_add('new-staff@britelink.invalid', 'educator')`);
        await db.query(`update public.service_cases set status = 'triage', assigned_educator_id = null where id = $1`, [CASE_A]);
        await actAs(users.adminA);
        await db.query(`select * from public.staff_assign_case($1, $2, $3)`, [houseA, CASE_A, person]);
        await db.exec("reset role");
        await refuses(`select public.staff_team_remove('new-staff@britelink.invalid')`, /reassign those first/);
        await db.query(`update public.service_cases set assigned_educator_id = null, status = 'triage' where id = $1`, [CASE_A]);
        assert.equal((await db.query(`select public.staff_team_remove('new-staff@britelink.invalid') as n`)).rows[0].n, 1);
        assert.equal(await roleIn(houseA, person), undefined);
        assert.equal((await db.query(`select count(*)::int as n from public.educator_capacities where educator_user_id = $1`, [person])).rows[0].n, 0);
        assert.equal(await roleIn(houseA, users.guardianA), "guardian");
      });
    });

    await t.test("no client can read the team or run the team functions", async () => {
      for (const sql of [
        `select * from public.staff_team`,
        `select * from public.staff_team_list()`,
        `select public.staff_team_add('seed-guardian-a@britelink.invalid', 'admin')`,
        `select public.staff_team_remove('seed-admin-a@britelink.invalid')`,
        `select public.share_household_with_staff('${houseA}')`,
      ]) {
        const { error } = await asUser(db, users.adminA, sql);
        assert.match(error?.message ?? "", /permission denied/, sql);
      }
    });
  } finally {
    await db.close();
  }
});

test("migration 062 staff access follows the work", async (t) => {
  const db = await database();
  const houseA = "5eed0000-0000-4000-8000-0000000000a1";
  const learnerA = id("a10");
  const first = "5eed0000-0000-4000-8000-00000000ad70";
  const second = "5eed0000-0000-4000-8000-00000000ad71";
  const actAs = (userId) => db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
  const inTx = async (fn) => {
    await db.exec("begin");
    try {
      await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, 'first@britelink.invalid', now()), ($2, 'second@britelink.invalid', now())`, [first, second]);
      await db.query(`select public.staff_team_add('first@britelink.invalid', 'educator', 4)`);
      await db.query(`select public.staff_team_add('second@britelink.invalid', 'educator', 4)`);
      await db.query(`update public.service_cases set status = 'triage', assigned_educator_id = null where id = $1`, [CASE_A]);
      return await fn();
    } finally {
      await db.exec("rollback");
    }
  };
  const assign = async (educator) => {
    await actAs(users.adminA);
    await db.query(`select * from public.staff_assign_case($1, $2, $3)`, [houseA, CASE_A, educator]);
    await db.exec("reset role");
  };
  const roleIn = async (userId) =>
    (await db.query(`select role from public.memberships where household_id = $1 and user_id = $2`, [houseA, userId])).rows[0]?.role;
  try {
    await t.test("reassigning a case takes the previous educator out of the family", async () => {
      await inTx(async () => {
        await assign(first);
        assert.equal(await roleIn(first), "educator");
        await assign(second);
        assert.equal(await roleIn(first), undefined, "the previous educator can no longer read the family");
        assert.equal(await roleIn(second), "educator");
        assert.equal(await roleIn(users.adminA), "admin");
        assert.equal(await roleIn(users.educatorA), "educator", "an educator who is not on the staff team is left alone, as in 061");
        // They stay assignable: their case limit for this family is kept.
        const limit = (await db.query(`select count(*)::int as n from public.educator_capacities where household_id = $1 and educator_user_id = $2`, [houseA, first])).rows[0].n;
        assert.equal(limit, 1);
        await assign(first);
        assert.equal(await roleIn(first), "educator", "assigning them again lets them back in");
      });
    });

    await t.test("closing a case takes its educator out of the family", async () => {
      await inTx(async () => {
        await assign(first);
        await db.query(`update public.service_cases set status = 'closed' where id = $1`, [CASE_A]);
        assert.equal(await roleIn(first), undefined);
        assert.equal(await roleIn(users.adminA), "admin");
      });
    });

    await t.test("an educator who still holds another open case in the family stays", async () => {
      await inTx(async () => {
        await assign(first);
        await db.query(`insert into public.service_cases(id, household_id, learner_id, package_code, status, assigned_educator_id)
          select $1, household_id, learner_id, package_code, 'drafting', $2 from public.service_cases where id = $3`, [id("a29"), first, CASE_A]);
        await assign(second);
        assert.equal(await roleIn(first), "educator");
      });
    });

    await t.test("recording an absence does not remove the educator", async () => {
      await inTx(async () => {
        await assign(first);
        await actAs(users.adminA);
        await db.query(`select * from public.staff_record_educator_absence($1, $2, 'Away this week.')`, [houseA, CASE_A]);
        await db.exec("reset role");
        assert.equal(await roleIn(first), "educator");
      });
    });

    await t.test("an admin can no longer act as the family's guardian", async () => {
      const calls = [
        `select public.guardian_add_learner('${houseA}', 'Sam', 'Grade 2')`,
        `select public.set_paused_subjects('${houseA}', '${PLAN_A}', array['Math'])`,
        `select public.set_plan_schedule('${houseA}', '${PLAN_A}', current_date, array[1,2,3]::smallint[], array[]::date[])`,
        `select public.record_learning_capture('${houseA}', '${learnerA}', current_date, 'outing', array['Science'], 'Pond walk.')`,
        `select public.remove_learning_capture('${houseA}', gen_random_uuid())`,
        `select public.move_shared_activity('${houseA}', gen_random_uuid(), current_date)`,
        `select public.set_shared_activity_done('${houseA}', gen_random_uuid(), '${learnerA}', true)`,
        `select public.create_calendar_feed('${houseA}', '${learnerA}', false)`,
        `select public.revoke_calendar_feed('${houseA}', '${learnerA}')`,
      ];
      for (const sql of calls) {
        const { error } = await asUser(db, users.adminA, sql);
        assert.match(error?.message ?? "", /guardian access required/, sql);
      }
      const feed = await asUser(db, users.guardianA, `select feed_id from public.create_calendar_feed('${houseA}', '${learnerA}', false)`);
      assert.equal(feed.error, undefined, "the guardian still can");
      const progress = await asUser(db, users.adminA,
        `update public.lesson_activities set status='completed', updated_by='${users.adminA}' where id='${ACTIVITY_A}' returning id`);
      assert.equal(progress.result?.rows.length ?? 0, 0, "an admin cannot mark a child's lesson done");
    });

    await t.test("an admin reads intake details only while consent is active, like an educator", async () => {
      const count = async (userId) => (await asUser(db, userId, `select count(*)::int as n from public.learner_profiles where household_id = '${houseA}'`)).result.rows[0].n;
      assert.equal(await count(users.adminA), 1);
      await db.exec("begin");
      try {
        await db.query(`update public.guardian_consents set withdrawn_at = now() where household_id = $1`, [houseA]);
        await actAs(users.adminA);
        assert.equal((await db.query(`select count(*)::int as n from public.learner_profiles where household_id = $1`, [houseA])).rows[0].n, 0);
        await db.exec("reset role");
        await actAs(users.guardianA);
        assert.equal((await db.query(`select count(*)::int as n from public.learner_profiles where household_id = $1`, [houseA])).rows[0].n, 1, "the guardian always can");
      } finally {
        await db.exec("rollback");
      }
    });

    await t.test("no client can call the release directly", async () => {
      const { error } = await asUser(db, users.adminA, `select public.release_unassigned_educators('${houseA}')`);
      assert.match(error?.message ?? "", /permission denied/);
    });
  } finally {
    await db.close();
  }
});

test("migration 063 database follow-ups", async (t) => {
  const db = await database();
  const houseA = "5eed0000-0000-4000-8000-0000000000a1";
  const learnerA = id("a10");
  const actAs = (userId) => db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
  // Owner setup, then sql as userId, all rolled back. Returns { result } or { error }.
  const afterSetup = async (setup, userId, sql) => {
    await db.exec("begin");
    try {
      if (setup) await db.exec(setup);
      if (userId) await actAs(userId);
      return { result: await db.query(sql) };
    } catch (error) {
      return { error };
    } finally {
      await db.exec("rollback");
    }
  };
  const lessonIn = (plan, lesson) => `
    insert into public.plan_weeks(id, household_id, plan_id, week_number, theme) values ('${id("c40")}', '${houseA}', '${plan}', 9, 'Week');
    insert into public.plan_days(id, household_id, week_id, day_number, planned_date) values ('${id("c41")}', '${houseA}', '${id("c40")}', 1, current_date);
    insert into public.lessons(id, household_id, day_id, position, subject, title, objective, instructions, adult_help_minutes)
      values ('${lesson}', '${houseA}', '${id("c41")}', 1, 'Mathematics', 'Lesson', 'Objective', '[{"step":1,"text":"x"}]'::jsonb, 10);`;
  const record = (lesson) => `insert into public.lesson_activities(household_id, learner_id, lesson_id, status, updated_by)
    values ('${houseA}', '${learnerA}', '${lesson}', 'completed', '${users.guardianA}') returning id`;
  try {
    await t.test("a guardian cannot record progress on a lesson in a draft plan", async () => {
      const draft = await afterSetup(lessonIn(id("a31"), id("c50")), users.guardianA, record(id("c50")));
      assert.match(draft.error?.message ?? "", /row-level security/);
      const published = await afterSetup(lessonIn(PLAN_A, id("c51")), users.guardianA, record(id("c51")));
      assert.equal(published.error, undefined, published.error?.message);
      assert.equal(published.result.rows.length, 1);
    });

    await t.test("a removed learning note is no longer readable", async () => {
      const setup = `insert into public.learning_captures(id, household_id, learner_id, captured_on, kind, subjects, note, created_by, removed_at)
        values ('${id("c60")}', '${houseA}', '${learnerA}', current_date, 'note', array['Science'], 'Removed note.', '${users.guardianA}', now());`;
      for (const userId of [users.guardianA, users.adminA, users.educatorA]) {
        const { result, error } = await afterSetup(setup, userId, `select count(*)::int as n from public.learning_captures where id = '${id("c60")}'`);
        assert.equal(error, undefined, error?.message);
        assert.equal(result.rows[0].n, 0);
      }
    });

    await t.test("a notice stuck in 'sending' is tried again, then given up after three attempts", async () => {
      const setup = `insert into public.notification_outbox(id, household_id, recipient_user_id, kind, subject_id, status, attempts, claimed_at)
        overriding system value values
        (9001, '${houseA}', '${users.guardianA}', 'plan_delivered', '${id("c70")}', 'sending', 1, now() - interval '2 hours'),
        (9002, '${houseA}', '${users.guardianA}', 'plan_delivered', '${id("c71")}', 'sending', 3, now() - interval '2 hours'),
        (9003, '${houseA}', '${users.guardianA}', 'plan_delivered', '${id("c72")}', 'sending', 1, now() - interval '5 minutes');`;
      const { result, error } = await afterSetup(`${setup} select * from public.notification_claim(50);`, null,
        `select id, status, attempts from public.notification_outbox where id in (9001, 9002, 9003) order by id`);
      assert.equal(error, undefined, error?.message);
      const rows = result.rows;
      assert.deepEqual(rows.map((r) => [Number(r.id), r.status, r.attempts]), [[9001, "sending", 2], [9002, "failed", 3], [9003, "sending", 1]]);
    });

    await t.test("consent status answers only a member of the household", async () => {
      const ask = `select public.has_active_guardian_consent('${houseA}', '${learnerA}') as ok`;
      assert.equal((await afterSetup(null, users.guardianA, ask)).result.rows[0].ok, true);
      assert.equal((await afterSetup(null, users.adminB, ask)).result.rows[0].ok, false);
    });

    await t.test("no client can run the old identity diagnostic", async () => {
      const { error } = await afterSetup(null, users.adminA, `select * from public.diagnose_caller_identity('${houseA}')`);
      assert.match(error?.message ?? "", /permission denied/);
    });
  } finally {
    await db.close();
  }
});

test("migration 064 staff approve new families", async (t) => {
  const db = await database();
  const houseA = "5eed0000-0000-4000-8000-0000000000a1";
  const admin = "5eed0000-0000-4000-8000-00000000ad64";
  const parent = "5eed0000-0000-4000-8000-00000000ad65";
  const actAs = (userId) => db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); select set_config('request.jwt.claim.iat', '${Math.floor(Date.now() / 1000)}', true);`);
  // A team admin and a parent who has just signed up, all rolled back. Returns the new family.
  const withNewFamily = async (fn) => {
    await db.exec("begin");
    try {
      await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, 'approve-admin@britelink.invalid', now()), ($2, 'approve-parent@britelink.invalid', now())`, [admin, parent]);
      await db.query(`select public.staff_team_add('approve-admin@britelink.invalid', 'admin')`);
      await actAs(parent);
      const family = (await db.query(`select * from public.provision_beta_household('Ada', 'Grade 3', 'Ontario')`)).rows[0];
      await db.exec("reset role");
      return await fn(family);
    } finally {
      await db.exec("reset role");
      await db.exec("rollback");
    }
  };
  const refuses = async (sql, pattern, params = []) => {
    await db.exec("savepoint expected_failure");
    await assert.rejects(() => db.query(sql, params), pattern);
    await db.exec("rollback to savepoint expected_failure");
  };
  const approvedAt = async (household) =>
    (await db.query(`select approved_at from public.households where id = $1`, [household])).rows[0].approved_at;
  const staffNotices = async (household) =>
    (await db.query(`select count(*)::int as n from public.notification_outbox where household_id = $1 and kind = 'message_to_staff'`, [household])).rows[0].n;
  try {
    await t.test("existing families stay approved; a family that signs itself up waits", async () => {
      assert.notEqual(await approvedAt(houseA), null);
      await withNewFamily(async (family) => {
        assert.equal(await approvedAt(family.household_id), null);
      });
    });

    await t.test("work on a waiting family's case cannot start, but the case can be closed", async () => {
      await withNewFamily(async (family) => {
        await refuses(`update public.service_cases set status = 'triage' where id = $1`, /approve this family/, [family.case_id]);
        await refuses(`update public.service_cases set assigned_educator_id = $2 where id = $1`, /approve this family/, [family.case_id, admin]);
        await db.query(`update public.service_cases set status = 'submitted' where id = $1`, [family.case_id]);
        await db.query(`update public.service_cases set status = 'cancelled' where id = $1`, [family.case_id]);
      });
    });

    await t.test("a waiting family's messages do not email staff until they are approved", async () => {
      await withNewFamily(async (family) => {
        const send = (n) => db.query(`insert into public.case_messages(id, household_id, case_id, sender_user_id, body) values ($1, $2, $3, $4, 'Hello')`,
          [`5eed0000-0000-4000-8000-0000000064d${n}`, family.household_id, family.case_id, parent]);
        await send(1);
        assert.equal(await staffNotices(family.household_id), 0);
        await actAs(admin);
        await db.query(`select public.staff_approve_household($1)`, [family.household_id]);
        await db.exec("reset role");
        await send(2);
        assert.equal(await staffNotices(family.household_id), 1);
        await db.query(`update public.service_cases set status = 'triage' where id = $1`, [family.case_id]);
      });
    });

    await t.test("only a staff admin can approve, once, and it is recorded", async () => {
      await withNewFamily(async (family) => {
        await actAs(parent);
        await refuses(`select public.staff_approve_household($1)`, /admin access required/, [family.household_id]);
        await db.exec("reset role");
        assert.equal(await approvedAt(family.household_id), null);
        await actAs(admin);
        const first = (await db.query(`select public.staff_approve_household($1) as at`, [family.household_id])).rows[0].at;
        const again = (await db.query(`select public.staff_approve_household($1) as at`, [family.household_id])).rows[0].at;
        await db.exec("reset role");
        assert.notEqual(first, null);
        assert.deepEqual(again, first);
        const events = (await db.query(`select actor_user_id from public.audit_events where household_id = $1 and event_type = 'household.approved'`, [family.household_id])).rows;
        assert.deepEqual(events, [{ actor_user_id: admin }]);
      });
    });
  } finally {
    await db.close();
  }
});
