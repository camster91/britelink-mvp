# BriteLink launch todo — a great app humans enjoy

**Created:** 2026-09-21
**Reconciled against:** live hosts, `origin/main` at `1275d6a`, and GitHub issues #1–#14
**Status:** planning artifact. Nothing here is approved or scheduled. Approval boundaries at the bottom.

## Where the project actually is

**The product is built and running. The launch is blocked on people, money, and paper — not code.**

Verified live 2026-09-21:

- `britelink.ashbi.ca` → HTTP 200 · `marketing.britelink.ashbi.ca` → HTTP 200 · `britelink-api.ashbi.ca` → 404 at `/` (expected for a REST root)
- Clean checkout of `origin/main` at `1275d6a` → **174 pass / 0 fail / exit 0**
- 40 migrations, 25 files in `src/`, 23 test files, 23 tracked docs

**Working (locally verified):** parent journey (intake → plan → lesson activity → messaging → revision → export/deletion), educator workbench (triage → assign → author → review → publish → deliver → revise), 25-table household isolation with executable RLS tests, WCAG A/AA automated checks, keyboard navigation, responsive 320px–desktop, operational runbooks.

**Not working / not proven:** no hosted Supabase project, no real auth, no live Stripe, no external monitoring, no manual accessibility evidence, no legal sign-off, no credentialed educator sign-off, zero families.

**The honest one-liner:** this is a finished demo that has never been driven by a real family or a real educator against real infrastructure.

## The two different finish lines

Worth separating, because "launch" is ambiguous and the work is very different.

### Finish line A — Private beta (5–10 families)
This is what the repo's plan and GitHub issues #1–#13 actually target. Achievable, no code work left in the critical path.

### Finish line B — "A great app humans enjoy" (public, sustainable)
Finish line A plus the product gaps that make it survive contact with a real week, plus marketing, support, and pricing. This is where `BUILD-PRIORITIES.md` P0/P1 live.

**Recommendation:** finish A first and learn from it, then build B on evidence rather than guesses. The P0 items below are strong hypotheses, not verified needs — 5–10 real families will tell us which ones actually matter.

---

## Phase 0 — Ship hygiene (owner: Mini, no approval needed)

Small, reversible, and closes the exact class of defect that failed this pilot three times.

- [x] **T0.1** ~~Decide the fate of the 039 diagnostic migration~~ — **closed 2026-09-21: nothing to remove.** The deployed database has no `diagnose_caller_identity` function (`select count(*) from pg_proc where proname='diagnose_caller_identity'` returns 0), so 039 was never applied to production. Only the migration file exists, and it is now tracked. Optional later cleanup: delete the file.
- [ ] **T0.2** Track the remaining untracked review artifacts, or record explicitly why they stay local. Right now the pilot's own evidence trail (evaluations, final-state record, defect record) exists only on this machine. **Partly resolved:** the evaluations v1/v2/v3, `PILOT-FINAL-STATE`, `LESSON-SAVE-DEFECT`, `HOMESCHOOL-RESEARCH`, `BUILD-PRIORITIES`, and `LAUNCH-TODO` are now tracked. Still local-only: `local-backend/`, `mcp/`, and most `scripts/` QA tooling.
- [x] **T0.3** ~~Pin the deployed revision~~ — **closed 2026-09-21.** The deploy pipeline already reset to an exact SHA and hard-failed on mismatch; what was missing was a revision readable from outside the VPS. `scripts/write-build-info.mjs` now emits `dist/client/version.json` (commit, short form, build time) and `deploy.yml` exports `BRITELINK_BUILD_COMMIT` into the build, then fails the deploy if the served `/version.json` does not name the deployed commit. Verified locally: correct SHA stamps, malformed SHA fails the build.
- [ ] **T0.4** ~~Close the migration-coverage gap~~ — **restated 2026-09-21; my original framing was wrong.** I wrote that "the current migration path is not executed by the suite". That is false. `scripts/migration-harness/validate-migrations.sh` globs and applies **all 40** migrations in order to a throwaway real PostgreSQL, plus the storage policies, then runs behavioural assertions — and the `migration-harness` job in `ci.yml` runs it on every push and PR. Full-chain execution **is** covered in CI against real Postgres. The `postgres-rls.test.mjs` fixture loading 001–021 is a deliberate, now honestly-scoped subset. The genuine residual gap is narrower: the 25-table RLS sweep exercises 001–021 policies, so 022–039 hardening is executed but not swept. Assess whether that is worth a further fixture build, or record it as an accepted limitation.
- [x] **T0.5** ~~Adopt or revert the inlined debug INSERT/UPDATE policies~~ — **closed 2026-09-21, false alarm, retracted.** `has_household_role()` is defined in `001_core.sql` as exactly the `EXISTS` over `memberships` I saw live, and Postgres inlines SQL-language functions into policy expressions, so `pg_get_expr` shows the expanded form. The live policy **is** migration 031. No uncommitted policy exists.
- [x] **T0.6** ~~Add a CI check that fails when the working tree has uncommitted product files~~ — **closed 2026-09-21, implemented as option 2 (precise).** `scripts/check-tracked-test-imports.mjs` fails when a tracked test imports a file git does not track, wired into `ci.yml` before the test step. Chosen over a blanket dirty-tree check because it has near-zero false positives and catches exactly the defect that shipped a broken `main` three times. Proved by negative control: untracking `src/staff-workspace.js` makes it fail naming both dependent tests; restoring it returns green.

