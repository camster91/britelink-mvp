# Independent evaluation — GOAL-2026-003 / REQ-003

**Artifact:** BriteLink at `/Users/Cameron/.openclaw/workspace/reviews/britelink-mvp`  
**Evaluated:** 2026-09-19 America/Toronto / 2026-09-20 UTC  
**Checkout HEAD:** `c805455e87f6a0c53efdaea3bab12bcfb08a30d1`  
**Authority:** Read-only verification; no deployment, production mutation, signup submission, or client contact  
**Headline verdict:** **FAIL — the pilot is only partially complete.**

The suite is green, but the green count does not exercise migrations `022`–`039`, including the current lesson-activity policy and beta-signup work. More importantly, the Goal's own source of truth carries a core guardian lesson-save blocker. The live user-facing failure was not independently reproduced in this read-only pass, but it is unresolved, not hidden, and not covered by the passing runtime database suite.

## Evidence boundary

- Read the full Goal Record and the key project docs, including `BUILD-PRIORITIES.md`, `HOMESCHOOL-RESEARCH.md`, and `LESSON-SAVE-DEFECT.md`.
- Captured the working tree before running tests. It was already dirty, with modified product files, an edited test, untracked migrations `024`–`039`, and other untracked scripts/docs.
- Ran exactly `npm test` from the project directory using Node `v26.5.0` and npm `11.17.0`.
- Inspected repository diffs, transition authorities/tests, migration inventory, demo-plan SQL, signup source, and deployed JavaScript chunks.
- Performed read-only HTTP checks against all three live hosts.
- Did **not** submit the signup form or perform authenticated lesson writes because either action could mutate production.
- `npm test` did not create any new working-tree change; post-test status matched the pre-test paths.

## Actual test result

```text
command: npm test
tests: 172
pass: 172
fail: 0
cancelled: 0
skipped: 0
todo: 0
exit code: 0
duration reported by node:test: 12404.026875 ms
```

This confirms the count only. It does not establish that the current migration set or live flows are covered.

## Claim-by-claim verdicts

### 1. Test suite passes: 172 pass / 0 fail / exit 0

**Verdict: CONFIRMED.**

Independent execution of `npm test` produced exactly 172 passes, 0 failures, and exit code 0.

### 2. Two stale assertions were repaired against `CASE_TRANSITIONS`, and only tests changed

**Verdict: REFUTED as stated.**

The assertion values are correct:

- `tests/staff-workspace.test.mjs:43-54` now expects `drafting -> [internal_review, on_hold, overdue]` and `submitted -> [triage, clarification, cancelled, refunded, chargeback]`.
- Those arrays match the authority in `src/service-domain.js:1-18`.
- `src/service-domain.js` itself has no working-tree diff.

However, the exact checkout does **not** support “only tests changed.” The same uncommitted tree includes tracked product changes in `index.html`, `src/AuthenticatedApp.jsx`, `src/EducatorWorkspace.jsx`, `src/staff-workspace.js`, and `src/supabase-repository.js`, plus untracked product migrations `024`–`039`. The tracked diff totals 203 insertions and 64 deletions across eight files; only one of those files is the repaired test. Without an isolated repair commit, the test edit cannot be proven to be the only change associated with this producer state.

### 3. The demo plan has 16 distinct lessons on a four-week Monday start

**Verdict: NOT VERIFIED for the live demo.**

Repository evidence is internally consistent with the claim:

- `scripts/rebuild-demo-plan.sql:78-120` loops over four weeks and four days, producing 16 rows.
- `scripts/rebuild-demo-plan.sql:91-94` starts at `2026-09-21`, a Monday, and offsets subsequent weeks by seven days.
- `scripts/rebuild-demo-plan.sql:35-45,101` combines four base titles with a week suffix for weeks 2–4, yielding 16 distinct titles.
- The script's final notice and count queries assert four weeks, 16 days, and 16 lessons (`:134-144`).

The script is untracked and was not executed in this pass. No independent read-only live database query was available, so the statement that the current live demo **has** those rows remains not verified.

### 4. Signup is open and a family can self-serve the free beta without payment

**Verdict: NOT VERIFIED end to end.**

Confirmed surface/source evidence:

- The live app returned HTTP 200 and its deployed lazy-loaded chunks contain “Sign in or join the beta,” “Join the free beta,” `shouldCreateUser: true`, and the `provision_household_from_signup` RPC call.
- `src/AuthenticatedApp.jsx:17-130` exposes the form.
- `src/supabase-repository.js:19-20` calls the signup RPC and then passwordless sign-in.
- Migration `202608280037_beta_open_signup.sql:26-140` creates a household, confirmed auth user, guardian membership, learner, and annual case; it creates no order or payment event and grants execution to `anon` and `authenticated`.

Not verified:

- The signup form was not submitted because that would create production records.
- The RPC's deployed presence, successful mail delivery, link usability, resulting login, and persisted household/learner/case were not independently observed.
- The runtime PostgreSQL suite does not load migration `037`.

Therefore the deployed UI advertises open signup, but successful self-service onboarding is not proven.

### 5. A guardian lesson-save defect (RLS 42501) is documented

**Verdict: NOT VERIFIED as a current live behavior; documentation confirmed.**

