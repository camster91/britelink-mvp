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

test("submitted offers a path forward, not just back to clarification", () => {
  const offered = nextStaffStatuses("submitted");
  assert.ok(
    offered.includes("triage"),
    `submitted must offer triage (the intake-accepted path); got ${JSON.stringify(offered)}`
  );
});

test("the educator journey can reach a terminal state from paid", () => {
  // Walk the UI's own transitions and prove `closed` is reachable.
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
    for (const next of nextStaffStatuses(status)) {
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
