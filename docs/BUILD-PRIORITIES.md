# BriteLink build priorities

**Derived from:** `docs/HOMESCHOOL-RESEARCH.md` (2026-09-19)
**Status:** proposal for Cameron's decision — nothing here is built or approved.

## The product position

> **Personalised human-reviewed planning + flexible daily execution + automatic jurisdiction-aware records.**

The market splits into two incomplete halves:

- **Content systems** — Time4Learning, Khan, IXL, Sonlight, Teach-nology — reduce lesson sourcing but don't manage the family's mixed online/offline record.
- **Administrative planners** — Homeschool Planet — manage time and records well but lean on parents or paid add-ons for the actual learning plan.

BriteLink already supplies the hard half (an educator-authored, personalised plan). It lacks the daily mechanics that make a tool survive contact with a real week.

## Ontario shapes the priority

Ontario requires **no** attendance log, portfolio, annual report, or assessment for an independently home-schooling family. Notification is policy guidance, not statute.

So records in Ontario are for **peace of mind** and **Grades 9–12 options**, not compliance. That means:

- **Do not build compliance theatre** — no compulsory attendance grid.
- **Do build a low-burden learning log** that quietly becomes "evidence we did things."
- **Keep Grade 9–12 pathway records visibly separate** from official OSSD credits — only authorised schools grant credits.

## Priorities

### P0 — the daily loop

| # | Capability | Why it matters | Evidence |
|---|---|---|---|
| 1 | **Flexible week** — skip a day, rebalance, carry forward, pause a subject | The top two parent pains are planning exhaustion and recovering when life breaks the plan. Every mature competitor leads with automatic rescheduling. | Homeschool Planet features; parent planning account |
| 2 | **Working lesson completion** | Turns a done lesson into a record. Currently blocked by the unresolved `lesson_activities` defect. | `docs/archive/LESSON-SAVE-DEFECT.md` |
| 3 | **Next-action that respects the day** — time available, independent-only, offline, low-energy | Today's "next lesson" is just the first incomplete item in a fixed sequence. A useful next action must reflect the actual morning. | `authenticated-workspace.js` selection logic |

### P1 — confidence and family fit

| # | Capability | Why it matters |
|---|---|---|
| 4 | **Weekly "you are doing enough" story** — goals touched, subjects explored, wins, concerns | Parents' third-biggest worry is whether learning is happening. Show evidence without school-style red/green judgement. |
| 5 | **Capture learning outside the plan** — photo, book, outing, co-op, tutor, free note | Eclectic, unschooling, Charlotte Mason and project families learn from many sources. Without this the product only serves one philosophy. |
| 6 | **Whole-family day** — one activity, several learners, differentiated outcomes | Separate plans per child multiply preparation; shared activities reduce it. |
| 7 | **Intake: ask desired structure** — plan-every-day vs weekly goals vs capture-after | "How much structure do you want?" serves a spectrum; a permanent philosophy label does not. |

### P2 — convenience, once P0/P1 hold

- Calendar export/sync, reminders, digest
- Printable week + printable daily list
- Student check-off view
- External provider links/imports
- Human-readable PDF/CSV reports alongside the existing JSON export

## Non-negotiable design rules

- **Planning must save more time than it consumes.** Default to a usable suggestion; detail is optional.
- **Plans are hypotheses, not contracts.** Preserve history; make adaptation normal.
- **Capture learning that happened**, not only what BriteLink prescribed.
- **Never use anxiety as retention.** No shame streaks, no "behind" labels, no assumed school pacing.
- **Jurisdiction-aware, not legal-advice theatre.** Cite the official rule, show last-checked date, expose only relevant fields, tell families to verify local requirements.

## Open questions for Cameron

1. **Build order** — start with the flexible week (biggest pain, biggest gap) or fix lesson-save first (smaller, unblocks records)?
2. **How much to invest now** — the research supports a substantial direction, but it is a product decision, not a research one.
3. **Keisa's role** — she could review the current 4-week plan before either build starts, or wait until the flexible week exists.

## What is deliberately excluded

- OSSD credit issuance — only authorised Ontario schools may grant credits.
- Legal advice — the report cites rules and dates; it does not interpret them.
- Attendance/compliance theatre — no Ontario basis for it.
