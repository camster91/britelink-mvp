// End-to-end journeys against deployed VPS staging with real Auth (#39).
//
// Every other browser audit drives a mocked harness. This one drives the deployed staging app with
// the synthetic staging seed's own accounts (supabase/seed/synthetic-staging.sql), signed in through
// real magic links minted with the staging service key -- the same path a family uses, without an
// inbox. It proves what the harness cannot: that a write survives a reload and is visible from a
// second device (and so does a completed lesson), that a calendar link works for a signed-out calendar app and dies when turned off,
// and that staff land in their workbench.
//
// It writes only synthetic rows and cleans up after itself. stagingJourneyConfig refuses to run
// unless BRITELINK_TEST_ENVIRONMENT=staging and neither URL is a production host.
//
// Usage: npm run test:staging-journeys   (needs the env below; see docs/STAGING_HANDOFF.md)
//   BRITELINK_TEST_ENVIRONMENT=staging
//   BRITELINK_STAGING_APP_URL=https://<staging app host>
//   BRITELINK_SUPABASE_URL=https://<staging api host>
//   BRITELINK_STAGING_SERVICE_ROLE_KEY=<staging only; never production>
//   BRITELINK_TEST_GUARDIAN_A_USER_ID / BRITELINK_TEST_EDUCATOR_A_USER_ID / BRITELINK_TEST_HOUSEHOLD_A_ID (from the seed)
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromeLaunchOptions } from "./resolve-chrome.mjs";
import { stagingJourneyConfig } from "./staging-journey-config.mjs";

const config = stagingJourneyConfig();
const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const steps = [];
// Diagnostics are limited to the disposable saved-image fixture. Never inspect
// an operator's staging page, cookies, auth storage values, or application rows.
const ciDiagnostics = process.env.GITHUB_ACTIONS === "true" &&
  process.env.BRITELINK_CHECKED_BUILD_MODE === "qa-configured" &&
  config.appUrl === "http://127.0.0.1:8099" && config.supabaseUrl === config.appUrl;
