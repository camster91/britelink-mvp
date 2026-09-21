# Independent evaluation v2 — GOAL-2026-003 / REQ-003

**Artifact:** `/Users/Cameron/.openclaw/workspace/reviews/britelink-mvp`  
**Evaluated:** 2026-09-19 America/Toronto / 2026-09-20 UTC  
**Checkout HEAD:** `c805455e87f6a0c53efdaea3bab12bcfb08a30d1` (`main`, `origin/main`)  
**Authority:** Read-only evaluation except the requested report and transactionally rolled-back live insert. No deployment, publication, merge, client contact, or persistent production data change.  
**Headline verdict:** **FAIL — the live SQL defect is fixed, but the critical migration is untracked and untested, the green suite still omits the current migration path, and the Goal's final state is not recorded.**

## Evidence boundary

- Read the prior failed evaluation, Goal Record, full defect record, migration 040, relevant tests, migration harness, and current working-tree diff.
- Queried the live `lesson_activities` policies through `ssh coolify` and `britelink-production-db-1`.
- Reran the previously failing raw-SQL `INSERT ... RETURNING id` as `authenticated` with the specified JWT claims inside `BEGIN`/`ROLLBACK`.
- Ran `npm test` independently.
- Attempted the separate throwaway-database migration harness. It stopped before starting a container when Docker image inspection/pull failed; a final Docker check showed the local Docker API was unavailable.
- Did not exercise the exact PostgREST/Supabase client request, signup, live demo-plan contents, or deployed revision.

## Claim-by-claim verdicts

### 1. Migration 040 fixes lesson-activity read-back while preserving household isolation

**Verdict: CONFIRMED for the migration, live policy, and requested raw-SQL reproduction. The exact PostgREST path was not independently verified in this pass.**

Repository evidence:

- `supabase/migrations/202608280040_lesson_activity_readback.sql:25-35` drops and recreates `activities_member_select` as:

```sql
is_household_member(household_id)
and (
  activity_plan_id(id) is null
  or can_read_plan(activity_plan_id(id))
)
```

- The outer `is_household_member(household_id)` remains mandatory. The migration therefore widens only the plan-link branch for a row in the caller's own household.

Live catalog evidence:

- `pg_policies` returned exactly three policies: `activities_guardian_insert`, `activities_guardian_update`, and `activities_member_select`.
- The live SELECT expression was exactly:

```text
(is_household_member(household_id) AND ((activity_plan_id(id) IS NULL) OR can_read_plan(activity_plan_id(id))))
```

- Under the requested guardian identity, `is_household_member` was `true` for the target household and `false` for another existing household. The outer guard therefore continued to reject the sampled cross-household case.

Requested reproduction:

```text
current_user=authenticated
auth.uid()=acd728e9-94ee-4269-bc63-4803e770c785
own_household_member=true
INSERT ... RETURNING id -> d17e207c-9c1b-4000-a916-330f55e640cc
INSERT 0 1
rows_visible_inside_transaction=1
ROLLBACK
lesson_activities_total_after_rollback=0
```

The table also contained 0 rows before the test. No row from this evaluation persisted.

Limit: this proves the raw PostgreSQL path that previously failed. It does not independently prove the producer's stronger claim that the exact PostgREST `.upsert(...).select().single()` request succeeds.

### 2. `npm test` passes 172 / 0 with exit 0

**Verdict: CONFIRMED.**

Actual independent result:

```text
command: npm test
node: v26.5.0
npm: 11.17.0
tests: 172
pass: 172
fail: 0
cancelled: 0
skipped: 0
todo: 0
exit code: 0
duration reported by node:test: 12161.227209 ms
```

The two repaired assertions in `tests/staff-workspace.test.mjs` passed and match `CASE_TRANSITIONS` for `drafting` and `submitted`.

### 3. The green suite now covers the current migration path, including migration 040

**Verdict: REFUTED.**

- `package.json:13` defines `npm test` as only `node --test tests/*.test.mjs`.
- `tests/postgres-rls.test.mjs:12` still hardcodes migrations `001`-`021`. Its test named “all migrations execute in PostgreSQL” therefore omits `022`-`040` — now 19 migrations — including publication isolation, split lesson policies, signup, guardian add-learner, and migration 040.
- `tests/security-schema.test.mjs:5-28` statically names only migrations `001`-`023`.
- No test or assertion references `202608280040`, `lesson_activity_readback`, or the new `activity_plan_id(id) IS NULL` branch.
- `tests/supabase-repository.test.mjs:129-134` supplies a mock success response and checks only the outgoing activity fields. It cannot observe PostgREST or RLS behavior.

A separate script, `npm run test:migrations`, globs every migration and would at least apply 040 to throwaway PostgreSQL. It is not part of `npm test` and contains no targeted lesson-readback assertion. This evaluation attempted it, but it exited 1 before applying anything:

```text
postgres:16-alpine is not present locally, pulling it
FAIL: postgres:16-alpine is not present and could not be pulled.
```

That is the harness's message. A final `docker ps` check failed to connect to `/var/run/docker.sock`, so the verified underlying environment issue is an unavailable Docker API, not proof that the image itself is absent. The script failed before its `docker run` step.

Therefore migration 040 has neither executed coverage in the reported 172-test suite nor a dedicated behavioral regression test. Full-chain local migration applicability was not verified by this run.

### 4. Only tests changed

**Verdict: REFUTED.**

At the evaluated HEAD, `git status --short` showed:

