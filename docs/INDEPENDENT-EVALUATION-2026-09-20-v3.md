# Independent evaluation v3 — GOAL-2026-003 / REQ-003

**Artifact:** `/Users/Cameron/.openclaw/workspace/reviews/britelink-mvp` (remote `https://github.com/camster91/britelink-mvp.git`)
**Evaluated:** 2026-09-20 America/Toronto
**Evaluating run:** separate clean-context child run, not the producer (Mini).
**Clean checkout:** `/private/tmp/bl-req003-eval`, HEAD `9d68564` (detached, == `origin/main`), verified `git log --oneline -1` and `git status --short`.
**Authority:** Read-only. No commit, push, merge, deploy, publish, client contact, purchase, or permission change. The single live insert was inside `BEGIN`/`ROLLBACK`; row count unchanged (0). The only checkout mutation was running the test suite (no tracked file changed; `git status --short` remained `?? node_modules`).

## Headline verdict

**PASS — with one material, explicitly-carried limitation.**

All five prior objections are either **CLOSED** or **PARTIAL-with-the-gap-disclosed**. Migration 040 is now tracked in the canonical revision, all 40 migrations are tracked, a load-bearing regression test exists and was independently proven load-bearing by negative control, the live read-back fix is confirmed with an unchanged row count, and the Goal/defect documents are now internally consistent. The work should pass REQ-003 on the merits that prior evaluations actually failed it on.

The remaining limitations (migration-fixture coverage still 001–021; inlined debug policies still live; deployed revision not tied to a commit; live signup not exercised) are **real but are now correctly labeled** in the Goal Record and final-state record as carried, not closed. None of them is the defect that made v1/v2 fail.

## Evidence boundary

- Verified the clean checkout at `9d68564`: HEAD == `origin/main`, only `?? node_modules` untracked, all **40** migrations tracked (`git ls-files supabase/migrations/ | wc -l` → 40).
- Ran `npm test` and `node --test tests/lesson-activity-readback.test.mjs` in `/private/tmp/bl-req003-eval`; recorded exact totals and exit codes.
- Read `tests/lesson-activity-readback.test.mjs`, `tests/postgres-rls.test.mjs`, `tests/security-schema.test.mjs`, `tests/staff-workspace.test.mjs`, migration 040, the migration harness, and `src/service-domain.js`/`src/staff-workspace.js` transition authority.
- Ran an **independent negative control**: copied the readback test with migration 040 removed from its fixture list; the read-back assertion failed (2 tests / 1 pass / 1 fail), then removed the copy. Checkout left clean.
- Read the Goal Record, `LESSON-SAVE-DEFECT.md`, `PILOT-FINAL-STATE-2026-09-20.md`, and both prior evaluations (v1, v2).
- Re-verified live, read-only: HTTP status of all three hosts; live `pg_policies` for `lesson_activities`; live `lesson_activities` row count; and a transactional `INSERT ... RETURNING` as `authenticated` with the guardian JWT claims inside `BEGIN`/`ROLLBACK`.
- **Not verified:** live end-to-end PostgREST/JS-client `.upsert().select().single()` (only the SQL read-back path was exercised); live signup; the running deployment's exact revision; and `npm run test:migrations` (Docker unavailable on this host — see Verification-environment gap).

## Claim-by-claim verdicts

### 1. Migration 040 is tracked and a clean checkout reproduces production — CONFIRMED

`git rev-parse HEAD` = `git rev-parse origin/main` = `9d68564283a851a4ae0a84979290a1a3e3e8a018`. `git ls-files supabase/migrations/ | wc -l` = **40**. Commit `9d68564` ("chore(db): track migrations 024-040…") adds 16 files / 1852 insertions, and commit `20ef1bb` tracks migration 040 plus its regression test. A clean checkout now contains the fix. **Prior objection 1: CLOSED.**

### 2. A regression test protects the exact failure — CONFIRMED (independently proven load-bearing)