const diagnosticPages = [];
const safeText = value => String(value).replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,"[REDACTED_JWT]").replace(/([?&#](?:access_token|refresh_token|token|token_hash)=)[^&\s"']+/g,"$1[REDACTED]").replace(/[a-f0-9]{32,}/g,"[REDACTED]").slice(0,600);
const safeLocation = value => { try { const url = new URL(value); return safeText(url.origin+url.pathname); } catch { return "invalid-url"; } };
const step = async (name, run) => {
  const started = Date.now();
  try {
    await run();
    steps.push({ name, ok: true, ms: Date.now() - started });
  } catch (error) {
    steps.push({ name, ok: false, ms: Date.now() - started, error: error.message });
    if (ciDiagnostics) {
      for (const {page,events} of diagnosticPages) {
        const ui = await page.evaluate(() => ({title:document.title,heading:document.querySelector('h1')?.textContent,bootFallback:!!document.querySelector('.boot-fallback'),alerts:[...document.querySelectorAll('[role="alert"],.boot-fallback p')].map(e=>e.textContent)})).catch(()=>({unavailable:true}));
        console.log('Disposable CI browser diagnostics: '+JSON.stringify({location:safeLocation(page.url()),ui:{...ui,heading:safeText(ui.heading??''),alerts:ui.alerts?.map(safeText)},events}));
      }
    }
    throw error;
  }
};

async function signInLink(userId) {
  const { data: user, error } = await admin.auth.admin.getUserById(userId);
  if (error || !user?.user?.email) throw new Error(`staging user ${userId} not found: ${error?.message ?? "no email"}`);
  const { data, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user.email, options: { redirectTo: config.appUrl } });
  if (linkError || !data?.properties?.action_link) throw new Error(`could not mint a sign-in link: ${linkError?.message ?? "no link"}`);
  return data.properties.action_link;
}

async function signedInPage(browser, userId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  if (ciDiagnostics) {
    const events=[]; diagnosticPages.push({page,events});
    const record=event=>{if(events.length<40)events.push(event);};
    page.on('pageerror',error=>record({kind:'script-error',message:safeText(error.message)}));
    page.on('requestfailed',request=>record({kind:'request-failed',url:safeLocation(request.url()),reason:safeText(request.failure()?.errorText)}));
    page.on('response',response=>{if(response.status()>=400)record({kind:'http-error',url:safeLocation(response.url()),status:response.status()});});
  }
  await page.goto(await signInLink(userId), { waitUntil: "networkidle" });
  return { context, page };
}

const marker = `SYNTHETIC staging journey ${new Date().toISOString()}`;
const browser = await chromium.launch(chromeLaunchOptions());
let exitCode = 0;
try {
  const deviceOne = await signedInPage(browser, config.guardianUserId);
  await step("guardian signs in through a real magic link and lands in the household workspace", async () => {
    await deviceOne.page.getByText("Household workspace").waitFor({ timeout: 20000 });
  });
  await step("guardian records learning outside the plan", async () => {
    const card = deviceOne.page.locator("section.learning-captures");
    await card.getByLabel("What kind").selectOption("note");
    await card.getByLabel("What happened").fill(marker);
    await card.getByRole("button", { name: "Save to the record" }).click();
    await card.getByText("Saved to", { exact: false }).waitFor();
  });
  await step("the note shows in this week's story", async () => {
    await deviceOne.page.locator("section.weekly-story").getByText(marker, { exact: false }).waitFor();
  });
  await step("the note survives a reload", async () => {
    await deviceOne.page.reload({ waitUntil: "networkidle" });
    await deviceOne.page.locator("section.learning-captures").getByText(marker).waitFor({ timeout: 20000 });
  });
  // #42: completing a lesson is durable. The seed's one lesson for learner A starts not_started;
  // the second device resets it, so the journey leaves the fixture as it found it.
  await step("guardian completes a lesson and gets the calm confirmation", async () => {
    await deviceOne.page.getByLabel("Status").selectOption("completed");
    await deviceOne.page.getByRole("button", { name: "Save lesson activity" }).click();
    await deviceOne.page.locator(".lesson-complete").getByText("is done.", { exact: false }).waitFor();
  });
  await step("the completion survives a reload", async () => {
    await deviceOne.page.reload({ waitUntil: "networkidle" });
    const status = deviceOne.page.getByLabel("Status");
    await status.waitFor({ timeout: 20000 });
    if ((await status.inputValue()) !== "completed") throw new Error(`after reload the lesson reads ${await status.inputValue()}`);
  });
  await step("a calendar link serves the family calendar to a signed-out client, and stops when turned off", async () => {
    const panel = deviceOne.page.locator("details.calendar-feed");
    await panel.getByText("Keep my calendar app up to date").click();
    await panel.getByRole("button", { name: /Create calendar link|Replace link/ }).click();
    const url = await panel.getByLabel("Your calendar link").inputValue();
    const live = await fetch(url);
    const body = await live.text();
    if (live.status !== 200 || !/^text\/calendar/.test(live.headers.get("content-type") ?? "") || !body.startsWith("BEGIN:VCALENDAR"))
      throw new Error(`feed did not serve a calendar: ${live.status} ${live.headers.get("content-type")} ${body.slice(0, 80)}`);
    if (/SYNTHETIC Learner/.test(body)) throw new Error("the feed names the child");
    await panel.getByRole("button", { name: "Turn off link" }).click();
    await panel.getByText("Calendar link turned off.", { exact: false }).waitFor();
    const gone = await fetch(url);
    if (gone.status !== 404) throw new Error(`a turned-off feed still answers ${gone.status}`);
  });
  const deviceTwo = await signedInPage(browser, config.guardianUserId);
  await step("a second device sees the completed lesson, then resets it (cleanup)", async () => {
    const status = deviceTwo.page.getByLabel("Status");
    await status.waitFor({ timeout: 20000 });
    if ((await status.inputValue()) !== "completed") throw new Error(`the second device reads ${await status.inputValue()}`);
    await status.selectOption("not_started");
    await deviceTwo.page.getByRole("button", { name: "Save lesson activity" }).click();
    await deviceTwo.page.getByText("Lesson activity saved securely.").waitFor();
  });
  await step("a second device sees the same note, then removes it (cleanup)", async () => {
    const card = deviceTwo.page.locator("section.learning-captures");
    await card.getByText(marker).waitFor({ timeout: 20000 });
    await card.getByRole("listitem").filter({ hasText: marker }).getByRole("button", { name: /Remove the note/ }).click();
    await card.getByText("Removed from the learning record.").waitFor();
  });
  await deviceOne.context.close();
  await deviceTwo.context.close();

  const educator = await signedInPage(browser, config.educatorUserId);
  await step("educator signs in and lands in the educator workbench", async () => {
    await educator.page.getByRole("heading", { name: "Educator workbench" }).waitFor({ timeout: 20000 });
  });
  await educator.context.close();
} catch {
  exitCode = 1;
} finally {
  await browser.close();
  const report = { ranAt: new Date().toISOString(), appUrl: config.appUrl, passed: steps.every((item) => item.ok) && exitCode === 0, steps };
  await mkdir(new URL("../qa/staging/", import.meta.url), { recursive: true });
  await writeFile(fileURLToPath(new URL("../qa/staging/journey-report.json", import.meta.url)), `${JSON.stringify(report, null, 2)}\n`);
  for (const item of steps) console.log(`${item.ok ? "ok  " : "FAIL"} ${item.name}${item.error ? ` -- ${item.error}` : ""}`);
  console.log(report.passed ? "Staging journeys passed." : "Staging journeys FAILED.");
  process.exitCode = report.passed ? 0 : 1;
}
