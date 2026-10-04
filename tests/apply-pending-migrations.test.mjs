// scripts/apply-pending-migrations.sh must refuse to run when a migration file exists that it does
// not know how to detect; otherwise a new file would be skipped while it reports "Up to date".
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sandbox(extraFile) {
  const dir = mkdtempSync(path.join(tmpdir(), "apply-migrations-"));
  mkdirSync(path.join(dir, "scripts"));
  mkdirSync(path.join(dir, "supabase", "migrations"), { recursive: true });
  mkdirSync(path.join(dir, "bin"));
  copyFileSync(path.join(root, "scripts", "apply-pending-migrations.sh"), path.join(dir, "scripts", "apply-pending-migrations.sh"));
  for (const file of readdirSync(path.join(root, "supabase", "migrations")))
    writeFileSync(path.join(dir, "supabase", "migrations", file), "-- placeholder\n");
  if (extraFile) writeFileSync(path.join(dir, "supabase", "migrations", extraFile), "-- new\n");
  // A docker stand-in that always fails: the registration check must decide before any database call.
  writeFileSync(path.join(dir, "bin", "docker"), "#!/bin/sh\necho 'docker stub reached' >&2\nexit 1\n");
  chmodSync(path.join(dir, "bin", "docker"), 0o755);
  return spawnSync("bash", [path.join(dir, "scripts", "apply-pending-migrations.sh")], {
    env: { ...process.env, DB_CONTAINER: "stub", PATH: `${path.join(dir, "bin")}:${process.env.PATH}` },
    encoding: "utf8",
  });
}

test("every migration in the repo is registered with the apply script", () => {
  const run = sandbox();
  assert.doesNotMatch(run.stderr, /not registered/);
  assert.match(run.stderr, /docker stub reached/, "with everything registered it goes on to the database");
});

test("an unregistered migration stops the script before it touches the database", () => {
  const run = sandbox("202608280999_unregistered.sql");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /202608280999_unregistered\.sql is not registered/);
  assert.doesNotMatch(run.stderr, /docker stub reached/);
});