**Done when:** the repo is self-describing — a clean clone reproduces the running product, and no live behaviour is unattributable to a committed file.

---

## Phase 1 — External gates (owner: Cameron, external timelines)

These are the real blockers. They are all outside engineering, and several run in parallel.

- [ ] **T1.1 Provision staging Supabase** (3–5h) — separate dev and staging projects, apply all 40 migrations, storage bucket, invited-only auth. **Critical path, everything downstream waits on this.**
- [ ] **T1.2 Apply 40 migrations to hosted, not 23** — `CAMERON_GATED_ITEMS.md`, `GOAL_COMPLETION_PLAN.md`, `END_TO_END_SHIP_PLAN.md`, `SUPABASE_PROVISIONING.md`, `ENVIRONMENT_INVENTORY.md`, `HOSTED_STAGING_VERIFICATION.md`, `ship-status.md`, and `IMPLEMENTATION_PLAN.md` all still say 21–23 migrations or "twenty-one". The repository has **40**. Following those docs as written would under-provision the launch database.
- [ ] **T1.3 Privacy counsel review** (1–4 weeks, unpredictable) — notice text, consent purposes, retention schedule, breach path. **Cannot collect real family data without this.** Send the packet now; it is the longest lead item.
- [ ] **T1.4 Credentialed educator review** (1–2 weeks) — curriculum, safeguarding, accessibility, resource rights sign-off. **Cannot deliver plans without this.**
- [ ] **T1.5 Named operating owners** — incident commander, privacy lead, technical lead, on-call roster. Fill the blanks in `INCIDENT_RESPONSE.md` and `MONITORING_OPERATIONS.md`.
- [ ] **T1.6 Stripe account + signed webhook** (2–3h) — test mode first, products, webhook secret, verify the signature path. The database ingests events; it does not verify signatures yet.
- [ ] **T1.7 External monitoring** (1–2h) — heartbeat on the health probe, alert route, one delivered test alert.
- [ ] **T1.8 Malware scanner** (2–4h) — ClamAV or VirusTotal behind the quarantine model. Beta can ship with uploads disabled if needed.
- [ ] **T1.9 Managed backups + PITR** — with the approved RPO, plus off-project encrypted copies.
- [ ] **T1.10 Manual accessibility session** (4–8h) — VoiceOver on macOS plus true Chrome 200%/400% zoom. Automated checks do not substitute; this is a hard gate.
- [ ] **T1.11 Recruit 5–10 beta families** — written consent, expected behaviour, support hours. Last step, not a discovery mechanism.

**Done when:** every gate in `RELEASE_READINESS.md` has deployed or human-approved evidence, not a local checkbox.

---

## Phase 2 — Prove it works hosted (owner: engineers, after T1.1)

The work that turns "verified locally" into "verified in production-like conditions."

- [ ] **T2.1** Hosted isolation verifier — 104 read checks across 25 private tables and the private bucket. Two real authenticated households, mutual denial.
- [ ] **T2.2** Hosted mutation-denial matrix — writes, not just reads. Forged household or actor attribution must be denied. The current verifier explicitly does not cover this.
- [ ] **T2.3** Multi-device parent journey — sign in on two devices, complete intake, run a published plan, message with an attachment, acknowledge, request a revision, export, request deletion.
- [ ] **T2.4** Multi-device educator journey — distinct author and reviewer accounts. The author must not be able to approve their own plan in the live database.
- [ ] **T2.5** Deployed privacy exercises — correction, export, deletion request → schedule → cancellation, staff offboarding, consent withdrawal.
- [ ] **T2.6** Staging restore drill — restore at representative volume, measure RPO/RTO, re-check isolation after restore.
- [ ] **T2.7** Incident tabletop — cross-household exposure and educator absence, with dated notes and corrective actions.

**Done when:** the hosted evidence exists and is dated, for synthetic data only.

---

## Phase 3 — Make it a great app, not just a correct one (owner: product + engineering)

This is Finish line B. These are the things that decide whether a family keeps using it in week three.

### P0 — the daily loop. Do these first.

