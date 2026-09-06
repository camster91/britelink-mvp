# BriteLink Manual Accessibility QA

Status: required before private beta. Automated axe, keyboard-focus, reduced-motion, contrast, and responsive reflow checks do not replace this protocol.

## Test setup

- Use the production build in current desktop Chrome on macOS at a 1280 x 800 or larger window.
- Use only fictional data and the synthetic parent and educator harnesses.
- Record macOS, Chrome, and VoiceOver versions, date, tester, page, zoom level, result, and screenshot or screen-recording path.
- Log every failure with the exact control, expected announcement/layout, observed behavior, severity, and reproduction steps.

## VoiceOver journeys

Run each journey with VoiceOver enabled and the screen curtain on for at least one complete pass. Use VoiceOver navigation rather than the mouse.

### Demo parent

1. Confirm the page title, demo notice, primary navigation, and current selection are announced in a useful order.
2. Navigate Overview, Learning plan, Learner profile, and Educator demo using landmarks and controls.
3. In Learning plan, select a week, day, and lesson; confirm selected state, objective, instructions, materials, adaptations, resources, status, scheduling reason/date, and caregiver note are understandable.
4. Save an activity and confirm the success message is announced once without moving focus unexpectedly.
5. Submit invalid then valid profile data; confirm errors identify the affected fields and success is announced.

### Authenticated parent harness

1. Complete intake and consent, including every field group and validation message.
2. Navigate the published plan and update lesson activity.
3. Read and send a secure message, attach a synthetic file, and verify pending-scan and recovery messages.
4. Acknowledge delivery, request a revision, export, and open correction/deletion controls.
5. Switch learners and verify the new learner and selected state are announced without stale content.

### Educator harness

1. Navigate the prioritized case queue and confirm current case, status, SLA, intake context, and warnings.
2. Create a two-week plan, add a governed substitute and required resource, and save the immutable version.
3. Complete review, publish, delivery/retry, secure messaging, revision, and exception controls.
4. Confirm loading, success, failure, stale-context warning, and retry messages are announced once and focus remains usable.
5. Switch cases and verify no prior learner’s draft values or checked approvals are announced.

## True browser zoom

Repeat the demo Overview, Learning plan, Learner profile, and Educator demo at Chrome browser zoom values of 200% and 400%—not CSS zoom, device scaling, or a resized viewport.

At each level verify:

- no horizontal page scrolling at a 1280px-wide browser window;
- text and controls do not overlap, clip, or disappear;
- navigation and essential actions remain present and keyboard reachable;
- dialogs, validation messages, statuses, attachments, and long content reflow within the viewport;
- focus is never hidden behind sticky or fixed content;
- pointer targets and text remain distinguishable without relying on colour alone.

## Pass criteria and evidence

The gate passes only when all three VoiceOver journeys and all eight view/zoom combinations complete without a critical or serious blocker. Medium findings require an owner and documented private-beta decision; minor findings require a backlog entry. Store sanitized evidence under `qa/accessibility/manual/` and add a dated summary to `qa/accessibility/manual-report.md`. Do not mark the implementation-plan checkbox complete until those artifacts exist and have been reviewed.

## Linux / CI preparation (does not close the gate)

Before a macOS tester starts, confirm locally:

- Skip link reaches `#workspace-main` or `#live-main`.
- Overview / parent plan expose a clear “what to do next” control.
- Intake invalid submits announce errors tied to fields and move focus to the first invalid control.
- Educator queue selection moves focus to the selected case heading; preferred next status is obvious.
- `npm run test:a11y` is green (axe A/AA, keyboard focus outline, 640px/320px overflow equivalence).

These checks reduce VoiceOver churn. They are **not** evidence that VoiceOver or true Chrome zoom passed.
