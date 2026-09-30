// The /feed/<token>.ics route in nginx.conf.template (#47), exercised in a real nginx against a fake
// PostgREST. Static assertions always run; the functional ones need an nginx binary and are skipped
// (with the reason printed) where there is none, e.g. on the hosted CI image.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const template = await readFile(new URL("../nginx.conf.template", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const nginxBinary = ["/usr/sbin/nginx", "/usr/local/sbin/nginx", "/usr/bin/nginx"].find(
  (candidate) => spawnSync(candidate, ["-v"]).status === 0,
);
// CI sets this where it installed nginx, so the functional tests cannot silently skip there.
test("nginx is present wherever CI requires it", () => {
  if (process.env.BRITELINK_REQUIRE_NGINX === "1") assert.ok(nginxBinary, "BRITELINK_REQUIRE_NGINX=1 but no nginx binary was found");
});
const TOKEN = "a".repeat(64);
const REVOKED = "b".repeat(64);
const ANON = "anon-key-for-test";

// The nginx image's entrypoint runs envsubst restricted by NGINX_ENVSUBST_FILTER=BRITELINK_.
const render = (vars) =>
  template.replace(/\$\{(BRITELINK_[A-Z_]+)\}/g, (_, name) => {
    assert.ok(name in vars, `template uses ${name}; the Dockerfile must define it`);
    return vars[name];
  });

test("every BRITELINK_ variable the template uses is defined by the Dockerfile, even when empty", () => {
  const used = new Set([...template.matchAll(/\$\{(BRITELINK_[A-Z_]+)\}/g)].map((match) => match[1]));
  for (const name of used) assert.match(dockerfile, new RegExp(`ENV ${name}=`), `${name} must be an ENV in the final stage`);
  assert.match(dockerfile, /ARG VITE_SUPABASE_ANON_KEY=""\s*\nENV BRITELINK_API_ANON_KEY=\$VITE_SUPABASE_ANON_KEY/);
});

test("the feed route is narrow: 64 hex characters, no access log, errors become 404", () => {
  const route = template.slice(template.indexOf("location ~ \"^/feed/"), template.indexOf("location @calendar_feed_gone"));
  assert.match(route, /\[0-9a-f\]\{64\}/);
  assert.match(route, /access_log off;/);
  assert.match(route, /proxy_intercept_errors on;/);
  assert.match(route, /error_page 400 401 403 404 406 = @calendar_feed_gone;/);
  assert.match(route, /proxy_set_header Cookie "";/);
  assert.match(route, /Strict-Transport-Security/);
  assert.match(route, /proxy_ssl_verify on;/);
  // nginx's default depth (1) cannot verify a cross-signed Let's Encrypt chain; that was the live 502.
  const depth = Number(route.match(/proxy_ssl_verify_depth (\d+);/)?.[1]);
  assert.ok(depth >= 3, "proxy_ssl_verify_depth must be at least 3 for a cross-signed CA chain");
  assert.doesNotMatch(route, /service_role|SERVICE_ROLE/);
});

async function withNginx(vars, run) {
  const dir = await mkdtemp(path.join(tmpdir(), "bl-nginx-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const site = render(vars).replace("listen 80;", `listen 127.0.0.1:${port};`).replace("root /usr/share/nginx/html;", `root ${dir};`);
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>app</title>");
  await writeFile(path.join(dir, "site.conf"), site);
  await writeFile(
    path.join(dir, "nginx.conf"),
    `pid ${dir}/nginx.pid; error_log ${dir}/error.log; daemon off; events {}
     http { include /etc/nginx/mime.types; access_log off; client_body_temp_path ${dir}; proxy_temp_path ${dir}; fastcgi_temp_path ${dir}; uwsgi_temp_path ${dir}; scgi_temp_path ${dir}; include ${dir}/site.conf; }`,
  );
  const checked = spawnSync(nginxBinary, ["-t", "-e", `${dir}/error.log`, "-p", dir, "-c", `${dir}/nginx.conf`], { encoding: "utf8" });
  assert.equal(checked.status, 0, `nginx -t failed:\n${checked.stderr}`);
  const server = spawn(nginxBinary, ["-e", `${dir}/error.log`, "-p", dir, "-c", `${dir}/nginx.conf`], { stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    return await run(`http://127.0.0.1:${port}`, dir);
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test("the feed route proxies a live token to PostgREST as text/calendar, and hides every refusal", { skip: nginxBinary ? false : "no nginx binary on this machine" }, async () => {
  const seen = [];
  const api = createServer((request, response) => {
    seen.push({ url: request.url, headers: request.headers });
    const url = new URL(request.url, "http://api");
    if (url.pathname === "/rest/v1/rpc/calendar_feed" && url.searchParams.get("token") === TOKEN && request.headers.accept === "text/calendar") {
      response.writeHead(200, { "content-type": "text/calendar", "set-cookie": "should=not-pass" });
      response.end("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
      return;
    }
    response.writeHead(403, { "content-type": "application/json" });
    response.end('{"code":"42501","message":"calendar feed not found"}');
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${api.address().port}`;
  try {
    await withNginx({ BRITELINK_API_ORIGIN: origin, BRITELINK_API_ANON_KEY: ANON }, async (base) => {
      const ok = await fetch(`${base}/feed/${TOKEN}.ics`, { headers: { cookie: "sb-session=secret", authorization: "Bearer user-jwt" } });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("content-type"), "text/calendar; charset=utf-8");
      assert.equal(ok.headers.get("set-cookie"), null);
      assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
      assert.equal(await ok.text(), "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
      const call = seen.at(-1);
      assert.equal(call.headers.apikey, ANON);
      assert.equal(call.headers.authorization, `Bearer ${ANON}`, "the caller's own credentials never reach the API");
      assert.equal(call.headers.cookie ?? "", "");

      const gone = await fetch(`${base}/feed/${REVOKED}.ics`);
      assert.equal(gone.status, 404);
      assert.doesNotMatch(await gone.text(), /42501|calendar feed not found/, "no refusal detail leaks");

      const calls = seen.length;
      for (const bad of ["A".repeat(64), "a".repeat(63), `${"a".repeat(64)}x`]) {
        const response = await fetch(`${base}/feed/${bad}.ics`);
        assert.notEqual(response.headers.get("content-type"), "text/calendar; charset=utf-8", bad);
      }
      assert.equal(seen.length, calls, "malformed paths never reach the API");
    });
  } finally {
    api.close();
  }
});

test("an unconfigured (demo) build starts and answers the feed route with 404", { skip: nginxBinary ? false : "no nginx binary on this machine" }, async () => {
  await withNginx({ BRITELINK_API_ORIGIN: "", BRITELINK_API_ANON_KEY: "" }, async (base) => {
    assert.equal((await fetch(`${base}/feed/${TOKEN}.ics`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 200, "the app itself still serves");
  });
});