- [ ] **T3.1 Flexible week** — skip a day, rebalance, carry forward, pause a subject. The top two parent pains in the research are planning exhaustion and recovering when life breaks the plan. Every mature competitor leads with automatic rescheduling, and this is BriteLink's biggest gap.
- [ ] **T3.2 Next-action that respects the day** — today "next lesson" is just the first incomplete item in a fixed sequence. A useful answer must account for time available, independent-only work, offline, and low-energy days.
- [ ] **T3.3 Lesson completion that feels good** — the mechanism now works (migration 040), but the moment is plain. Completing a lesson should be the most satisfying click in the product; this is where retention is won or lost.

### P1 — confidence and family fit.

- [ ] **T3.4 Weekly "you are doing enough" story** — goals touched, subjects explored, wins, concerns. Parents' third-biggest worry is whether learning is actually happening. Show evidence without school-style red/green judgement.
- [ ] **T3.5 Capture learning outside the plan** — photo, book, outing, co-op, tutor, free note. Without this the product only serves one homeschooling philosophy; eclectic, unschooling, Charlotte Mason and project families learn from many sources.
- [ ] **T3.6 Whole-family day** — one activity, several learners, differentiated outcomes. Separate plans per child multiply preparation; shared activities reduce it.
- [ ] **T3.7 Intake asks desired structure** — plan-every-day vs weekly goals vs capture-after. Serves a spectrum; a permanent philosophy label does not.

### P2 — convenience, once P0/P1 hold.

- [ ] **T3.8** Calendar export and sync, reminders, weekly digest
- [ ] **T3.9** Printable week and printable daily list — homeschool families still print
- [ ] **T3.10** Student check-off view
- [ ] **T3.11** Human-readable PDF/CSV reports alongside the existing JSON export
- [ ] **T3.12** External provider links and imports

**Done when:** a real family can break the plan and recover in under a minute, and can see a week of evidence that they did enough.

---

## Phase 4 — Public launch (owner: Cameron + Mini)

- [ ] **T4.1** Public pricing and checkout, customer-visible — approval gate
- [ ] **T4.2** Support model — hours, SLA, who answers, what happens when a plan is wrong
- [ ] **T4.3** Marketing site beyond the current staging page
- [ ] **T4.4** Retention and cancellation flows
- [ ] **T4.5** Onboarding that gets a family to their first completed lesson without a human
- [ ] **T4.6** Beta report → decide public launch on evidence, not enthusiasm

---

## Design rules that must not be broken

These are already written down in `BUILD-PRIORITIES.md` and they are the difference between a good product and a dark pattern.

- **Planning must save more time than it consumes.** Default to a usable suggestion; detail is optional.
- **Plans are hypotheses, not contracts.** Preserve history; make adaptation normal.
- **Capture learning that happened**, not only what BriteLink prescribed.
- **Never use anxiety as retention.** No shame streaks, no "behind" labels, no assumed school pacing.
- **Jurisdiction-aware, not legal-advice theatre.** Cite the official rule, show the last-checked date, tell families to verify locally.
- **Never claim live status the system cannot know** — honesty over polish.

## Explicitly out of scope

Not required for beta, and not part of this todo: public SEO push, child-facing learner login or AI tutor, instant/AI-generated plans, community or forums, expanding into health/diagnosis/IEP data, and OSSD credit issuance (only authorised Ontario schools grant credits).

## Approval boundaries

Explicit approval immediately before: provisioning paid or external infrastructure, production deployment, collecting real family data, external communications, customer-visible pricing changes, or sending a private-beta invitation.

Local code, tests, documentation, and synthetic preview work stay in scope without approval.

## Progress log

- **2026-09-21 — Phase 0 closed** at `8ca91a6`. T0.1 and T0.5 closed by evidence (nothing to remove; false alarm retracted). T0.3 done: `/version.json` reports the deployed commit and the deploy fails if it does not match. T0.6 done: the provenance guard is in CI and proven by negative control. T0.4 restated honestly — full-chain migration execution already runs in CI; the residual gap is narrower than first written. T1.2 prep done: eight documents corrected from 21–23 migrations to 40.
- **2026-09-21 — external packets prepared** at `3a4e8dc`. Counsel packet, educator packet, and staging provisioning runbook drafted, each with its own open drafting notes so unsettled facts are not sent as decided. None sent.
- **Open and unchanged:** production runs `c805455` while the repository is at `3a4e8dc`. Deploying is a production action awaiting Cameron.

**Done when:** the repo is self-describing — a clean clone reproduces the running product, and no live behaviour is unattributable to a committed file.

## If only one thing starts today

**Send the counsel packet (T1.3).** It has the longest and least predictable lead time, it needs no infrastructure, and nothing involving real families can happen without it. Engineering can close Phase 0 in the same window.

## Existing tracking

This todo does not replace the repo's ledgers. GitHub issues #1–#13 are the execution record, #14 is the roadmap, `RELEASE_READINESS.md` is the evidence ledger, and `GOAL_COMPLETION_PLAN.md` is the sequenced plan. This document reconciles them as of 2026-09-21 and adds the product-quality path they deliberately exclude.
