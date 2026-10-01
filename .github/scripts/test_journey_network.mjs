import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {chromeLaunchOptions} from '../../scripts/resolve-chrome.mjs';
import {journeyNetworkGuard, configuredJourneyGuard} from '../../scripts/journey-network-guard.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
test('CI transport rejects a changed fixture before any request', () => {
  const env = {GITHUB_ACTIONS:'true',RELEASE_SHA:'a'.repeat(40),GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',BRITELINK_CHECKED_BUILD_MODE:'qa-configured'};
  const config = {appUrl:'http://127.0.0.1:8099',supabaseUrl:'http://127.0.0.1:8099'};
  assert.ok(configuredJourneyGuard(config, env));
  assert.throws(() => configuredJourneyGuard({...config,supabaseUrl:'https://britelink-api.ashbi.ca'}, env));
  assert.throws(() => configuredJourneyGuard(config, {...env,GITHUB_ACTIONS:'false'}));
  assert.equal(configuredJourneyGuard(config, {}), null);
});

test('real Node and browser requests cannot contact another server, including redirects and WebSockets', async () => {
  let forbiddenHits = 0;
  const forbidden = createServer((req,res) => { forbiddenHits++; res.end('forbidden'); });
  forbidden.on('upgrade', (req,socket) => { forbiddenHits++; socket.destroy(); });
  await listen(forbidden);
  const outside = `http://127.0.0.1:${forbidden.address().port}`;
  const fixture = createServer((req,res) => {
    if (req.url === '/redirect') { res.writeHead(302,{location:outside+'/target'}); res.end(); return; }
    if (req.url === '/local-redirect') { res.writeHead(302,{location:'/ok'}); res.end(); return; }
    res.end('fixture');
  });
  await listen(fixture);
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  let browser;
  try {
    const guard = journeyNetworkGuard([origin]);
    assert.equal(await (await guard.fetch(origin+'/ok')).text(), 'fixture');
    await assert.rejects(guard.fetch(outside+'/write',{method:'POST',body:'synthetic'}));
    await assert.rejects(guard.fetch(origin+'/redirect',{headers:{authorization:'Bearer synthetic'}}));
    await assert.rejects(guard.fetch(origin+'/redirect',{redirect:'follow'}));
    await assert.rejects(guard.fetch(origin.replace('http://','http://user:pass@')+'/ok'));
    browser = await chromium.launch(chromeLaunchOptions());
    const context = await browser.newContext({serviceWorkers:'block'});
    await guard.protectContext(context);
    const page = await context.newPage();
    assert.equal((await page.goto(origin+'/ok')).status(),200);
    assert.equal((await page.goto(origin+'/local-redirect')).status(),200);
    assert.equal(await page.locator('body').textContent(),'fixture');
    const direct = await context.newPage();
    await assert.rejects(direct.goto(outside+'/target'));
    await direct.close();
    const redirect = await context.newPage();
    await assert.rejects(redirect.goto(origin+'/redirect'));
    await redirect.close();
    assert.equal(await page.evaluate(async url => {try {await fetch(url,{method:'POST',body:'synthetic'});return true;}catch{return false;}},outside+'/write'),false);
    await page.evaluate(url => new Promise(resolve => {
      const socket = new WebSocket(url.replace('http:','ws:'));
      socket.onclose = () => resolve(); socket.onerror = () => resolve();
      setTimeout(resolve,1000);
    }),outside+'/socket');
    assert.throws(() => guard.assertClean());
    assert.ok(guard.proof().blockedRequests >= 6);
    assert.equal(forbiddenHits,0,'the second HTTP/upgrade server must never receive a request');
    await context.close();
  } finally {
    await browser?.close();
    await close(fixture); await close(forbidden);
  }
});
