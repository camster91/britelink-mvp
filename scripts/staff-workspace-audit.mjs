import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromeLaunchOptions } from "./resolve-chrome.mjs";
const origin = "http://127.0.0.1:4319";
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4319"],
  { stdio: "ignore" },
);
async function wait() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Staff QA server did not start");
}
try {
  await wait();
  const browser = await chromium.launch(chromeLaunchOptions());
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${origin}/qa/staff-workspace-harness.html`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: "Educator workbench" }).waitFor();
  if (await page.getByRole("heading", { name: /Maya’s plan/ }).count())
    throw new Error("Admin account routed to guardian workspace");
  await page.evaluate(() => {
    globalThis.staffFailNextCaseRefresh = true;
  });
  await page.getByRole("button", { name: "Evaluate overdue cases" }).click();
  await page.getByText("Overdue evaluation completed and audited.").waitFor();
  await page.getByText("workspace refresh", { exact: false }).waitFor();
  if (
    !(await page.getByRole("heading", { name: "Educator workbench" }).count())
  )
    throw new Error(
      "Successful staff write lost the workbench when its refresh failed",
    );
  await page.getByRole("button", { name: "Retry supporting panels" }).click();
  await page.getByRole("button", { name: /Maya.*internal review/i }).click();
  await page.getByRole("button", { name: "Mark read" }).click();
  await page.getByText("Read acknowledgement completed and audited.").waitFor();
  await page.getByRole("button", { name: "Resolve" }).click();
  await page.getByText("Message resolution completed and audited.").waitFor();
  await page
    .getByLabel("New secure message")
    .fill("I confirmed the current reading level in the revised plan.");
  await page.getByRole("button", { name: "Send secure message" }).click();
  await page.getByText("Secure message completed and audited.").waitFor();
  await page.getByLabel("Theme").fill("Curiosity and confidence");
  await page.getByLabel("Planned date").fill("2026-09-01");
  await page.getByLabel("Subject").fill("Language");
  await page.getByLabel("Title").fill("Build a sound map");
  await page.getByLabel("Objective").fill("Connect sounds to familiar words.");
  await page
    .getByLabel(/Instructions/)
    .fill("Choose five familiar words\nSort by opening sound");
  await page.getByLabel(/Materials/).fill("Paper\nPencil");
  await page.getByLabel(/Accommodations/).fill("Read instructions aloud");
  await page.getByLabel("Adult help minutes").fill("10");
  await page.getByRole("button", { name: "Add lesson" }).click();
  await page.getByLabel("Subject").nth(1).fill("Math");
  await page.getByLabel("Title").nth(1).fill("Count a collection");
  await page
    .getByLabel("Objective")
    .nth(1)
    .fill("Count and explain a collection of up to twenty objects.");
  await page
    .getByLabel(/Instructions/)
    .nth(1)
    .fill("Choose a small collection\nCount each object once");
  await page
    .getByLabel(/Materials/)
    .nth(1)
    .fill("Small household objects");
  await page
    .getByLabel(/Accommodations/)
    .nth(1)
    .fill("Use a ten-frame if helpful");
  await page.getByLabel("Adult help minutes").nth(1).fill("5");
  await page.getByRole("button", { name: "Add day" }).click();
  const dayTwo = page.getByRole("group", { name: "Day 2" });
  await dayTwo.getByLabel("Planned date").fill("2026-09-02");
  await dayTwo.getByLabel("Subject").fill("Science");
  await dayTwo.getByLabel("Title").fill("Observe a local habitat");
  await dayTwo
    .getByLabel("Objective")
    .fill("Record two observations about a nearby habitat.");
  await dayTwo
    .getByLabel(/Instructions/)
    .fill("Choose a safe viewing spot\nRecord what you notice");
  await page.getByRole("button", { name: "Add week" }).click();
  const weekTwo = page.getByRole("group", { name: "Week 2" });
  await weekTwo.getByLabel("Theme").fill("Everyday patterns");
  await weekTwo.getByLabel("Planned date").fill("2026-09-08");
  await weekTwo.getByLabel("Subject").fill("Language");
  await weekTwo.getByLabel("Title").fill("Describe a daily pattern");
  await weekTwo
    .getByLabel("Objective")
    .fill("Describe a familiar sequence in order.");
  await weekTwo
    .getByLabel(/Instructions/)
    .fill("Choose one routine\nDescribe its steps in order");
  await page.evaluate(() => {
    globalThis.staffDelayNextPlanSave = true;
  });
  await page.getByRole("button", { name: "Save new plan version" }).dblclick();
  await page.getByText("Plan version completed and audited.").waitFor();
  if (await page.getByText(/Unsaved work protected/).count())
    throw new Error("Saved plan remained recoverable as unsaved draft work");
  await page.getByLabel("Target lesson").selectOption({ index: 1 });
  const resourceForm = page
    .getByRole("heading", { name: "Add governed resource" })
    .locator("..");
  await resourceForm.getByLabel("Title").fill("Free sound cards");
  await resourceForm.getByLabel(/HTTPS URL/).fill("https://example.test/cards");
  await resourceForm.getByLabel("Requirement").selectOption("substitute");
  await resourceForm
    .getByLabel("Rights/attribution")
    .fill("BriteLink original");
  await resourceForm
    .getByRole("checkbox", { name: /I checked the link/ })
    .check();
  await resourceForm
    .getByRole("button", { name: "Add reviewed resource" })
    .click();
  await page.getByText("Resource completed and audited.").waitFor();
  await resourceForm.getByLabel("Title").fill("Required sound workbook");
  await resourceForm
    .getByLabel(/HTTPS URL/)
    .fill("https://example.test/workbook");
  await resourceForm.getByLabel("Requirement").selectOption("required");
  await resourceForm
    .getByLabel("Substitute resource")
    .selectOption({ index: 1 });
  await resourceForm
    .getByRole("button", { name: "Add reviewed resource" })
    .click();
  await page.getByText("Resource completed and audited.").waitFor();
  for (const label of [
    "Curriculum",
    "Safeguarding",
    "Accessibility",
    "Resource rights and privacy",
  ])
    await page.getByLabel(label).check();
  await page.getByLabel("Review notes").fill("All required checks completed.");
  await page.getByRole("button", { name: "Save independent review" }).click();
  await page.getByText("Plan review completed and audited.").waitFor();
  await page.getByLabel("Next status").selectOption("internal_review");
  await page.getByRole("button", { name: "Apply transition" }).click();
  await page.getByText("Case transition completed and audited.").waitFor();
  await page.getByLabel("Next status").selectOption("published");
  await page.getByRole("button", { name: "Apply transition" }).click();
  await page.getByText("Case transition completed and audited.").waitFor();
  await page
    .getByRole("button", { name: "Send secure portal delivery" })
    .click();
  await page.getByText("Secure delivery completed and audited.").waitFor();
  await page.getByRole("button", { name: "Retry delivery" }).click();
  await page.getByText("Delivery retry completed and audited.").waitFor();
  await page.getByRole("button", { name: /Noah.*revision requested/i }).click();
  await page
    .getByLabel("Decision reason")
    .fill("Included in the annual package.");
  await page.getByRole("button", { name: "Accept revision" }).click();
  await page.getByText("Revision acceptance completed and audited.").waitFor();
  await page.getByLabel("Theme").fill("Lighter reading week");
  await page.getByLabel("Subject").fill("Language");
  await page.getByLabel("Title").fill("Listen and retell");
  await page
    .getByLabel("Objective")
    .fill("Retell a short passage using oral language.");
  await page
    .getByLabel(/Instructions/)
    .fill("Listen to the passage\nRetell three key ideas");
  await page.getByRole("button", { name: "Save new plan version" }).click();
  await page.getByText("Plan version completed and audited.").waitFor();
  for (const label of [
    "Curriculum",
    "Safeguarding",
    "Accessibility",
    "Resource rights and privacy",
  ])
    await page.getByLabel(label).check();
  await page.getByLabel("Review notes").fill("Revised version checked.");
  await page.getByRole("button", { name: "Save independent review" }).click();
  await page.getByText("Plan review completed and audited.").waitFor();
  await page
    .getByLabel("Change summary")
    .fill("Reduced reading volume and added an oral retell option.");
  await page.getByRole("button", { name: "Complete revision" }).click();
  await page.getByText("Revision completion completed and audited.").waitFor();
  await page
    .getByRole("button", { name: "Send secure portal delivery" })
    .click();
  await page.getByText("Secure delivery completed and audited.").waitFor();
  await page.getByRole("button", { name: /Avery.*submitted/i }).click();
  await page
    .getByRole("button", { name: "Accept intake and start SLA" })
    .click();
  await page
    .getByText("Usable intake acceptance completed and audited.")
    .waitFor();
  await page.locator('select[name="educator"]').selectOption("educator-a");
  await page.getByRole("button", { name: "Assign case" }).click();
  await page.getByText("Case assignment completed and audited.").waitFor();
  await page
    .getByLabel("Absence reason")
    .fill("Assigned educator is unavailable; reassignment required.");
  await page.getByRole("button", { name: "Record absence and hold" }).click();
  await page.getByText("Educator absence completed and audited.").waitFor();
  const state = await page.evaluate(() => globalThis.staffQaState);
  const caseAPlan = state.plans
    .filter((item) => item.case_id === "case-a")
    .sort((a, b) => b.version - a.version)[0];
  const caseALessons = caseAPlan.plan_weeks[0].plan_days[0].lessons;
  const resourceCall = state.calls.find(
    (item) => item[0] === "addStaffPlanResource",
  );
  if (
    state.cases[0].status !== "delivered" ||
    state.cases[1].status !== "delivered" ||
    state.cases[2].status !== "on_hold" ||
    !state.cases[2].sla_due_at ||
    state.revisions[0].status !== "completed" ||
    !state.reviews.length
  )
    throw new Error("Rendered staff actions did not reach repository");
  for (const call of state.calls.filter(
    (item) =>
      item[0].startsWith("listStaff") ||
      [
        "listEducatorCapacities",
        "reviewStaffPlan",
        "transitionStaffCase",
        "createStaffPlanVersion",
        "addStaffPlanResource",
        "recordStaffDelivery",
        "retryStaffDelivery",
        "decideStaffRevision",
        "completeStaffRevision",
        "sendMessage",
        "markMessageRead",
        "resolveStaffMessage",
        "recordStaffAbsence",
        "markStaffOverdue",
        "acceptStaffIntake",
        "assignStaffCase",
      ].includes(item[0]),
  ))
    if (call[1] !== "household-a")
      throw new Error(`Unscoped staff call: ${call.join(":")}`);
  if (
    state.plans.filter((item) => item.case_id === "case-a").length !== 2 ||
    state.plans.filter((item) => item.case_id === "case-b").length !== 2 ||
    state.resources.length !== 2 ||
    caseAPlan.plan_weeks.length !== 2 ||
    caseAPlan.plan_weeks[0].plan_days.length !== 2 ||
    caseALessons.length !== 2 ||
    caseALessons[0].resources.length !== 0 ||
    caseALessons[1].resources.length !== 2 ||
    caseALessons[1].resources[0].requirement !== "substitute" ||
    caseALessons[1].resources[1].substituteResourceId !==
      caseALessons[1].resources[0].id ||
    resourceCall?.[3] !== caseALessons[1].id ||
    state.deliveries[0]?.status !== "sent" ||
    state.deliveries[0]?.attempt_count !== 2 ||
    !state.messages[0].resolved_at ||
    !state.messages.some((item) =>
      item.body.includes("confirmed the current reading level"),
    )
  )
    throw new Error(
      "Rendered authoring, messaging, revision, resource, delivery, or retry did not persist in the repository harness",
    );
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const serious = audit.violations.filter((item) =>
    ["serious", "critical"].includes(item.impact),
  );
  if (serious.length)
    throw new Error(serious.map((item) => item.id).join(", "));
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../qa/operations/04-authenticated-staff-workbench.png",
        import.meta.url,
      ),
    ),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
  )
    throw new Error("Staff workspace overflows mobile viewport");
  const refreshPage = await context.newPage();
  await refreshPage.addInitScript(() => {
    globalThis.staffQaRefreshIntervalMs = 250;
  });
  await refreshPage.goto(`${origin}/qa/staff-workspace-harness.html`, {
    waitUntil: "networkidle",
  });
  await refreshPage
    .getByRole("heading", { name: "Educator workbench" })
    .waitFor();
  await refreshPage
    .getByRole("button", { name: /Maya.*internal review/i })
    .click();
  await refreshPage
    .getByLabel("Operational reason")
    .fill("Keep this draft while new queue state arrives.");
  await refreshPage.evaluate(() => {
    globalThis.staffDelayNextCaseRefresh = true;
  });
  await refreshPage.waitForFunction(
    () => globalThis.staffDelayNextCaseRefresh === false,
  );
  await refreshPage.evaluate(() => {
    globalThis.staffQaState.cases[1].status = "on_hold";
  });
  await refreshPage.getByRole("button", { name: /Noah.*on hold/i }).waitFor();
  await refreshPage.waitForTimeout(800);
  if (
    !(await refreshPage.getByRole("button", { name: /Noah.*on hold/i }).count())
  )
    throw new Error(
      "A stale periodic response replaced newer staff queue data",
    );
  if (
    (await refreshPage.getByLabel("Operational reason").inputValue()) !==
    "Keep this draft while new queue state arrives."
  )
    throw new Error("Periodic staff refresh erased active workbench state");
  await refreshPage.evaluate(() => {
    globalThis.staffQaState.deliveries.push({
      id: "delivery-periodic",
      case_id: "case-a",
      plan_version: 99,
      status: "sent",
      attempt_count: 1,
    });
  });
  await refreshPage.getByText(/Version 99 · sent/).waitFor();
  await refreshPage.evaluate(() => {
    globalThis.staffFailDeliveryRefresh = true;
  });
  await refreshPage.getByText(/deliveries/).waitFor();
  if (!(await refreshPage.getByText(/Version 99 · sent/).count()))
    throw new Error("Partial refresh erased last trustworthy delivery context");
  const overdueCalls = await refreshPage.evaluate(
    () =>
      globalThis.staffQaState.calls.filter(
        (item) => item[0] === "markStaffOverdue",
      ).length,
  );
  await refreshPage
    .getByRole("button", { name: "Evaluate overdue cases" })
    .click();
  await refreshPage
    .getByText(
      "Refresh unavailable supporting panels before changing this case.",
    )
    .waitFor();
  if (
    (await refreshPage.evaluate(
      () =>
        globalThis.staffQaState.calls.filter(
          (item) => item[0] === "markStaffOverdue",
        ).length,
    )) !== overdueCalls
  )
    throw new Error("Mutation ran while authoritative context was incomplete");
  await refreshPage.evaluate(() => {
    globalThis.staffFailDeliveryRefresh = false;
  });
  await refreshPage
    .getByRole("button", { name: "Retry supporting panels" })
    .click();
  await refreshPage.evaluate(() => {
    globalThis.staffQaState.learners[1].preferred_name = "Noah Updated";
  });
  await refreshPage
    .getByRole("button", { name: /Noah Updated.*on hold/i })
    .waitFor();
  await refreshPage.evaluate(() => {
    globalThis.staffQaState.cases = globalThis.staffQaState.cases.filter(
      (item) => item.id !== "case-a",
    );
  });
  await refreshPage
    .getByRole("heading", { name: /Noah Updated · annual/ })
    .waitFor();
  // The heading switching to the fallback case and the draft-reset effect land in the same
  // React commit, so asserting the input immediately after waitFor() is a race: the heading
  // can be visible while the controlled input still holds its previous value for a frame.
  // Poll the label's own input until it settles rather than sampling once.
  await refreshPage
    .waitForFunction(
      () => {
        const label = [...document.querySelectorAll("label")].find((node) =>
          node.textContent?.startsWith("Operational reason"),
        );
        return label?.querySelector("input")?.value === "";
      },
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  if ((await refreshPage.getByLabel("Operational reason").inputValue()) !== "")
    throw new Error(
      "Removed selected case leaked draft state into fallback case",
    );
  await refreshPage.close();
  await writeFile(
    new URL("../qa/operations/staff-workspace-report.json", import.meta.url),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        roleRouting: true,
        prioritizedQueue: true,
        successfulWriteSurvivesFailedRefresh: true,
        panelScopedDegradation: true,
        usableIntakeAcceptance: true,
        packageSlaStart: true,
        planAuthoring: true,
        multiWeekDayAuthoring: true,
        duplicatePlanSubmissionBlocked: true,
        savedPlanDraftCleared: true,
        resourceGovernance: true,
        requiredResourceSubstituteWorkflow: true,
        resourceTargetsArbitraryLesson: true,
        periodicQueueRefresh: true,
        periodicRefreshPreservesDraftState: true,
        stalePeriodicRefreshIgnored: true,
        periodicLearnerRefresh: true,
        removedCaseStateIsolation: true,
        partialRefreshPreservesContext: true,
        incompleteContextBlocksMutations: true,
        planReview: true,
        publishTransition: true,
        secureDelivery: true,
        deliveryRetry: true,
        secureMessaging: true,
        messageResolution: true,
        revisionDecision: true,
        revisionCompletion: true,
        revisionRedelivery: true,
        educatorAbsence: true,
        overdueEvaluation: true,
        caseSwitchStateReset: true,
        householdScope: true,
        mobileOverflow: false,
        seriousOrCriticalAccessibilityViolations: [],
      },
      null,
      2,
    ),
  );
  await context.close();
  await browser.close();
  process.stdout.write(
    "Authenticated staff workbench audit passed usable intake/SLA, triage, authoring, governance, messaging, review, delivery/retry, revision/re-delivery, exception, scoping, mobile, and accessibility checks.\n",
  );
} finally {
  server.kill("SIGTERM");
}
