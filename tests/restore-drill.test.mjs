import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const scriptUrl=new URL("../scripts/local-restore-drill.sh",import.meta.url);

test("restore drill uses isolated clusters encrypted archives and storage reconciliation",async()=>{
  const script=await readFile(scriptUrl,"utf8");
  for(const evidence of ["mktemp -d","source-data","restore-data","pg_dump","--schema=public","--data-only","--single-transaction","session_replication_role=replica","aes-256-cbc","storage.tar","shasum -a 256","diff -u","cross_house_count","post_restore_message","productionRestore:false"])assert.match(script,new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(script,/chmod 700/);assert.match(script,/openssl rand -hex 32/);assert.doesNotMatch(script,/postgresql:\/\//);assert.doesNotMatch(script,/SUPABASE_(ACCESS_TOKEN|SERVICE_ROLE_KEY)=/);
});
