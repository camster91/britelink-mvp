import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const base=process.env.BRITELINK_CHECKED_RUNTIME_URL;
const target=new URL(base);
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.BRITELINK_CHECKED_RUNTIME_MODE,'unconfigured-demo');
assert.equal(target.hostname,'127.0.0.1');assert.equal(target.protocol,'http:');
assert.match(process.env.RELEASE_SHA||'',/^[a-f0-9]{40}$/);
const info=await fetch(base+'/version.json');assert.equal(info.status,200);
assert.equal((await info.json()).commit,process.env.RELEASE_SHA);
const home=await fetch(base+'/');assert.equal(home.status,200);
assert.equal(home.headers.get('x-content-type-options'),'nosniff');
assert.equal(home.headers.get('x-frame-options'),'DENY');
assert.match(home.headers.get('content-security-policy'),/connect-src 'self'\s*;/);
const deep=await fetch(base+'/fixture/deep/link');assert.equal(deep.status,200);
assert.equal(await deep.text(),await home.text());
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();const external=[];const pageErrors=[];
  await page.route('**/*',route=>{
    const request=new URL(route.request().url());
    if(request.origin!==target.origin){external.push(request.hostname);return route.abort();}
    return route.continue();
  });
  page.on('pageerror',error=>pageErrors.push(error.name));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Learning plan',exact:true}).click();
  await page.getByRole('button',{name:'Learner profile',exact:true}).click();
  assert.deepEqual(external,[],'Demo image must not contact an external provider');
  assert.deepEqual(pageErrors,[],'Saved runtime must start without browser exceptions');
}finally{await browser.close();}
execFileSync(process.execPath,['scripts/a11y-audit.mjs'],{stdio:'inherit',env:process.env});
console.log('Saved image revision, headers, deep links, browser navigation and 12 demo accessibility combinations passed');