`tests/lesson-activity-readback.test.mjs` loads migration 040 explicitly (`"202608280040_lesson_activity_readback.sql"`, line 46) into a PGlite fixture and asserts:
- a guardian's `INSERT ... RETURNING id, status` returns exactly 1 row with the expected status;
- the same insert without `RETURNING` also succeeds;
- household B's guardian sees 0 rows (cross-household read blocked);
- household B's guardian's write into household A rejects with `/row-level security/i` (cross-household write blocked).

**Negative control (my own):** removing migration 040 from the fixture list turns the read-back assertion red (`ℹ tests 2 / ℹ pass 1 / ℹ fail 1`). The test genuinely depends on 040; it is not vacuously green. **Prior objection 2: CLOSED.**

### 3. The green suite covers the current migration path — NOT CLOSED (PARTIAL, and now honestly disclosed)

`tests/postgres-rls.test.mjs` still hardcodes migrations **001–021** (verified against the tracked HEAD content: 21 distinct `2026082800xx` ids). `tests/security-schema.test.mjs` names only 001–023. `npm test` is `node --test tests/*.test.mjs` and does **not** include `npm run test:migrations`.

However, the objection's original claim — "migration 040 has neither executed coverage nor a regression test" — is now **refuted**: 040 executes in the suite via `lesson-activity-readback.test.mjs`, which passes. The residual gap is 022–039 having no *fixture-applied* coverage. The Goal Record documents this accurately, including the deeper true shape (the RLS fixture creates only `authenticated`, while 022–040 reference `anon`/`service_role`, so a list edit breaks ~43 tests — a test-infrastructure change, not a list edit). **Prior objection 3: PARTIAL — narrower than before (040 now covered), broader gap explicitly carried.**

### 4. "Only tests changed" — OBJECTION NO LONGER APPLIES TO THE EVALUATED REVISION; PARTIAL

At the evaluated clean checkout `9d68564`, `git status --short` is `?? node_modules` only — the tracked tree is exactly HEAD. The prior objection was about the producer's *dirty working copy* (8 tracked mutations, ~50 untracked paths). That dirty copy still exists at `/Users/Cameron/.openclaw/workspace/reviews/britelink-mvp` (confirmed), so the "only tests changed" claim about that working tree remains unproven — but it does not affect the committed artifact's reproducibility. The commit `20ef1bb` is scoped to exactly 2 files (migration 040 + its test). **Prior objection 4: PARTIAL — immaterial to the committed revision.**

### 5. Goal/defect docs contradicted their own status — CLOSED

- `LESSON-SAVE-DEFECT.md`: opening now says RESOLVED 2026-09-20; the historical "Conclusion" section explicitly states "**Cause: the SELECT policy's plan gate, not the INSERT path**" and is labeled as the preserved historical record; the superseded diagnostic step is labeled "no longer needed… Preserved for history only." No live "not yet established" contradiction remains.
- Goal Record: Blockers and Gap sections show the fix/carry decision, repository control, and REQ-004 as struck-through/resolved with commit `20ef1bb`; REQ-005 `met`; REQ-004 `met`. No unresolved self-contradiction found. **Prior objection 5: CLOSED.**

### 6. `npm test` result and reproducibility — CONFIRMED WITH A DOCUMENTED SEQUENCE, PLUS ONE NEW INCONSISTENCY

Actual independent result in the clean checkout:

```text
command: npm test                        (node --test tests/*.test.mjs)
tests: 167
pass: 167
fail: 0
cancelled: 0
skipped: 0
todo: 0
exit code: 0
```

A **documented sequence does yield green**: in the clean checkout with a built `dist/` present (already built) and `node_modules` resolved, `npm test` is 167/167/0. A first run before those are satisfied fails for environmental reasons (dist/client/index.html missing for sites-worker; node_modules resolution), which is ordinary setup, not a defect.

