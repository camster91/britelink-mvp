# BriteLink Empty States Audit

**Purpose:** Document all empty states in the application and verify they meet world-class UX standards (Linear, Stripe, Notion quality bar).

**Audit date:** 2026-09-09  
**Status:** Complete — all empty states meet professional standards

---

## Empty State Standards

**World-class empty states include:**
1. **Clear heading** — What's empty
2. **Explanation** — Why it's empty (when not obvious)
3. **Next action** — What to do next (when applicable)
4. **Professional tone** — Calm, not cutesy or apologetic

**Anti-patterns to avoid:**
- Generic "No data" without context
- Overly cutesy illustrations or copy
- Dead ends (empty with no action)
- Apologetic tone ("Sorry, nothing here!")

---

## Audited Empty States

### 1. Parent: No Lessons for Selected Day

**Location:** `AuthenticatedApp.jsx:585`

**Current implementation:**
```jsx
{!day?.lessons?.length ? (
  <p>No lessons are scheduled for this day.</p>
) : (
  // lesson list
)}
```

**Assessment:** ✅ **Professional and clear**
- States what's missing (lessons)
- Explains context (this day)
- Tone is neutral and factual

**Improvement opportunity:** Could add guidance
```jsx
<div className="live-empty">
  <p>No lessons are scheduled for this day.</p>
  <p className="hint">
    Lessons can be rescheduled using the calendar control above.
  </p>
</div>
```

**Priority:** Low (current state is acceptable)

---

### 2. Parent: No Messages in Secure Thread

**Location:** `AuthenticatedApp.jsx:860-863`

**Current implementation:**
```jsx
{messages.length ? (
  // message list
) : (
  <p>
    No messages yet. Use this secure thread instead of email for
    learner information.
  </p>
)}
```

**Assessment:** ✅ **Excellent**
- Clear heading (implicit: no messages)
- Explains purpose of the thread
- Sets expectation (use this, not email)
- Professional tone

**No changes needed.**

---

### 3. Educator: No Active Cases

**Location:** `EducatorWorkspace.jsx:330-333`

**Current implementation:**
```jsx
{!queue.length ? (
  <div className="live-empty">
    <h3>No active cases</h3>
    <p>This household has no cases requiring attention right now.</p>
  </div>
) : (
  // case queue
)}
```

**Assessment:** ✅ **Professional and contextual**
- Clear heading
- Explains why (no attention required)
- Appropriate for both "you're done" and "nothing assigned yet" scenarios

**Improvement opportunity:** Differentiate scenarios
```jsx
<div className="live-empty">
  <h3>No active cases</h3>
  <p>
    {totalCases === 0 
      ? "You have no assigned cases. Contact your admin if you're expecting assignments."
      : "All assigned cases are complete or awaiting family action."}
  </p>
</div>
```

**Priority:** Low (nice-to-have, not critical)

---

### 4. Educator: No Messages for Case

**Location:** `EducatorWorkspace.jsx:805`

**Current implementation:**
```jsx
{messages.length ? (
  // message list
) : (
  <p>No secure messages for this case.</p>
)}
```

**Assessment:** ✅ **Clear and factual**
- States what's empty
- Context is clear (this case)

**Improvement opportunity:** Add guidance for initial contact
```jsx
{messages.length ? (
  // message list
) : (
  <div className="live-empty">
    <p>No secure messages for this case.</p>
    <p className="hint">
      Send a message below if you need clarification on the intake.
    </p>
  </div>
)}
```

**Priority:** Low (current is acceptable)

---

### 5. Demo: Case at Final State

**Location:** `App.jsx:817`

**Current implementation:**
```jsx
{options.length ? (
  // status options
) : (
  <p className="empty">This case is at its final state in this demo.</p>
)}
```

**Assessment:** ✅ **Clear demo boundary**
- Explains why no actions
- Demo-specific language is appropriate
- Sets realistic expectations

**No changes needed.**

---

### 6. Demo: No Staff Messages

**Location:** `App.jsx:865`

**Current implementation:**
```jsx
{demoMessages.length ? (
  // message list
) : (
  <p className="empty">
    No messages yet. Use this secure thread to ask focused questions about
    Riley's learning needs.
  </p>
)}
```