`docs/LESSON-SAVE-DEFECT.md:9-30` documents the 42501 failure and an SQL-level `RETURNING`/SELECT-policy discriminator. The current repository call still performs an upsert followed by `.select().single()`, consistent with the documented operation boundary.

This evaluator did not perform an authenticated production write, so the live guardian failure was not independently reproduced. The document also contradicts itself:

- Lines 21–30 say the SQL mechanism was confirmed by the discriminating test.
- Lines 250 and 266–286 revert to “leading hypothesis,” “Cause: not yet established,” and instruct the next operator to run that already-completed test.

The user-facing/PostgREST cause remains explicitly unresolved even within the updated summary.

### 6. Other tests may contain hardcoded expectations that silently pass; this was not audited

**Verdict: CONFIRMED — the risk is real and material.**

Three spot checks:

1. **Migration execution list is stale.** `tests/postgres-rls.test.mjs:12` hardcodes migrations `001`–`021`, while the checkout contains `001`–`039`. The 172-pass result does not execute `022`–`039`, including publication isolation, lesson-activity policy changes, staff-case creation, signup, and guardian-add-learner migrations.
2. **Schema tests are mostly source-text sentinels and stop at `023`.** `tests/security-schema.test.mjs:5-28` references migration files only through `023`; later migration behavior can drift or fail while these regex checks remain green.
3. **A passing “demo plan” test describes a different artifact.** `tests/domain.test.mjs:15-21` hardcodes an eight-week, five-day, 160-lesson in-memory demo. It passes while the claimed live reviewer demo is four weeks, four days, and 16 lessons. The test is not proof of the current demo-plan claim and its generic name can be misread as such.

The duplicated 25-table privacy lists at `src/hosted-isolation.js:1-27` and `tests/postgres-rls.test.mjs:321` are another drift surface: later migrations are absent from the runtime database fixture, so the hardcoded list can remain green without enumerating current schema tables.

## Did only tests change?

**No, not in the evaluated working tree.** The assertion change itself is confined to `tests/staff-workspace.test.mjs`, but product code and migrations are also modified/untracked in the same producer state. There is no isolated commit proving provenance for the repair.

## Ranked defects and discrepancies

### Critical — core guardian lesson save is carried as unresolved

The Goal Record and defect artifact state that a signed-in guardian cannot persist lesson progress, notes, or rescheduling. That is a core daily-loop operation. The independent pass did not mutate production to reproduce it, but no verified fix exists and the green suite does not exercise the relevant later migrations or PostgREST boundary.

### High — green suite excludes 18 current migrations

The runtime database harness executes through migration `021`; the checkout reaches `039`. Passing 172 tests materially overstates confidence in current database behavior, especially signup and lesson activity.

### High — “only tests changed” lacks an isolated evidence boundary

The checkout has concurrent product changes and untracked migrations. The repaired assertions match the authority, but the producer state cannot support an only-tests claim.

### Medium — defect record is internally contradictory

The summary says the SQL discriminator is complete; the conclusion says it is not established and repeats the discriminator as the next step. A future operator could repeat risky production diagnostics or report the wrong cause status.

### Medium — live data and end-to-end signup remain unverified

The 16-lesson SQL and deployed signup UI are plausible and consistent with source, but the live rows and successful full signup journey were not independently observed.

## Goal Definition of Done assessment

| Requirement | Assessment | Independent evidence |
|---|---|---|
| REQ-001 — artifact identified and current live state recorded | **PARTIAL** | Artifact and HEAD identified. App and marketing returned HTTP 200; API root returned expected HTTP 404. Exact deployed revision, live demo rows, and authenticated state were not verified. |
| REQ-002 — tests run with recorded result | **MET** | Independently reproduced 172 pass / 0 fail / exit 0. Coverage limitation is recorded separately. |
| REQ-003 — independent evaluator verdict | **MET by this report, with a FAIL verdict** | Separate verifier reviewed the artifact, claims, tests, working tree, source, docs, and live static deployment evidence. |
| REQ-004 — final state recorded with evidence | **UNMET** | The Goal Record still marks final state unmet. This evaluation is not the canonical final-state update, and live-data/signup gaps plus the unresolved defect decision remain. |
| REQ-005 — known defects resolved or explicitly carried | **PARTIAL** | The lesson-save defect is documented and not hidden, but it is neither fixed nor subject to a completed fix-or-carry decision. The defect record itself is inconsistent. |

**Overall Definition of Done: PARTIAL / NOT MET.** Tests and independent evaluation now exist, but the final state is not recorded, the critical lesson-save issue is unresolved, and key live claims remain unverified.

## Strongest reason the work should fail

The strongest reason to **FAIL** is that the app's core guardian action—saving lesson progress—is carried as an unresolved blocker while the green test suite does not execute the migrations that govern that live path. A 172/0 count cannot compensate for an unproven core workflow and an incomplete current-schema test boundary.

## Recommended decision

Do not mark GOAL-2026-003 complete yet. Record this evaluator result, choose explicitly whether the lesson-save defect is fixed or carried, correct the contradictory defect record, and create a current-migration runtime gate before treating the green suite as evidence for the deployed beta.