**NEW INCONSISTENCY (Medium):** The Goal Record (REQ-002, Current Reality, Acceptance Evidence) and `PILOT-FINAL-STATE-2026-09-20.md` both record **"174 pass / 0 fail / exit 0"**, but the committed tree produces **167**. The 174 figure is unreproducible from the canonical revision. Root cause proven: the extra 7 tests come from `tests/staff-transitions.test.mjs`, which exists only as an **untracked** file in the dirty working copy (`git log --all -- tests/staff-transitions.test.mjs` → empty; not tracked at HEAD; 23 files in the working copy vs 22 tracked). The number 174 describes the producer's dirty workspace, not HEAD. This is the same tracking-hygiene class the pilot was corrected for.

### 7. Live read-back fix — CONFIRMED (read-only, transactional, row count unchanged)

Live catalog (`ssh coolify` → `docker exec britelink-production-db-1 psql -U postgres`):

```text
activities_guardian_insert | INSERT |
activities_guardian_update | UPDATE | (inlined EXISTS … AND updated_by = auth.uid())
activities_member_select   | SELECT | (is_household_member(household_id) AND ((activity_plan_id(id) IS NULL) OR can_read_plan(activity_plan_id(id))))
```

That SELECT expression is exactly migration 040's policy. Transactional probe under `SET LOCAL ROLE authenticated` with the guardian JWT claims:

```text
uid = acd728e9-94ee-4269-bc63-4803e770c785
own_household_member = t
INSERT ... RETURNING  ->  READBACK OK: b2103691-3a04-4e60-bd87-e7b87b723ff8   (INSERT 0 1)
visible_inside_txn = 1
ROLLBACK
total_after_rollback = 0
```

Row count before and after = **0**; no row persisted. The previously-failing read-back path succeeds. Cross-household blocking is proven by the fixture test, not re-run live here.

## Prior-objection resolution table

| # | Prior objection (v2) | Status | Evidence |
|---|---|---|---|
| 1 | Migration 040 untracked at HEAD; clean checkout cannot reproduce production | **CLOSED** | `9d68564 == origin/main`; 40 migrations tracked; `20ef1bb` scopes 040 + test (2 files) |
| 2 | No regression test protected the exact failure | **CLOSED** | `tests/lesson-activity-readback.test.mjs` loads 040 and passes; negative control (040 removed) → 1 fail |
| 3 | Green suite omitted 022–040 (`postgres-rls` hardcoded 001–021) | **PARTIAL** | 001–021 fixture gap remains (honestly documented); **040 is now exercised** by the readback test; gap shape (missing `anon`/`service_role`) correctly disclosed |
| 4 | "Only tests changed" unproven; product files differed | **PARTIAL** | Committed artifact is clean (`?? node_modules`); the dirty working copy still shows 8 modified + ~50 untracked. Immaterial to the evaluated revision |
| 5 | Goal/defect docs contradicted their own status | **CLOSED** | Defect doc cause section reconciled; Goal Blockers/Gap struck through as resolved |

**Resolved: 3 fully CLOSED, 2 PARTIAL** (both narrowed and now disclosed rather than concealed). Objection 3's *narrower* form (022–039 uncovered) remains open by design.

## New defects

### Medium — recorded suite total (174) does not match the canonical revision (167)
As above. The Goal and final-state record both state 174 pass; HEAD reproduces 167. The 7-test delta is `tests/staff-transitions.test.mjs`, untracked at HEAD. This is a fresh instance of the tracking-hygiene problem, in documentation rather than in the migration chain. **Mitigation:** reconcile the recorded number to 167, or track `staff-transitions.test.mjs`.

### Low — temporary diagnostic migration 039 is tracked and flagged for removal
Commit `9d68564` adds `202608280039_diagnose_identity.sql` and its message says "039 is a temporary diagnostic and is flagged for removal once its diagnosis is complete." Live check: `diagnose_caller_identity` → **0 rows** (function dropped live). A dead diagnostic migration is now tracked but not applied; harmless, but it should be removed or explicitly retained with intent.

