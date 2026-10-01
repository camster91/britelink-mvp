// Transport boundary for the disposable saved-image journey, not a host firewall.
export function journeyNetworkGuard(origins, nativeFetch = globalThis.fetch) {
  const allowed = new Set(origins.map(value => new URL(value).origin));
  let denied = 0;
  const accepts = value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && allowed.has(url.origin);
    } catch { return false; }
  };
  const reject = () => { denied++; return new Error('Journey request left its reviewed fixture origins'); };
  return {
    async fetch(input, init = {}) {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (!accepts(url)) throw reject();
      // Refuse redirects before fetch can forward a service key or a write.
      const response = await nativeFetch(input, { ...init, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        await response.body?.cancel(); throw reject();
      }
      return response;
    },
    async protectContext(context) {
      if (context.serviceWorkers().length) throw new Error('Journey context has an active service worker');
      await context.route('**/*', async route => {
        const url = route.request().url();
        if (!accepts(url)) { reject(); await route.abort('blockedbyclient'); return; }
        // Inspect each redirect without letting the API request follow it.
        const response = await route.fetch({ maxRedirects: 0 });
        const location = response.headers().location;
        if (response.status() >= 300 && response.status() < 400 && location && !accepts(new URL(location, url).href)) {
          reject(); await route.abort('blockedbyclient'); return;
        }
        await route.fulfill({ response });
      });
      await context.routeWebSocket('**/*', socket => {
        reject(); socket.close({ code: 1008, reason: 'Fixture journey does not use WebSockets' });
      });
    },
    assertClean() { if (denied) throw new Error('Journey attempted a request outside its fixture transport boundary'); },
    proof() { return { guardedNodeFetch: true, guardedBrowserRequests: true, browserWebSocketsBlocked: true, blockedRequests: denied }; },
  };
}

export function configuredJourneyGuard(config, env = process.env) {
  if (env.BRITELINK_CHECKED_BUILD_MODE !== 'qa-configured') return null;
  if (env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{40}$/.test(env.RELEASE_SHA || '') || !/^[0-9]+$/.test(env.GITHUB_RUN_ID || '') || !/^[0-9]+$/.test(env.GITHUB_RUN_ATTEMPT || '') || config.appUrl !== 'http://127.0.0.1:8099' || config.supabaseUrl !== config.appUrl)
    throw new Error('Disposable journey transport requires the exact CI fixture');
  return journeyNetworkGuard([config.appUrl]);
}
