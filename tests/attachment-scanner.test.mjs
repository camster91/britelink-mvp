import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  configure,
  digestOf,
  parseClamdReply,
  runOnce,
  sanitizeResultCode,
  scanOne,
} from "../scripts/attachment-scanner.mjs";

const scannerScript=fileURLToPath(new URL("../scripts/attachment-scanner.mjs",import.meta.url));

// The DB check on scan_result_code is ^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$, so a code that
// fails it would abort the verdict it belongs to. Every sanitised code must satisfy it.
const RESULT_CODE_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/;

test("a clamd reply is only clean when it says OK",()=>{
  assert.deepEqual(parseClamdReply("stream: OK"),{verdict:"clean",code:"ok"});

  const rejected=parseClamdReply("stream: Eicar-Test-Signature FOUND");
  assert.equal(rejected.verdict,"rejected");
  assert.match(rejected.code,RESULT_CODE_PATTERN);

  // Signature names carry characters the result-code check rejects, so they are sanitised
  // rather than passed through. The verdict must survive the sanitisation.
  for(const signature of ["Win.Trojan.Agent-1234567 FOUND","PUA.Script/JS.Obfuscated FOUND","Html.Exploit.CVE_2024_1234:1 FOUND"]){
    const parsed=parseClamdReply(`stream: ${signature}`);
    assert.equal(parsed.verdict,"rejected",signature);
    assert.match(parsed.code,RESULT_CODE_PATTERN,signature);
  }

  // Fail-closed: an unrecognised or missing reply is an error, never a clean. Defaulting
  // an unknown reply to 'clean' would publish files nobody has actually scanned.
  for(const reply of ["stream: MOVED","stream: INSTREAM size limit exceeded. ERROR","","nonsense","OK"]){
    const parsed=parseClamdReply(reply);
    assert.equal(parsed.verdict,"error",JSON.stringify(reply));
    assert.notEqual(parsed.verdict,"clean",JSON.stringify(reply));
  }
  assert.equal(parseClamdReply("stream: INSTREAM size limit exceeded. ERROR").verdict,"error");
});

test("result codes are always within the constraint the database enforces",()=>{
  for(const raw of ["Eicar-Test-Signature","a","",null,undefined,"  ","..","/etc/passwd","a".repeat(200),"sp ace","tab\there"]){
    const code=sanitizeResultCode(raw);
    assert.match(code,RESULT_CODE_PATTERN,`sanitizeResultCode(${JSON.stringify(raw)}) produced ${JSON.stringify(code)}`);
  }
  assert.equal(sanitizeResultCode("a"),"unknown");
  assert.equal(sanitizeResultCode(null),"unknown");
  assert.equal(sanitizeResultCode("a".repeat(200)).length,80);
});

test("a scanner error records nothing and leaves the object quarantined",async()=>{
  const calls=[];
  const entry=await scanOne({
    attachment:{attachment_id:"a1",household_id:"h1",object_path:"h1/c1/m1/a1.bin"},
    storage:{download:async()=>({data:Buffer.from("payload")})},
    rpc:async(name)=>calls.push(name),
    scanner:Object.assign(async()=>({verdict:"error",code:"scanner_unreachable"}),{provider:"clamav"}),
  });
  assert.equal(entry.outcome,"deferred");
  assert.equal(entry.reason,"scan_error");
  assert.equal(entry.detail,"scanner_unreachable");
  // The whole fail-closed property: no verdict reaches the database, so the object stays in
  // pending_scan and attachment.scan_stale escalates. There is no scan_failed state to land in.
  assert.deepEqual(calls,[]);
});

test("a rejected object is recorded then deleted, and a clean one is kept",async()=>{
  const recorded=[];const removed=[];const deleted=[];
  const attachment={attachment_id:"a2",household_id:"h2",object_path:"h2/c1/m1/a2.bin"};
  const storage={
    download:async()=>({data:Buffer.from("malware")}),
    remove:async(path)=>removed.push(path),
    delete:async(path)=>deleted.push(path),
  };
  const rpc=async(name,args)=>{recorded.push(args);return {data:[{attachment_status:args.scan_verdict}]};};
  const scanner=Object.assign(async()=>({verdict:"rejected",code:"Eicar-Test-Signature"}),{provider:"clamav"});

  const rejected=await scanOne({attachment,storage,rpc,scanner});
  assert.equal(rejected.outcome,"rejected");
  assert.equal(recorded.length,1);
  assert.equal(recorded[0].scan_verdict,"rejected");
  assert.equal(recorded[0].target_household,"h2");
  // The digest the adapter sends must be the digest of the bytes it actually scanned.
  assert.equal(recorded[0].content_sha256,digestOf(Buffer.from("malware")));
  assert.deepEqual(removed,["h2/c1/m1/a2.bin"]);

  const clean=await scanOne({
    attachment:{attachment_id:"a3",household_id:"h2",object_path:"h2/c1/m1/a3.bin"},
    storage,rpc:(name,args)=>{recorded.push(args);return {data:[{attachment_status:"clean"}]};},
    scanner:Object.assign(async()=>({verdict:"clean",code:"ok"}),{provider:"clamav"}),
  });
  assert.equal(clean.outcome,"clean");
  // A clean object is never removed, and the adapter never deletes anything itself.
  assert.deepEqual(removed,["h2/c1/m1/a2.bin"]);
  assert.deepEqual(deleted,[]);
});

