import assert from "node:assert/strict";
import test from "node:test";
import { chromeLaunchOptions, resolveChromeExecutablePath } from "../scripts/resolve-chrome.mjs";

test("chrome launch options always run headless and only pin a path that exists", () => {
  const options = chromeLaunchOptions();
  assert.equal(options.headless, true);
  const resolved = resolveChromeExecutablePath();
  if (resolved) {
    assert.equal(options.executablePath, resolved);
  } else {
    assert.equal("executablePath" in options, false);
  }
});
