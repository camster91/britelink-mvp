# Pre-VoiceOver Accessibility Checklist

**Purpose:** Ensure Linux-verifiable accessibility foundations are solid before investing time in macOS VoiceOver testing. This checklist catches common issues that would cause VoiceOver failures.

**When to use:** Before scheduling macOS VoiceOver testing with a human tester.

**Status:** These checks can be performed on Linux in the CI environment. They do NOT substitute for VoiceOver or true browser zoom evidence.

---

## Prerequisite: Automated Tests Passing

Before manual checks, confirm:

```bash
npm run test:a11y
```

**Must pass:**
- axe-core A/AA checks (0 violations)
- Keyboard focus outline checks (all interactive elements)
- 640px and 320px overflow equivalence (no horizontal scroll)
- Contrast checks (4.5:1 for normal text, 3:1 for large text)
- Reduced motion checks

**If automated tests fail, fix those issues first.** Don't proceed to manual checks until automation is green.

---

## Manual Checks (Linux/Browser)

Run these checks on the production build in Chrome on Linux:

```bash
npm run build
npm run preview
```

Open `http://localhost:4173` (or the port shown).

---

### Check 1: Skip Link to Main Landmark

**Why:** Screen reader users need to skip navigation and go straight to content.

**Test:**
1. Load the page
2. Press Tab once (don't look at the screen)
3. Press Enter

**Pass criteria:**
- Skip link becomes visible on focus
- Pressing Enter moves focus to the main content area (`#workspace-main` or `#live-main`)
- Main content has a visible focus indicator

**Fail examples:**
- Skip link not visible on focus
- Pressing Enter does nothing
- Focus moves somewhere unexpected
- No main landmark exists

---

### Check 2: Obvious Next Action in Each View

**Why:** Screen reader users need to understand what to do next without visual scanning.

**Test:**

**Demo Overview:**
1. Navigate to Overview
2. Tab through interactive elements
3. Identify the "what to do next" control

**Pass:** A clear primary action is obvious (e.g., "View Learning Plan" or "Start Lesson")

**Parent Learning Plan:**
1. Navigate to Learning Plan
2. Tab through the view

**Pass:** Next action is obvious (e.g., "Start Today's Lesson" or "Continue Week 2")

**Educator Queue:**
1. Open educator harness
2. Tab through the case queue

**Pass:** Next required action is obvious for each case (e.g., "Author Plan" or "Review Submission")

**Fail examples:**
- No clear primary action
- All controls feel equally important
- User has to guess what to do next

---

### Check 3: Form Validation Identifies Fields

**Why:** Screen readers need error messages tied to the specific field that failed.

**Test:**

**Intake form:**
1. Navigate to Intake (demo or authenticated)
2. Leave required fields empty
3. Submit the form
4. Tab to the first error

**Pass criteria:**
- Error message identifies the field by name (e.g., "Learning objectives: This field is required")
- Focus moves to the first invalid field
- Field has `aria-invalid="true"`
- Field has `aria-describedby` linking to error message
- Error is announced by screen reader (test with ChromeVox if available)

**Fail examples:**
- Generic error: "Please fix errors" without field names
- Focus doesn't move to invalid field
- No `aria-invalid` or `aria-describedby`
- Screen reader doesn't announce error

**Repeat for:**
- Learner profile form
- Message composition
- Educator plan authoring

---

### Check 4: Educator Queue Selection Focus

**Why:** When selecting a case, focus must move to that case's content so screen reader knows what changed.

**Test:**

1. Open educator harness
2. Tab to case queue
3. Select a different case (Arrow keys or click)

**Pass criteria:**
- Focus moves to selected case heading or content area
- Selected case heading is announced
- Screen reader knows context changed

**Fail examples:**
- Focus stays in the queue (user has to manually Tab to see content)
- No announcement of selected case
- User has to guess what changed

---

### Check 5: Loading, Success, and Error Announcements

**Why:** Screen readers need feedback for async operations.

**Test:**

**Message send:**
1. Open secure messaging
2. Type a message
3. Click Send
4. Wait for confirmation

**Pass criteria:**
- Loading state is announced ("Sending message...")
- Success is announced once ("Message sent")
- Focus remains usable (not moved unexpectedly)
- Live region with `aria-live="polite"` or `role="status"`

**Fail examples:**
- No announcement (user doesn't know if send succeeded)
- Multiple announcements (message repeated)
- Focus jumps to unexpected location
- User has to look for visual confirmation

**Repeat for:**
- Saving lesson activity
- Requesting revision
- Publishing educator plan
- Retrying failed delivery

---

### Check 6: Modal Dialog Focus Trap

**Why:** Screen readers must stay inside modal dialogs until dismissed.

**Test:**

1. Open a dialog (e.g., Delete confirmation, Export data)
2. Tab through all controls
3. Tab past the last control

**Pass criteria:**
- Focus wraps to first control in dialog
- Focus never escapes to content behind dialog
- Escape key dismisses dialog
- Focus returns to trigger element after close

**Fail examples:**
- Focus escapes dialog
- Escape doesn't dismiss
- Focus lost after close
- User trapped in dialog with no escape

---

### Check 7: Icon-Only Buttons Have Labels

**Why:** Screen readers can't read icons—every control needs text.

**Test:**

1. Scan all views for icon-only buttons (no visible text)
2. Inspect each in browser DevTools
3. Verify `aria-label` or `aria-labelledby`

**Pass criteria:**
- Every icon-only button has a text alternative
- Label is descriptive (not just "button" or "icon")
- Label makes sense out of context

**Fail examples:**
- Icon button with no label
- Label is generic ("More" without context)
- User can't tell what button does by label alone

**Common locations to check:**
- Navigation icons
- Action buttons (edit, delete, close)
- Collapse/expand toggles
- Status indicators

---

### Check 8: Tables Have Headers

**Why:** Screen readers announce table headers with each cell.

**Test:**

1. Find tables (case queue, resource list, etc.)
2. Inspect in DevTools
3. Verify `<th>` elements or `role="columnheader"`

**Pass criteria:**
- Every data table has header row
- Headers use `<th>` or `role="columnheader"`
- `scope="col"` on column headers
- Screen reader announces header + cell content

**Fail examples:**
- Headers are `<td>` instead of `<th>`
- No headers at all
- Screen reader reads raw data without context

---

### Check 9: Dynamic Content Updates

**Why:** Screen readers need to know when content changes without page reload.

**Test:**

**Lesson activity save:**
1. Mark a lesson complete
2. Check that status updates without reload

**Pass criteria:**
- New status is announced (via live region)
- Screen reader knows content changed
- User doesn't have to re-navigate to see update

**Educator plan updates:**
1. Add a lesson in authoring workspace
2. Verify lesson appears immediately

**Pass:** Live region announces "Lesson added" or similar

**Fail examples:**
- Content changes silently (no announcement)
- User has to refresh to see update
- User has to re-navigate to know what changed

---

### Check 10: Navigation Consistency

**Why:** Screen reader users rely on predictable navigation structure.

**Test:**

1. Navigate between views (Overview → Learning Plan → Profile → Support)
2. Note navigation order and landmarks

**Pass criteria:**
- Navigation order is consistent across views
- Landmarks are consistent (`<nav>`, `<main>`, `<aside>`)
- Breadcrumbs or view indicators are consistent
- User can predict where things are

**Fail examples:**
- Navigation order changes between views
- Landmarks shift or disappear
- User has to relearn structure for each view

---

## Pass Criteria Summary

**All 10 checks must pass** before scheduling VoiceOver testing.

**If any check fails:**
1. Document the failure (view, control, expected vs actual)
2. Fix the issue
3. Re-run automated tests
4. Re-check manually
5. Don't proceed to VoiceOver until all pass

---

## After Passing This Checklist

**You are ready for:**
- macOS VoiceOver journey testing (see `MANUAL_ACCESSIBILITY_QA.md`)
- True browser zoom testing (Chrome 200% and 400%)
- Human tester can focus on journey flows, not foundational issues

**You are NOT done with accessibility:**
- This checklist verifies foundations only
- VoiceOver may still find issues
- True zoom may reveal layout problems
- This is a prerequisite, not a substitute

---

## Tools

**ChromeVox (optional):**
- Chrome extension for basic screen reader testing on Linux
- Not a substitute for VoiceOver, but catches obvious issues
- Install: Chrome Web Store → "ChromeVox Classic Extension"

**Chrome DevTools:**
- Inspect → Accessibility pane shows computed names, roles, properties
- Lighthouse → Accessibility audit (similar to axe-core)
- Console → `document.activeElement` shows current focus

**Keyboard:**
- Tab / Shift+Tab: Navigate forward/backward
- Enter / Space: Activate control
- Escape: Dismiss dialog/modal
- Arrow keys: Navigate within components (lists, menus, etc.)

---

## Checklist for Tester

Print or copy this checklist and mark each item:

- [ ] Automated tests passing (`npm run test:a11y`)
- [ ] Check 1: Skip link to main landmark
- [ ] Check 2: Obvious next action in each view
- [ ] Check 3: Form validation identifies fields
- [ ] Check 4: Educator queue selection focus
- [ ] Check 5: Loading, success, and error announcements
- [ ] Check 6: Modal dialog focus trap
- [ ] Check 7: Icon-only buttons have labels
- [ ] Check 8: Tables have headers
- [ ] Check 9: Dynamic content updates
- [ ] Check 10: Navigation consistency

**All checks must pass before VoiceOver testing.**

**Tester signature:** ___________________________  
**Date completed:** ___________________________

---

**Next step:** Schedule macOS VoiceOver testing using `MANUAL_ACCESSIBILITY_QA.md`.