test("a scan that cannot be recorded is a deferral, not a verdict",async()=>{
  const base={
    attachment:{attachment_id:"a4",household_id:"h4",object_path:"h4/c1/m1/a4.bin"},
    scanner:Object.assign(async()=>({verdict:"clean",code:"ok"}),{provider:"clamav"}),
  };
  const downloadFailed=await scanOne({...base,storage:{download:async()=>({error:{message:"gone"}})},rpc:async()=>{throw new Error("must not record");}});
  assert.equal(downloadFailed.outcome,"deferred");
  assert.equal(downloadFailed.reason,"download_failed");

  const recordFailed=await scanOne({...base,storage:{download:async()=>({data:Buffer.from("x")})},rpc:async()=>({error:{message:"rpc down"}})});
  assert.equal(recordFailed.outcome,"deferred");
  assert.equal(recordFailed.reason,"record_failed");
  // Nothing is deleted on a failed record: deleting an object whose verdict was never stored
  // would leave metadata pointing at nothing.
  assert.equal(recordFailed.objectDeleted,undefined);
});

test("a queue run defers failed scans instead of aborting the rest of the batch",async()=>{
  const queue=[
    {attachment_id:"q1",household_id:"hq",object_path:"hq/c/m/q1.bin"},
    {attachment_id:"q2",household_id:"hq",object_path:"hq/c/m/q2.bin"},
    {attachment_id:"q3",household_id:"hq",object_path:"hq/c/m/q3.bin"},
  ];
  const verdicts={"q1.bin":"clean","q2.bin":"error","q3.bin":"clean"};
  const report=await runOnce({
    config:{batchSize:25},
    storage:{download:async(path)=>({data:Buffer.from(path)}),remove:async()=>{}},
    rpc:async(name)=>(name==="admin_list_pending_scan_attachments"?{data:queue}:{data:[{}]}),
    scanner:Object.assign(async({bytes})=>({verdict:verdicts[bytes.toString().split("/").pop()],code:verdicts[bytes.toString().split("/").pop()]==="clean"?"ok":"scanner_unreachable"}),{provider:"clamav"}),
  });
  assert.equal(report.entries.length,3);
  assert.deepEqual(report.entries.map((entry)=>entry.outcome),["clean","deferred","clean"]);
  assert.equal(report.reconciliation,null);
});

test("an unconfigured scanner exits 2 and says it is not a passing scan",()=>{
  const env={PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT};
  const check=spawnSync(process.execPath,[scannerScript,"--check"],{env,encoding:"utf8"});
  assert.equal(check.status,2,`expected exit 2, got ${check.status}`);
  assert.match(check.stderr,/UNWIRED/);
  // The point of the exit code: an unconfigured scanner must never read as success.
  assert.notEqual(check.status,0);
  assert.match(check.stderr,/BRITELINK_SUPABASE_URL/);

  const configured=spawnSync(process.execPath,[scannerScript,"--check"],{
    env:{...env,BRITELINK_SUPABASE_URL:"https://example.supabase.co",BRITELINK_SERVICE_ROLE_KEY:"service-role-key",BRITELINK_CLAMD_HOST:"127.0.0.1"},
    encoding:"utf8",
  });
  assert.equal(configured.status,0,configured.stderr);
});

test("configuration reports every missing value rather than failing on the first",()=>{
  const empty=configure({});
  assert.equal(empty.configured,false);
  assert.deepEqual(empty.missing,["BRITELINK_SUPABASE_URL","BRITELINK_SERVICE_ROLE_KEY","BRITELINK_CLAMD_HOST"]);

  const badPort=configure({BRITELINK_SUPABASE_URL:"u",BRITELINK_SERVICE_ROLE_KEY:"k",BRITELINK_CLAMD_HOST:"h",BRITELINK_CLAMD_PORT:"70000"});
  assert.equal(badPort.configured,false);
  assert.deepEqual(badPort.missing,["BRITELINK_CLAMD_PORT (invalid)"]);

  const full=configure({BRITELINK_SUPABASE_URL:"u",BRITELINK_SERVICE_ROLE_KEY:"k",BRITELINK_CLAMD_HOST:"h"});
  assert.equal(full.configured,true);
  assert.deepEqual(full.missing,[]);
  // Defaults match the deployed clamd port and are documented, not accidental.
  assert.equal(full.clamdPort,3310);
});
