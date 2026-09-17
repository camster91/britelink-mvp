import { existsSync } from "node:fs";
import path from "node:path";

// Playwright audits prefer a system Chrome when present. Paths differ by OS,
// so resolve at runtime instead of hardcoding macOS. If nothing is installed,
// omit executablePath and let Playwright use its bundled Chromium.
const CHROME_CANDIDATES = [
  process.env.BRITELINK_CHROME_PATH,
  process.env.PLAYWRIGHT_CHROME_PATH,
  process.platform === "win32" && process.env.PROGRAMFILES
    ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
    : null,
  process.platform === "win32" && process.env["PROGRAMFILES(X86)"]
    ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
    : null,
  process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
    : null,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome",
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((candidate) => typeof candidate === "string" && candidate.trim());

export function resolveChromeExecutablePath() {
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

export function chromeLaunchOptions() {
  const executablePath = resolveChromeExecutablePath();
  return executablePath ? { headless: true, executablePath } : { headless: true };
}