- 8 tracked modified files, only one of which is the repaired test;
- 7 other tracked modifications in `index.html`, `package-lock.json`, a migration-harness verifier, and four production source files;
- a tracked diff of **203 insertions and 64 deletions**;
- 48 untracked paths, including migrations `024`-`040`, product scripts, docs, and `tests/staff-transitions.test.mjs`.

Migration 040 itself is untracked while HEAD equals `origin/main`. There is no isolated commit or patch proving an “only tests changed” producer boundary.

### 5. Other passing tests may encode stale or misleading expectations

**Verdict: CONFIRMED as a material risk; three spot checks produced mixed results.**

1. **Misleading/stale migration boundary:** `tests/postgres-rls.test.mjs` says “all migrations execute” but hardcodes only `001`-`021`. It passes while omitting 19 current files.
2. **Good dynamic guard:** `tests/staff-transitions.test.mjs:20-90` compares UI-offered transitions to `CASE_TRANSITIONS`, checks reachability to `closed`, and checks terminal states. This is stronger than another duplicated fixed array, although the file itself is untracked.
3. **Mocked lesson-save blind spot:** `tests/supabase-repository.test.mjs:129-134` verifies outgoing fields against a mock that already returns success. It does not verify `.select().single()` against PostgREST or any RLS policy, so it remained green through the live 42501 defect.

The previously noted `tests/domain.test.mjs:15-21` eight-week/160-lesson demo assertion is internally consistent with `src/domain.js`; it is not stale against that in-memory function. It is simply not evidence for the separate live four-week/16-lesson demo dataset.

## Prior failure reasons — resolution status

| Prior reason | Current status | Evidence |
|---|---|---|
| Core guardian lesson save was unresolved | **Resolved for the requested live raw-SQL `RETURNING` path** | Live policy matches 040; authenticated insert returned an ID; rollback left 0 rows. Exact PostgREST path not independently rerun. |
| Runtime tests omitted migrations `022`-`039` | **Not resolved; gap expanded through `040`** | PGlite fixture still hardcodes `001`-`021`; 040 has no targeted behavioral test. |
| “Only tests changed” was false/unproven | **Not resolved** | 8 tracked modified files and 48 untracked paths; no isolated repair commit. |
| Defect record contradicted itself | **Not resolved** | Its opening says “RESOLVED,” but its conclusion still says “Cause: not yet established” and repeats the obsolete diagnostic step. |
| Live demo data and end-to-end signup were unverified | **Not reevaluated / not verified** | Outside the five requested changed claims; no signup or demo-data mutation was performed. |
| Final state was not recorded | **Not resolved** | Goal remains `active`; REQ-004 is still marked `unmet`. |

## New defects and discrepancies

### High — the live critical fix is absent from the canonical repository revision

Migration 040 is untracked at a HEAD identical to `origin/main`. The live database contains its policy, but a clean checkout cannot reproduce that fix. This is a delivery and recovery defect even though current live behavior passed the transactional probe.

### High — no regression test protects the exact failure

No automated test performs a new guardian activity insert with `RETURNING` under the post-040 policy, and the reported `npm test` suite does not load migration 040. The exact bug can recur while 172 tests remain green.

### Medium — goal and defect documents disagree with their own current status

- The Goal marks REQ-005 `met` and says the defect is resolved, but its Blockers section still asks Cameron for a “fix or carry” decision.
- The defect document says `RESOLVED` at the top but concludes “Cause: not yet established” and prescribes a diagnostic already completed.

### Verification environment gap

The separate all-migrations harness could not run because the local Docker API was unavailable; it failed during image inspection/pull before starting a container. This is a verification blocker, not evidence that migration 040 itself fails; the live catalog proves the policy exists and the requested live insert succeeds.

## Goal Definition of Done assessment

| Requirement | Assessment | Independent evidence |
|---|---|---|
| REQ-001 — artifact identified and current live state recorded | **PARTIAL** | Artifact, HEAD, live policy, and live empty activity table were observed. The deployed app revision is still not tied to a commit, and the live critical migration is absent from HEAD. |
| REQ-002 — tests run with recorded result | **MET** | Independently reproduced 172 pass / 0 fail / exit 0. Coverage limitations are recorded separately. |
| REQ-003 — independent evaluator verdict | **MET by this report, with a FAIL verdict** | Second independent adversarial evaluation completed and stored. |
| REQ-004 — final state recorded with evidence | **UNMET** | Goal remains active and explicitly marks REQ-004 unmet. This report is evaluator evidence, not the canonical final-state update. |
| REQ-005 — known defects resolved or explicitly carried | **PARTIAL** | The requested live SQL path is fixed and rollback was proved, but the fix is untracked, lacks regression coverage, and closure documentation is contradictory. Exact PostgREST behavior was not independently rerun. |

**Overall Definition of Done: PARTIAL / NOT MET.**

## Strongest reason the work should still fail

The strongest reason to **FAIL** is that the critical live fix exists only as an untracked migration outside the canonical repository revision and is not exercised by the reported test suite. A clean checkout at `origin/main` cannot reproduce the live authorization state, and the same 172-test result would remain green if the fix disappeared. REQ-004 is also explicitly unmet.

## Recommended decision

Do not mark GOAL-2026-003 complete yet. First place migration 040 and its relevant migration chain under repository control, add a behavioral regression that executes the authenticated new-row `RETURNING` path while proving cross-household denial, run the all-migrations harness in a working environment, reconcile the contradictory Goal/defect text, and then record the final state. Any commit, merge, deployment, or Goal mutation remains separately approval-gated.
