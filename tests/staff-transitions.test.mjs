// Regression test for the two transition maps.
//
// Two files encode case state transitions:
//   src/service-domain.js    CASE_TRANSITIONS    -- the domain authority, enforced
//                                                 by transitionCase()
//   src/staff-workspace.js   nextStaffStatuses() -- what the UI offers as buttons
//
// QA (britelink-qa-demo.md) found the educator flow looping: the UI instructed
// "Accept usable intake to start the package SLA" on a `submitted` case, but the
// only offered transition was `clarification`, so the case bounced
// submitted -> clarification -> submitted forever and never reached triage.
//
// These tests pin the two maps together so they cannot drift again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CASE_TRANSITIONS } from "../src/service-domain.js";
import { nextStaffStatuses, STAFF_NEXT_ACTIONS } from "../src/staff-workspace.js";

test("every UI-offered transition is legal in the domain model", () => {
  const statuses = Object.keys(CASE_TRANSITIONS);
  for (const status of statuses) {
    for (const next of nextStaffStatuses(status)) {
      assert.ok(
        CASE_TRANSITIONS[status].includes(next),
        `UI offers ${status} -> ${next}, which the domain model forbids`
      );
    }
  }
});

test("submitted moves forward through Accept intake, not a generic move that would skip the SLA", () => {
  const offered = nextStaffStatuses("submitted");
  assert.ok(!offered.includes("triage"), "triage is reached through staff_accept_usable_intake, which starts the SLA");
  assert.ok(offered.includes("clarification"), "submitted still offers clarification");
});

test("delivery is never a generic move: it goes through Record delivery", () => {
  for (const status of ["published", "revised", "internal_review"]) {
    assert.ok(!nextStaffStatuses(status).includes("delivered"), `${status} must not offer delivered`);
  }
  assert.deepEqual(nextStaffStatuses("overdue", "delivered"), ["delivered", "on_hold"], "an overdue case that was delivered can return to delivered");
  assert.ok(!nextStaffStatuses("overdue", "drafting").includes("delivered"));
  assert.equal(nextStaffStatuses("overdue", "drafting")[0], "drafting", "an overdue case suggests returning to where it was");
});

test("every UI-offered move is one the database's staff_transition_case accepts", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../supabase/migrations/202608280006_staff_operations.sql", import.meta.url), "utf8");
  const block = sql.slice(sql.indexOf("allowed := case service_case.status"), sql.indexOf("else false", sql.indexOf("allowed := case service_case.status")));
  const database = {};
  for (const match of block.matchAll(/when '(\w+)' then next_status (?:in \(([^)]*)\)|= '(\w+)')/g)) {
    database[match[1]] = match[2] ? [...match[2].matchAll(/'(\w+)'/g)].map((item) => item[1]) : [match[3]];
  }
  assert.ok(Object.keys(database).length >= 15, "parsed the database transition table");
  for (const status of Object.keys(CASE_TRANSITIONS)) {
    for (const previous of [null, "triage", "assigned", "drafting", "delivered"]) {
      for (const next of nextStaffStatuses(status, previous)) {
        assert.ok((database[status] ?? []).includes(next), `UI offers ${status} -> ${next}, which staff_transition_case rejects`);
      }
    }
  }
});

test("the educator journey can reach a terminal state from paid", () => {
  // Walk the UI's transitions and dedicated actions and prove `closed` is reachable.
  const seen = new Set();
  const queue = ["paid"];
  let reachedClosed = false;

  while (queue.length) {
    const status = queue.shift();
    if (seen.has(status)) continue;
    seen.add(status);
    if (status === "closed") {
      reachedClosed = true;
      break;
    }
    // The UI's generic moves plus the dedicated actions: Accept intake and Record delivery.
    const dedicated = { submitted: ["triage"], published: ["delivered"], revised: ["delivered"] }[status] ?? [];
    for (const next of [...nextStaffStatuses(status), ...dedicated]) {
      if (!seen.has(next)) queue.push(next);
    }
  }

  assert.ok(reachedClosed, "no path from paid to closed using the UI's transitions");
});

test("delivered offers acknowledgement, not only overdue", () => {
  const offered = nextStaffStatuses("delivered");
  assert.ok(
    offered.includes("acknowledged"),
    `delivered must offer acknowledged; got ${JSON.stringify(offered)}`
  );
});

test("acknowledged offers closed and revision_requested", () => {
  const offered = nextStaffStatuses("acknowledged");
  assert.ok(offered.includes("closed"));
  assert.ok(offered.includes("revision_requested"));
});

test("every status the UI names has a next-action string", () => {
  for (const status of Object.keys(CASE_TRANSITIONS)) {
    const action = STAFF_NEXT_ACTIONS[status];
    assert.equal(typeof action, "string", `no next-action text for ${status}`);
    assert.ok(action.length > 0, `empty next-action text for ${status}`);
  }
});

test("terminal statuses offer no transitions", () => {
  for (const terminal of ["closed", "cancelled", "refunded", "chargeback"]) {
    assert.deepEqual(
      nextStaffStatuses(terminal),
      [],
      `${terminal} must be terminal`
    );
  }
});
