#!/usr/bin/env node
// Emit dist/client/version.json so a single HTTP request reports the live revision.
//
// WHY
//   Before this, the only way to learn which commit production was running was to SSH to
//   the VPS and run `git rev-parse HEAD`. That is not evidence a guardian, an auditor, or a
//   monitoring probe can read. RELEASE_READINESS.md recorded the deployed revision as
//   "not tied to a commit" for exactly that reason.
//
// WHAT IT CONTAINS
//   The commit SHA, the short form, and the build timestamp. Nothing else. A commit SHA is
//   not a secret: it is already public in the GitHub repository, and knowing it confers no
//   access. There is deliberately no branch name, no author, no environment, and no
//   dependency inventory here -- those leak more than they inform.
//
// WHERE THE SHA COMES FROM
//   BRITELINK_BUILD_COMMIT, set as a docker build arg by the deploy pipeline. When it is
//   absent -- a local build, a test run, a fork -- the value is the literal "unknown" rather
//   than an attempt to guess from the local git checkout. A guessed SHA would be worse than
//   no SHA: it would claim provenance the artifact does not have.
//
// The file lands in dist/client/, which the Dockerfile copies to the nginx web root, so it
// is served at /version.json alongside the app.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", "client");

if (!existsSync(path.join(dist, "index.html"))) {
  throw new Error("Missing build output: " + path.join(dist, "index.html") + " (run after vite build)");
}

const raw = String(process.env.BRITELINK_BUILD_COMMIT ?? "").trim();
if (raw && !/^[0-9a-f]{40}$/.test(raw)) {
  // Fail loudly rather than ship a plausible-looking wrong value. A malformed SHA means the
  // pipeline is passing something it should not, and a build stamp that lies is worse than none.
  throw new Error("BRITELINK_BUILD_COMMIT is not a full 40-hex commit SHA: " + JSON.stringify(raw));
}
const commit = raw || "unknown";

mkdirSync(dist, { recursive: true });
writeFileSync(
  path.join(dist, "version.json"),
  JSON.stringify(
    {
      commit,
      commitShort: commit === "unknown" ? "unknown" : commit.slice(0, 12),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log("Wrote dist/client/version.json: commit=" + commit);
