// External production monitor (#7), run hourly by .github/workflows/monitor.yml from GitHub's
// runners, i.e. from outside the VPS. It uses only what any visitor can see: the public site, the
// public anon key the site ships in its bundle, and the public API. Exit 0 = healthy; exit 1 = at
// least one check failed, which fails the workflow run and makes GitHub email the repository owner.
//
// Checks
//   site          https://<site>/ answers 200 with HSTS, a CSP and nosniff, and its first script
//                 asset keeps HSTS and nosniff
//   version       /version.json names a 40-hex commit
//   api-key       the bundle's anon key is accepted by the API (a dummy calendar_feed call must be
//                 refused by the RPC itself, not rejected as a bad JWT: PGRST30x = key rejected)
//   feed-route    /feed/<dummy token>.ics answers 404 (the route is up and hides refusals); a 502
//                 means the web container cannot reach or verify the API
//   tls-<host>    certificates for the site and the API are valid for at least 14 more days
//   closed-ports  the backend's internal ports (Postgres, GoTrue, PostgREST, Storage, the Supabase
//                 gateway, the web container) refuse or ignore connections from the internet; only
//                 Traefik on 80/443 should answer for the app and API hosts
import net from "node:net";
import tls from "node:tls";

const SITE = process.env.MONITOR_SITE || "britelink.ashbi.ca";
const API = process.env.MONITOR_API || "britelink-api.ashbi.ca";
const MIN_CERT_DAYS = Number(process.env.MONITOR_MIN_CERT_DAYS || 14);
const DUMMY_TOKEN = "0".repeat(64);
// Ports BriteLink's stacks listen on inside the VPS. Each is bound to 127.0.0.1 or a Docker network;
// one answering from outside means a compose file published it to the internet.
const INTERNAL_PORTS = (process.env.MONITOR_INTERNAL_PORTS || "3000,5000,5432,6543,8088,8098,9999,54321,54322")
  .split(",").map(Number).filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
const results = [];

async function check(name, run) {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}
const get = (url, init = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000), ...init });

function certDaysLeft(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!socket.authorized) return reject(new Error(`certificate not trusted: ${socket.authorizationError}`));
      resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000));
    });
    socket.on("error", reject);
    socket.on("timeout", () => { socket.destroy(); reject(new Error("TLS connect timed out")); });
  });
}

// Resolves true only when a TCP connection completes. Refused, unreachable or silent all count as
// closed: a firewall that drops packets is as good as one that refuses them.
function portAnswers(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function publicAnonKey() {
  // The anon key is public by design (it ships to every browser). Follow the bundle's JS chunks.
  const html = await (await get(`https://${SITE}/`)).text();
  const queue = [...new Set(html.match(/assets\/[^"']+\.js/g) ?? [])];
  const seen = new Set();
  while (queue.length && seen.size < 40) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const js = await (await get(`https://${SITE}/${path}`)).text();
    for (const candidate of js.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g) ?? []) {
      try {
        const payload = JSON.parse(Buffer.from(candidate.split(".")[1], "base64url").toString("utf8"));
        if (payload.role === "anon") return candidate;
      } catch { /* not a JWT */ }
    }
    for (const next of js.match(/assets\/[\w.-]+\.js/g) ?? []) if (!seen.has(next)) queue.push(next);
  }
  throw new Error("no anon key found in the served bundle");
}

await check("site", async () => {
  const response = await get(`https://${SITE}/`);
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const missing = ["strict-transport-security", "content-security-policy", "x-content-type-options"].filter((h) => !response.headers.get(h));
  if (missing.length) throw new Error(`missing headers: ${missing.join(", ")}`);
  // Static files are served from their own nginx location, whose add_header replaces the server's.
  const script = (await response.text()).match(/assets\/[^"']+\.js/)?.[0];
  if (!script) throw new Error("no script asset referenced by the page");
  const asset = await get(`https://${SITE}/${script}`);
  const assetMissing = ["strict-transport-security", "x-content-type-options"].filter((h) => !asset.headers.get(h));
  if (asset.status !== 200 || assetMissing.length) throw new Error(`${script}: HTTP ${asset.status}${assetMissing.length ? `, missing ${assetMissing.join(", ")}` : ""}`);
  return "HTTP 200 with HSTS, CSP and nosniff; scripts keep HSTS and nosniff";
});

await check("version", async () => {
  const response = await get(`https://${SITE}/version.json`);
  const body = await response.json();
  if (!/^[0-9a-f]{40}$/.test(body.commit ?? "")) throw new Error(`unexpected version.json: ${JSON.stringify(body).slice(0, 120)}`);
  return `${body.commit.slice(0, 12)} built ${body.builtAt}`;
});

await check("api-key", async () => {
  const key = await publicAnonKey();
  const response = await get(`https://${API}/rest/v1/rpc/calendar_feed?token=${DUMMY_TOKEN}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "text/calendar" },
  });
  const code = (await response.json().catch(() => ({}))).code ?? "";
  if (/^PGRST30/.test(code)) throw new Error(`the API rejects the site's key (HTTP ${response.status} ${code})`);
  if (response.status >= 500) throw new Error(`API error HTTP ${response.status} ${code}`);
  return `key accepted (HTTP ${response.status} ${code || "no code"})`;
});

await check("feed-route", async () => {
  const response = await get(`https://${SITE}/feed/${DUMMY_TOKEN}.ics`);
  if (response.status !== 404) throw new Error(`a dummy feed link answered HTTP ${response.status}, expected 404`);
  return "dummy link answers 404";
});

for (const host of [SITE, API]) {
  await check(`tls-${host}`, async () => {
    const days = await certDaysLeft(host);
    if (days < MIN_CERT_DAYS) throw new Error(`certificate expires in ${days} day(s)`);
    return `${days} days left`;
  });
}

await check("closed-ports", async () => {
  const open = [];
  for (const host of [...new Set([SITE, API])]) {
    const answers = await Promise.all(INTERNAL_PORTS.map((port) => portAnswers(host, port)));
    INTERNAL_PORTS.forEach((port, index) => { if (answers[index]) open.push(`${host}:${port}`); });
  }
  if (open.length) throw new Error(`reachable from the internet: ${open.join(", ")}`);
  return `${INTERNAL_PORTS.length} internal ports closed on both hosts`;
});

for (const result of results) console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name.padEnd(28)} ${result.detail}`);
const failed = results.filter((result) => !result.ok);
console.log(failed.length ? `UNHEALTHY: ${failed.length} check(s) failed` : `HEALTHY: ${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
