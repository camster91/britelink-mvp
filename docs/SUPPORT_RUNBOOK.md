# Family support runbook (draft, #55)

**Status:** draft. Items marked **OWNER DECISION** need Cameron. Until they are decided, the app shows no support hours and no support address; the in-app "Need help?" panel routes only to channels that work today, and the authenticated audit fails if an address appears.

## Channels that exist today

| Family need | Where it goes in the app | Who answers |
| --- | --- | --- |
| A question about the plan | Secure case message ("Ask your educator") | The assigned educator; response due within 2 days (migration 008 sets `response_due_at`) |
| "This plan is wrong for my child" | Request a revision (limited by package) | Educator, via the revision workflow |
| Privacy: export, consent, deletion | "Your data" | Self-serve; deletion goes to the privacy lead's queue |
| Something is broken | Secure case message | Educator triages; technical issues go to the technical lead |

## OWNER DECISIONS

- [ ] **Support hours** published to families, e.g. "weekdays 9–5 Eastern".
- [ ] **Response time**: the 2-day SLA above, or a shorter one.
- [ ] **Named support owner and contact** (shared with #7). If an email is published, add it to the help panel and change the audit that forbids it.
- [ ] **Escalation contact** when the assigned educator is away. The app already supports reassignment (`staff_record_educator_absence`).

## Tabletop exercise: "the plan is wrong"

Run once before the first family, with the educator and whoever will answer messages. Allow 45 minutes and record the outcomes in `docs/PROJECT-STATUS.md`. Use the synthetic staging household only.

**Scenario.** On day 3, a guardian messages: *"Week 1 has long written tasks. My son has a writing difficulty (it's in his intake) and he melted down twice. I don't think this plan was made for him."*

| Step | Question for the team | Expected answer (what the product supports) |
| --- | --- | --- |
| 1 | Who sees the message, and by when must they answer? | The assigned educator; the message shows as overdue after 2 days. |
| 2 | What do we say in the first reply? | Acknowledge the problem, don't argue it, give a date for the fix, and suggest pausing the subject meanwhile ("Pause a subject" or "Low-energy day"). |
| 3 | Is this a revision, and does it count against the package? | Yes, it is a revision request. Decide now whether an intake-contradicting plan counts (**OWNER DECISION**). |
| 4 | How was it missed? | Check the internal review record (`plan_reviews`) for the accessibility check. |
| 5 | How does the corrected plan reach the family? | Author version N+1, pass review, complete the revision, redeliver. The family acknowledges it. |
| 6 | What do we record? | The audit trail is automatic. Add a note to the case. No health details beyond what the family wrote. |
| 7 | What if the educator is away? | An admin records the absence, the case goes on hold, and it is reassigned within capacity. |

**Pass criteria:** every step has a named person, and nobody has to invent a channel the app doesn't have.
