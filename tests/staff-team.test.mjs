// scripts/staff-team.sh against a stand-in for docker (the database container): what it asks the
// database, and that it never prints a full email address (the repository's Actions logs are public).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(args, { reply = "", fails = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "staff-"));
  const log = path.join(dir, "log");
  writeFileSync(path.join(dir, "docker"), `#!/bin/bash
echo "ARGS $*" >> "${log}"
[ -t 0 ] || { stdin="$(cat)"; [ -n "$stdin" ] && echo "STDIN $stdin" >> "${log}"; }
${fails ? 'echo "ERROR:  they still hold open cases: reassign those first" >&2; exit 3' : `printf '%b' '${reply}'`}
`);
  chmodSync(path.join(dir, "docker"), 0o755);
  const result = spawnSync("bash", [path.join(root, "scripts", "staff-team.sh"), ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: "utf8",
    input: "",
  });
  return { ...result, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

test("add passes the email to psql as a quoted variable and reports a masked address", () => {
  const r = run(["add", "jane.doe@example.test", "educator", "6"], { reply: "3\\n" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /-v email=jane\.doe@example\.test/);
  assert.match(r.log, /STDIN select public\.staff_team_add\(:'email', :'role', :'lim'::integer\);/);
  assert.equal(r.stdout.trim(), "Added j***@example.test as educator; shared 3 existing families with them.");
});

test("list masks every address", () => {
  const r = run(["list"], { reply: "jane.doe@example.test\\teducator\\t10\\t4\\nsam@example.test\\tadmin\\t10\\t4\\n" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /j\*\*\*@example\.test\teducator\t10\t4/);
  assert.match(r.stdout, /s\*\*\*@example\.test\tadmin/);
  assert.doesNotMatch(r.stdout, /jane\.doe|sam@/);
});

test("a refusal from the database fails the run without echoing the address", () => {
  const r = run(["remove", "jane.doe@example.test"], { fails: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /reassign those first/);
  assert.doesNotMatch(r.stdout + r.stderr, /jane\.doe/);
});

test("bad input never reaches the database", () => {
  for (const args of [
    ["add", "not-an-email", "educator"],
    ["add", "x@example.test'; drop table x; --", "educator"],
    ["add", "x@example.test", "guardian"],
    ["add", "x@example.test", "educator", "500"],
    ["remove", ""],
    ["wipe"],
  ]) {
    const r = run(args);
    assert.notEqual(r.status, 0, args.join(" "));
    assert.equal(r.log, "", `${args.join(" ")} must not call docker`);
  }
});