**Assessment:** ✅ **Excellent example guidance**
- Sets expectation (focused questions)
- Provides example context (Riley's learning needs)
- Encourages appropriate use

**No changes needed.**

---

### 7. Privacy: No Active Consent

**Location:** `AuthenticatedServicePrivacy.jsx:30`

**Current implementation:**
```jsx
{data.consents.length ? (
  // consent controls
) : (
  <p>No active consent attributed to this signed-in guardian.</p>
)}
```

**Assessment:** ✅ **Technically accurate**
- States the condition clearly
- Appropriate for edge case (shouldn't happen in normal flow)

**Context:** This should be rare (user completed intake but consent isn't attributed). Current message is correct for debugging.

**No changes needed.**

---

## Loading States Audit

### 1. Operation State Pattern

**Location:** `operation-state.js`

**Implementation:**
- `status: "loading"` with `message` property
- `status: "error"` with `message` and `canRetry`
- `status: "success"` with `message`

**Usage examples:**
```jsx
// AuthenticatedApp.jsx
{operation.status === "loading" && (
  <span role="status" aria-live="polite">
    {operation.message}
  </span>
)}

{operation.status === "error" && (
  <span role="alert" aria-live="assertive">
    {operation.message}
  </span>
)}
```

**Assessment:** ✅ **Accessible and professional**
- Uses semantic ARIA roles
- Clear status messages
- Retry pattern for recoverable errors

**No changes needed.**

---

### 2. Message Send Loading

**Location:** `AuthenticatedApp.jsx` (secure messaging)

**Current implementation:**
```jsx
<button type="submit" disabled={isSending || !messageBody.trim()}>
  {isSending ? "Sending…" : "Send secure message"}
</button>
```

**Assessment:** ✅ **Clear state indication**
- Button text updates during send
- Disabled during operation
- Ellipsis indicates progress

**No changes needed.**

---

### 3. Attachment Upload States

**Location:** `MessageAttachments.jsx`

**States implemented:**
- `uploading` — "Uploading…"
- `pending_scan` — Warning with guidance
- `quarantined` — Error with recovery options
- `clean` — Success state

**Assessment:** ✅ **World-class attachment UX**
- Clear state progression
- Helpful guidance at each stage
- Recovery options for blocked states

**No changes needed.**

---

## Error State Audit

### 1. Form Validation Errors

**Location:** `AuthenticatedIntake.jsx` (and other forms)

**Pattern:**
```jsx
{validationResult.errors.length ? (
  <div role="alert" className="validation-summary">
    <strong>Please correct the following:</strong>
    <ul>
      {validationResult.errors.map((error) => (
        <li key={error.field}>{error.message}</li>
      ))}
    </ul>
  </div>
) : null}
```

**Assessment:** ✅ **Accessible and specific**
- Grouped error summary with `role="alert"`
- Each error identifies the field
- Focus management on submit

**No changes needed.**

---

### 2. Network/Auth Errors

**Pattern across app:**
```jsx
{needsFreshSignIn(error) ? (
  <span role="alert">
    For your protection, this action requires a fresh sign-in from the last 10 minutes.
    <button onClick={requestFreshSignIn}>Send fresh sign-in link</button>
  </span>
) : (
  <span role="alert">{error.message}</span>
)}
```

**Assessment:** ✅ **Clear error recovery**
- Explains why (protection)
- Provides action (fresh sign-in)
- Professional tone (not technical jargon)

**No changes needed.**

---

### 3. Hosted Isolation Test Failures

**Location:** `hosted-isolation.js`

**Pattern:**
```javascript
throw new Error(
  `${householdLabel} MUST NOT see ${otherLabel} private ${tableName}`
);
```

**Assessment:** ✅ **Developer-appropriate**
- Clear failure reason
- Actionable (which household, which table)
- Not user-facing (test runner only)

**No changes needed.**

---

## Recommendations

### Priority 1: No Critical Issues

All empty states, loading states, and error states meet professional standards. No blocking issues for private beta.

---

### Priority 2: Nice-to-Have Enhancements

**1. Differentiate "no cases" scenarios for educators**

Current: "This household has no cases requiring attention right now."

Enhancement: Distinguish between "you're done" and "nothing assigned yet"

**Impact:** Reduces educator confusion when onboarding

**Effort:** Low (1-2 hours)

**Decision:** Defer to private beta feedback. Current state is acceptable.

---

**2. Add empty state guidance hints**

Current: "No lessons are scheduled for this day."

Enhancement: Add hint about rescheduling feature

**Impact:** Helps families discover rescheduling

**Effort:** Low (1-2 hours across all empty states)

**Decision:** Defer to private beta feedback. Current state is clear.

---

### Priority 3: Future Improvements

**1. Empty state illustrations**

Many world-class apps (Linear, Stripe) use subtle illustrations in empty states.

**Decision:** Intentionally excluded from MVP. BriteLink's design language is text-focused and calm. Adding illustrations requires:
- Design system alignment
- Accessibility considerations (decorative vs informative)
- Additional bundle size

**Defer:** Until post-launch when design language is more mature.

---

**2. Personalized empty state messaging**

Example: "Welcome, [parent name]! Let's get started by completing intake."

**Decision:** Deferred. Current impersonal tone is professional and works for all contexts.

---

## Sign-off

**All empty states meet private beta quality bar.**

- Clear headings and explanations
- Professional, calm tone (Linear/Stripe quality)
- Accessible (ARIA roles, live regions)
- No dead ends (actions provided where applicable)
- No critical issues or blockers

**Recommendation:** Ship current empty states as-is. Gather feedback during private beta and iterate based on real family usage patterns.

---

**Auditor:** Cloud Agent  
**Date:** 2026-09-09  
**Next review:** After private beta (based on family feedback)
