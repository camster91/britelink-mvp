import assert from "node:assert/strict";
import test from "node:test";
import { OperationController, classifyOperationError } from "../src/operation-state.js";

test("operation controller reports loading success and response data", async () => {
  const controller=new OperationController({isOnline:()=>true});
  const pending=controller.run(async()=>({saved:true})); assert.equal(controller.snapshot().status,"loading");
  assert.deepEqual(await pending,{status:"success",data:{saved:true},error:null,attempt:1,canRetry:false});
});

test("offline operations do not call the write and become retryable", async () => {
  let online=false,calls=0; const controller=new OperationController({isOnline:()=>online});
  assert.equal((await controller.run(async()=>{calls+=1})).status,"offline"); assert.equal(calls,0);
  online=true; assert.equal((await controller.retry()).status,"success"); assert.equal(calls,1);
});

test("failed optimistic updates roll back and retry safely", async () => {
  let value="original",calls=0; const controller=new OperationController({isOnline:()=>true});
  const operation=async()=>{calls+=1;if(calls===1)throw new Error("Temporary failure");return "saved"};
  let result=await controller.run(operation,{optimistic:()=>{const before=value;value="optimistic";return before},rollback:(before)=>{value=before}});
  assert.equal(result.status,"error"); assert.equal(value,"original"); assert.equal(result.canRetry,true);
  result=await controller.retry(); assert.equal(result.status,"success"); assert.equal(value,"optimistic"); assert.equal(result.attempt,2);
});

test("conflict and expired-session failures require explicit resolution", async () => {
  assert.equal(classifyOperationError({status:409}),"conflict"); assert.equal(classifyOperationError({code:"23505"}),"conflict");
  assert.equal(classifyOperationError({status:401}),"session_expired"); assert.equal(classifyOperationError({code:"AUTH_SESSION_MISSING"}),"session_expired");
  for(const error of [Object.assign(new Error("Changed elsewhere"),{status:409}),Object.assign(new Error("Sign in again"),{status:401})]){
    const controller=new OperationController({isOnline:()=>true}); const result=await controller.run(async()=>{throw error});
    assert.equal(result.canRetry,false); await assert.rejects(()=>controller.retry(),/cannot be retried/);
  }
});
