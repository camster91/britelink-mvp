import assert from "node:assert/strict";
import test from "node:test";
import { createHouseholdExportFile, deliveryPresentation, newestByCreatedAt } from "../src/guardian-service.js";

test("household export file is dated, readable JSON, and preserves the payload",()=>{
  const payload={household:{id:"house-a"},learners:[{id:"learner-a"}]};const file=createHouseholdExportFile(payload,new Date("2026-08-28T15:00:00Z"));assert.equal(file.filename,"britelink-household-export-2026-08-28.json");assert.deepEqual(JSON.parse(file.contents),payload);
});

test("newest item selection does not mutate source",()=>{const source=[{id:"old",created_at:"2026-01-01T00:00:00Z"},{id:"new",created_at:"2026-02-01T00:00:00Z"}];assert.equal(newestByCreatedAt(source).id,"new");assert.equal(source[0].id,"old")});

test("delivery presentation never describes failed bounced or pending deliveries as acknowledged",()=>{assert.equal(deliveryPresentation({status:"sent"}).canAcknowledge,true);assert.match(deliveryPresentation({status:"acknowledged",acknowledged_at:"2026-08-28T15:00:00Z"}).message,/Plan received/);for(const status of ["failed","bounced"]){const view=deliveryPresentation({status});assert.equal(view.canAcknowledge,false);assert.equal(view.tone,"failure");assert.doesNotMatch(view.message,/acknowledged/i)}const pending=deliveryPresentation({status:"pending"});assert.equal(pending.canAcknowledge,false);assert.doesNotMatch(pending.message,/acknowledged/i)});
