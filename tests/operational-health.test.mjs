import assert from "node:assert/strict";
import test from "node:test";
import { fetchOperationalHealth, summarizeOperationalHealth, validateHealthSignals } from "../src/operational-health.js";

const signal={signal_code:"delivery.failed",severity:"error",entity_count:2,oldest_at:"2026-08-28T14:00:00Z",threshold_seconds:0};

test("hosted health probe sends an authenticated scoped request and returns privacy-minimal signals",async()=>{
  let request;const fetchImpl=async(url,options)=>{request={url:String(url),options};return{ok:true,status:200,json:async()=>[signal]}};
  const rows=await fetchOperationalHealth({baseUrl:"https://project.supabase.co",apiKey:"public-project-key",accessToken:"secret-monitor-token",householdId:"household-a",evaluatedAt:"2026-08-28T15:00:00Z",fetchImpl});
  assert.equal(request.url,"https://project.supabase.co/rest/v1/rpc/admin_operational_health_snapshot");assert.equal(request.options.headers.authorization,"Bearer secret-monitor-token");assert.equal(request.options.headers.apikey,"public-project-key");assert.notEqual(request.options.headers.apikey,"secret-monitor-token");assert.deepEqual(JSON.parse(request.options.body),{target_household:"household-a",evaluated_at:"2026-08-28T15:00:00.000Z"});assert.equal(rows[0].entity_count,2);
});

test("health response validation rejects extra fields and unknown signals",()=>{assert.throws(()=>validateHealthSignals([{...signal,learner_name:"Private"}]),/unexpected fields/);assert.throws(()=>validateHealthSignals([{...signal,signal_code:"unknown"}]),/unknown/)});

test("health summary maps healthy warning and error states to monitoring exit codes",()=>{assert.deepEqual(summarizeOperationalHealth([]),{status:"healthy",exitCode:0,signalCount:0,signals:[]});assert.equal(summarizeOperationalHealth([{...signal,severity:"warning"}]).exitCode,1);assert.equal(summarizeOperationalHealth([signal]).exitCode,2)});

test("hosted health probe enforces secure transport and reports only HTTP status",async()=>{await assert.rejects(()=>fetchOperationalHealth({baseUrl:"http://example.com",apiKey:"public-key",accessToken:"top-secret",householdId:"household-a"}),/HTTPS/);await assert.rejects(()=>fetchOperationalHealth({baseUrl:"https://project.supabase.co",apiKey:"public-key",accessToken:"top-secret",householdId:"household-a",fetchImpl:async()=>({ok:false,status:401})}),error=>{assert.equal(error.message,"Operational health request failed with HTTP 401");assert.ok(!error.message.includes("top-secret"));assert.ok(!error.message.includes("public-key"));return true})});

test("hosted health probe requires a separate project API key",async()=>{await assert.rejects(()=>fetchOperationalHealth({baseUrl:"https://project.supabase.co",accessToken:"token",householdId:"household-a"}),/public API key/)});
