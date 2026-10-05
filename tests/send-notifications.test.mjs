// scripts/send-notifications.sh against stand-ins for docker (database + auth container) and curl
// (SMTP): what it sends, what it records, and what it must never expose.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "s3cret-smtp-pass";

function run({ claims, curlFails = false }) {
  const dir = mkdtempSync(path.join(tmpdir(), "notify-"));
  const log = path.join(dir, "log");
  writeFileSync(path.join(dir, "claims"), claims);
  writeFileSync(path.join(dir, "docker"), `#!/bin/bash
if [ "$1" = inspect ]; then
  printf 'GOTRUE_SMTP_HOST=smtp.example.test\\nGOTRUE_SMTP_PORT=587\\nGOTRUE_SMTP_USER=postmaster@example.test\\nGOTRUE_SMTP_PASS=${SECRET}\\nGOTRUE_SMTP_ADMIN_EMAIL=no-reply@example.test\\n'
  exit 0
fi
sql="\${@: -1}"
echo "SQL $sql" >> "${log}"
case "$sql" in *notification_claim*) cat "${dir}/claims" ;; esac
`);
  writeFileSync(path.join(dir, "curl"), `#!/bin/bash
echo "CURL $*" >> "${log}"
while [ $# -gt 0 ]; do [ "$1" = --upload-file ] && cat "$2" >> "${dir}/mail"; [ "$1" = --netrc-file ] && cp "$2" "${dir}/netrc-copy"; shift; done
${curlFails ? 'echo "connection refused" >&2; exit 7' : "exit 0"}
`);
  chmodSync(path.join(dir, "docker"), 0o755);
  chmodSync(path.join(dir, "curl"), 0o755);
  const result = spawnSync("bash", [path.join(root, "scripts", "send-notifications.sh")], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: "utf8",
  });
  const read = (name) => (existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : "");
  return { ...result, log: read("log"), mail: read("mail"), netrc: read("netrc-copy") };
}

test("each claimed notice is emailed with no child details and recorded as sent", () => {
  const r = run({ claims: "7\tplan_delivered\tparent@example.test\n8\tmessage_to_staff\teducator@example.test\n" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /notices sent: 2, failed: 0/);
  assert.match(r.mail, /Subject: Your BriteLink plan is ready/);
  assert.match(r.mail, /Subject: A family sent a message in BriteLink/);
  assert.match(r.mail, /never includes details about your child/);
  assert.match(r.mail, /https:\/\/britelink\.ashbi\.ca/);
  assert.match(r.log, /notification_finish\(7, true\)/);
  assert.match(r.log, /notification_finish\(8, true\)/);
});

test("the SMTP password never appears on a command line or in output", () => {
  const r = run({ claims: "7\tplan_delivered\tparent@example.test\n" });
  assert.doesNotMatch(r.log, new RegExp(SECRET), "not passed as a curl argument");
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
  assert.match(r.netrc, new RegExp(`password ${SECRET}`), "handed to curl through the netrc file");
  assert.doesNotMatch(r.stdout + r.stderr, /parent@example\.test/, "addresses are not printed");
});

test("a failed send is recorded for retry, and a run where nothing could be sent fails", () => {
  const r = run({ claims: "9\tmessage_to_guardian\tparent@example.test\n", curlFails: true });
  assert.equal(r.status, 1);
  assert.match(r.log, /notification_finish\(9, false, 'smtp: connection refused'\)/);
});

test("an address that could inject mail headers is refused without sending", () => {
  const r = run({ claims: "10\tplan_delivered\tparent@example.test>,evil@x.test\n11\tplan_delivered\tok@example.test\n" });
  assert.match(r.log, /notification_finish\(10, false, 'recipient address is not usable'\)/);
  assert.equal((r.log.match(/^CURL /gm) ?? []).length, 1, "only the valid address is mailed");
});

test("no waiting notices means no email and a clean run", () => {
  const r = run({ claims: "" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /notices sent: 0, failed: 0/);
  assert.doesNotMatch(r.log, /^CURL /m);
});
