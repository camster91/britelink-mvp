import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './configured-qa-env.mjs';
const identity={GITHUB_ACTIONS:'true',RELEASE_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
test('fresh runners derive matching disposable signing keys for the checked run',()=>{
  assert.deepEqual(fixture(identity),fixture({...identity}));
  const a=fixture(identity),b=fixture({...identity,GITHUB_RUN_ATTEMPT:'2'});
  assert.notEqual(a.JWT_SECRET,b.JWT_SECRET);assert.notEqual(a.ANON_KEY,b.ANON_KEY);
  assert.equal(a.PUBLIC_URL,'http://127.0.0.1:8099');
  assert.equal(JSON.parse(Buffer.from(a.ANON_KEY.split('.')[1],'base64url')).role,'anon');
  assert.equal(JSON.parse(Buffer.from(a.SERVICE_KEY.split('.')[1],'base64url')).role,'service_role');
});
test('operator workspaces, incomplete revisions and untrusted run identities cannot create fixture settings',()=>{
  for(const change of [{GITHUB_ACTIONS:'false'},{RELEASE_SHA:'short'},{GITHUB_RUN_ID:'production'},{GITHUB_RUN_ATTEMPT:''}])assert.throws(()=>fixture({...identity,...change}));
});
