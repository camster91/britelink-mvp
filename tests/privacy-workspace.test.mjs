import assert from"node:assert/strict";
import test from"node:test";
import{loadPrivacyWorkspaceData}from"../src/privacy-workspace.js";

test("privacy panels degrade independently and total failure remains explicit",async()=>{
 const repository={listActiveConsents:async()=>[{id:"consent-a"}],listDeliveries:async()=>{throw new Error("delivery unavailable")},listRevisions:async()=>[{id:"revision-a"}],listPrivacyRequests:async()=>{throw new Error("privacy queue unavailable")}};
 const data=await loadPrivacyWorkspaceData(repository,{householdId:"h",learnerId:"l",userId:"u",caseId:"c"});
 assert.equal(data.consents.length,1);assert.deepEqual(data.deliveries,[]);assert.equal(data.revisions.length,1);assert.deepEqual(data.privacyRequests,[]);assert.deepEqual(data.warnings.map(item=>item.panel),["deliveries","privacyRequests"]);
 for(const method of Object.keys(repository))repository[method]=async()=>{throw new Error("offline")};
 await assert.rejects(()=>loadPrivacyWorkspaceData(repository,{householdId:"h",learnerId:"l",userId:"u",caseId:"c"}),/temporarily unavailable/);
});
