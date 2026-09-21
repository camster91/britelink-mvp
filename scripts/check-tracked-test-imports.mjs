#!/usr/bin/env node
// Fail when a TRACKED test file imports a module that is NOT tracked by git.
//
// WHY THIS EXISTS
//   This repository shipped a broken `main` three times for the same reason: the fix for a
//   behaviour lived in a source file that was never committed, while a tracked test asserted
//   the fixed behaviour. Locally the suite passed because the working tree had the file. On a
//   clean checkout the import resolved to an older committed version (or failed outright) and
//   the tests went red -- or worse, went green against stale code.
//
//   A blanket "fail CI when the tree is dirty" check was rejected as too noisy: normal work
//   has uncommitted edits. This check is narrower and has almost no false positives --
//   it only fires when a *committed* test depends on a file that would not exist in a clean
//   checkout of the same commit.
//
// WHAT IT CHECKS
//   For every tracked *.test.mjs under tests/, resolve its relative imports (./ and ../ only;
//   package imports are covered by `npm ci`). If an import resolves to a file inside the repo
//   that git does not track, fail and name the test and the missing file.
//
// WHAT IT DOES NOT DO
//   It does not check product source importing product source. A stale committed module that
//   still parses is a test-coverage question, not a provenance one, and this stays precise.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

let tracked;
try {
  tracked = new Set(git(["ls-files", "-z"]).split("\u0000").filter(Boolean));
} catch (error) {
  console.error("Cannot list tracked files (is this a git checkout?): " + error.message);
  process.exit(2);
}

const trackedTests = [...tracked]
  .filter((file) => file.startsWith("tests/") && file.endsWith(".test.mjs"))
  .sort();

if (trackedTests.length === 0) {
  console.error("No tracked tests/*.test.mjs found -- refusing to report success on an empty set.");
  process.exit(2);
}

// Static import/export-from specifiers, plus dynamic import() with a literal string.
const SPECIFIER_PATTERNS = [
  /\bimport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const failures = [];
let checked = 0;

for (const testFile of trackedTests) {
  const absolute = path.join(root, testFile);
  if (!existsSync(absolute)) {
    failures.push({ test: testFile, missing: testFile, reason: "tracked test file is absent from the working tree" });
    continue;
  }
  const source = readFileSync(absolute, "utf8");
  const specifiers = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith("./") || specifier.startsWith("../")) specifiers.add(specifier);
    }
  }
  for (const specifier of specifiers) {
    checked += 1;
    const resolved = path.resolve(path.dirname(absolute), specifier);
    const rel = path.relative(root, resolved);
    if (rel.startsWith("..")) continue; // outside the repo; not our concern
    if (tracked.has(rel)) continue;
    // A directory import (./something -> ./something/index.mjs) is unusual here; report the
    // untracked path itself, which is the actionable fact either way.
    failures.push({ test: testFile, missing: rel, reason: "imports a file git does not track" });
  }
}

console.log("Checked " + checked + " relative import(s) across " + trackedTests.length + " tracked test file(s).");

if (failures.length > 0) {
  console.error("");
  console.error("FAIL: a tracked test depends on a file that is not committed.");
  console.error("A clean checkout of this commit cannot run these tests.");
  console.error("");
  for (const failure of failures) {
    console.error("  " + failure.test + "  ->  " + failure.missing + "  (" + failure.reason + ")");
  }
  console.error("");
  console.error("Fix: commit the missing file(s), or remove the dependency from the test.");
  process.exit(1);
}

console.log("OK: every relative import from a tracked test resolves to a tracked file.");