### Low — inlined debug INSERT/UPDATE policies still live and unexplained by 040
Live `activities_guardian_insert` / `activities_guardian_update` are the inlined investigation variants. No migration in the tracked chain is shown to re-establish the intended policy text; 040 only touches SELECT. Carried as "open decision" in the final-state record, which is acceptable disclosure, but the live INSERT/UPDATE policy source is not reproducible from a specific migration — a reproducibility gap of the same class, one level down.

### Low — deployed revision not tied to a commit (carried)
Confirmed still true: live hosts respond, but nothing links the running image to `9d68564`. Carried in the final-state record.

### Info — verification-environment gap
`npm run test:migrations` cannot run here: `docker info` fails ("docker UNAVAILABLE") and the harness reports `FAIL: postgres:16-alpine is not present and could not be pulled. On an air-gapped host, preload the image instead.` This is an environment limitation, not evidence that any migration is invalid. The full-chain local applicability of 022–040 remains independently unverified by this pass.

## Definition of Done assessment

| Requirement | Assessment | Independent evidence |
|---|---|---|
| REQ-001 — artifact identified and live state recorded | **MET** | Artifact at HEAD `9d68564`; live hosts HTTP 200/200/404-at-root (expected); containers present per record. Deployed-revision linkage still not established (carried). |
| REQ-002 — test suite run with recorded result | **MET, with a correctable number** | Independently reproduced **167 / 167 / 0 / exit 0** from the canonical checkout. Recorded "174" describes the dirty workspace; see Medium defect. |
| REQ-003 — independent evaluator verdict | **MET by this report — PASS** | Third adversarial evaluation, separate clean-context run, stored here. |
| REQ-004 — final state recorded with evidence | **MET** | `PILOT-FINAL-STATE-2026-09-20.md` exists, dated, links artifact/tests/both prior verdicts, and explicitly carries open defects. It is a status record, not an inflated completion claim. |
| REQ-005 — known defects resolved or explicitly carried | **MET** | Lesson-save defect resolved by tracked migration 040 + load-bearing regression test; coverage gap, policy-adoption question, and unverified flows explicitly carried in the record. |

**Overall Definition of Done: MET** (with carried, disclosed limitations).

## The single strongest reason the work should fail

**The recorded test result (174 pass) is not reproducible from the canonical revision, which yields 167; the 7-test delta is an untracked test file (`tests/staff-transitions.test.mjs`).**

This is the strongest *honest* reason to withhold a clean pass, because it is the exact class of defect that failed this pilot twice — a green number that does not describe the committed artifact. It is **not**, however, grounds for FAIL: the delta is an under-count relative to reality (the committed tree is *smaller* and still entirely green), the untracked file is not required by the committed suite, and the substantive prior failures (untracked migration, no regression test) are closed. It is a documentation-accuracy defect to reconcile, not a hidden failure.

The next-strongest reason — that the RLS fixture only applies migrations 001–021, so 022–039 have no fixture-executed coverage — is real but is explicitly disclosed in the Goal Record and final-state record, and migration 040 *is* now covered. It does not meet the bar for FAIL.

## Recommended decision

**Accept REQ-003 as MET with a PASS verdict, and mark GOAL-2026-003's Definition of Done satisfied**, subject to two cheap reconciliations before the final state is frozen:

1. Correct the recorded suite total from **174 → 167**, or track `tests/staff-transitions.test.mjs` so the number becomes meaningful at HEAD (preferred if the file is intended to remain part of the suite).
2. Record the 022–039 fixture-coverage gap, the live inlined-policy source-of-truth question, and the 039 diagnostic's removal as explicit carried items (already largely done — confirm they survive the number fix).

No production mutation, deploy, merge, or client contact is required or authorised by this report. Any such action remains separately approval-gated.
