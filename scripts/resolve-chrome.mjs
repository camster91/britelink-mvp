import { existsSync } from "node:fs";

// Playwright audits drive a system Google Chrome via executablePath. The path
// differs per OS, so resolve it at runtime instead of hardcoding one platform.
// Order: explicit override, then the first Chrome that exists on disk (macOS
// first to preserve prior behavior), falling back to the macOS default.
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome",
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function resolveChromeExecutablePath() {
  const override = process.env.BRITELINK_CHROME_PATH?.trim();
  if (override) return override;
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? CHROME_CANDIDATES[0];
}
