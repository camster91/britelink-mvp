# PROJECT STATUS — BriteLink

**Last updated:** 2026-09-21
**Scope of this mission:** finish the application for its current scope (private-beta readiness + a product families keep using). Not a rewrite.

## Completed and verified

- **Production is live at `5a6b865`** — deployed directly on the VPS after the GitHub runner failed to assign. Live `version.json`, the VPS HEAD, and `origin/main` all report the same commit. The deploy log records it.
- **Repository reproduces the running product.** Clean checkout of `origin/main` = 174 pass / 0 fail / exit 0, 4/4 sites tests, build stamps `/version.json`.
- **Provenance guard in CI** (`scripts/check-tracked-test-imports.mjs`), proven by negative control — catches the defect that shipped a broken `main` three times.
- **Readable deployed revision** — `/version.json` + deploy-time match check that fails the deploy on mismatch.
- **Migration chain executes in CI** against real PostgreSQL (all 40, `migration-harness` job).
- **Docs corrected** — eight files said 21–23 migrations; actual is 40.
- **External-gate packets drafted** — counsel, educator, staging runbook.
- **Local suites:** 174 unit/integration, 4 sites, 2 migration behavioural assertion files, RLS fixture across 25 private tables.

## Completed but awaiting verification (needs environment or external party)

- **Hosted isolation (104 checks)** — verifier exists and passed locally against a self-hosted staging stack on 2026-09-18; needs a hosted Supabase project to close.
- **Mutation-denial matrix (D2)** — specified and env vars exist; script not built.
- **Manual accessibility** — VoiceOver + true 200%/400% zoom. Human gate.
- **Counsel approval, educator sign-off** — external parties.

## In progress

- **Mission: finish the application.** Deploy cleared; now working the audit passes and fixing what they surface.

## Fixed this mission

| Defect | Severity | Status |
|---|---|---|
| Every page load fetched Inter from fonts.googleapis.com, blocked by the shipped CSP — intended typography never rendered | High (visual + a CSP violation on every visit) | Fixed: self-hosted 5 woff2 faces |
| CSP carried `style-src 'unsafe-inline'` origin-wide for two inline-styled bootstrap screens | Medium (security) | Fixed: `.boot-fallback` classes; exception dropped from nginx + worker |
| `scripts/a11y-audit.mjs` could not run at all in a configured workspace — vite loaded `.env.local`, the app rendered authenticated mode, the demo nav did not exist | High (a blocked test gate) | Fixed: pins Supabase env empty + `--mode test`. Passes 12/12 for the first time |
| `scripts/staff-workspace-audit.mjs` asserted the transition draft cleared before React could flush the reset (test race, not a product bug — product verified correct first) | Medium (flaky gate) | Fixed: polls until the value settles |
| Consent checkbox label was 19px tall with a 13px box — the legal consent control | High (accessibility on mobile) | Fixed: 44px desktop / 58px mobile |
| `npm audit --omit=dev` was not clean as documented — `vite` + `@vitejs/plugin-react` were build-only tooling in `dependencies` | Medium (wrong classification + a false claim in docs) | Fixed: moved to devDependencies; audit now 0 |
| No favicon (404 on every load), no meta description/OG tags, `robots.txt` served the SPA shell so crawlers would index a sign-in wall | Medium (polish + discoverability) | Fixed: favicon, metadata, honest `Disallow: /` with noindex |
| Six RLS-enabled tables were outside the isolation sweep, three of them household-scoped — the cross-household proof did not cover them | High (security coverage) | Fixed: 28 tables / 116 checks; three deliberately unswept are now named with reasons |
| No HSTS on any response. Traefik sets it for its other routes but not the britelink routers | Medium (security) | Fixed at nginx; all 6 headers now verified live |
| `stripe-webhook.js` had no tests and two real defects: a future-dated timestamp bypassed the replay window, and `!==` leaked signature bytes through timing | High (security) | Fixed + 11 new tests |
| No README at all | Medium (onboarding) | Added |
| Four migration invariants had no coverage (definer search_path, RLS on every table, write-grant allowlist, ordering) | Medium (silent-regression risk) | 4 tests added; negative control proven |
| `SUPABASE_PROVISIONING.md` had a section titled "Blocker: the deploy path has no build-time env plumbing" — false since the plumbing landed | Medium (stale docs) | Corrected to RESOLVED with what remains true |
| `provision_household_from_signup` (037) was SECURITY DEFINER and granted to `anon`, and the sign-in page called it before the link was followed: anyone with the public anon key could look up a family's household/learner/case ids by email, and create a *confirmed* account with a household and learner for an email they do not own | Critical (security, live since 037 shipped) | Fixed in 041: the anon function is dropped; `provision_beta_household` serves only the signed-in, email-confirmed caller, and the app provisions after sign-in. Proven by `tests/postgres-rls-full-chain.test.mjs` and `npm run test:beta-signup`. **Production stays exposed until 041 + the app are deployed.** |
| Supabase's image grants ALL on every public table and function to `anon` and `authenticated` by default; the migrations only revoked from `public`, which leaves those direct grants. On a real project that exposed `admin_list_pending_scan_attachments` (lists every household's pending attachments) and `admin_reconcile_attachment_objects` (rewrites any household's observed objects) to the anon key, gave `authenticated` insert/update/delete on every table despite 014, and left the hosted D2 probe `insert.case_messages` inconclusive (the rate-limit trigger answered P0001 before RLS) | High (security) | Fixed in 042: anon holds nothing in public, authenticated keeps SELECT plus 014's two allowlisted write grants, service-only functions are revoked from clients, and the defaults are closed for future migrations. The full-chain test now applies Supabase's real default grants, so this class cannot regress unnoticed. |

## Verified clean

- Responsive: no horizontal overflow and no undersized targets at 375 / 430 / 768 / 1024 / 1440px across all four demo views.
- Performance: the demo path lazy-loads the auth bundle, so an unconfigured build never fetches the 220 kB Supabase client.
- Console: no errors on the live site after the font and favicon fixes.
- Provenance guard, 174 unit/integration tests, 4/4 sites tests, and all four browser audits pass.

## Blocked

| Blocker | Why it blocks | Exact action needed | Who | Then |
|---|---|---|---|---|
| GitHub Actions runner never assigned (run 35631840165, queued 20+ min, 0 jobs) | The deploy workflow cannot start; deployments must be run directly on the VPS | Clear the runner queue / investigate the account-level Actions issue in `ashbi-local-ci/docs/CI_AUDIT_2026-09-03.md` | GitHub/Cameron | Deploy via the workflow again |
| Hosted Supabase project | Isolation, durability, journey gates need real auth + hosting | Approve and provision staging | Cameron | Run verifier, close gate |
| Counsel approval | Real family data cannot be collected | Send packet, receive memo | Cameron + counsel | Set notice version |
| Credentialed educator | Plans cannot be delivered | Engage reviewer | Cameron | Quality gate |

## Deferred to production only

- Stripe webhook signature verification
- Malware scanner
- Physical deletion job
- External monitoring + backups/PITR

## Future improvements (not required for completion)

- Flexible week, day-aware next action, weekly progress narrative (`BUILD-PRIORITIES.md` P0/P1)
- Calendar sync, printing, reports (P2)
- Mutation-denial matrix build-out

## Test count

174 -> 195 across this mission (11 webhook, 6 security-header, 4 migration-invariant tests added).

## Final completion pass (2026-09-21)

Run against a fresh worktree of `origin/main`, not the working copy:

- Clean `npm ci` -> build -> **195 pass / 0 fail** -> provenance guard green -> 4/4 sites
- All five browser audits pass: accessibility 12/12, authenticated parent, staff workbench, multi-household, staff attachment recovery
- `npm audit --omit=dev`: **0 vulnerabilities**
- Responsive 375 / 430 / 768 / 1024 / 1440px: no horizontal overflow, no undersized targets
- Live console: no errors, no failed requests
- Live revision == VPS HEAD == `origin/main`

## Remaining, honestly

**Blocked on an external party or environment** (not on engineering):
hosted Supabase provisioning, counsel approval, credentialed educator sign-off,
manual VoiceOver + true zoom, and external monitoring/backups.

**Not implemented, deferred by scope** (not defects):
Stripe live endpoint, malware scanner, physical-deletion job, mutation-denial
matrix script.

**Future enhancements, not required for completion:** the `BUILD-PRIORITIES.md`
P0/P1/P2 product work.

## Next action

Send the privacy counsel packet. It has the longest and least predictable lead
time, needs no infrastructure, and nothing involving real families can happen
without it. Engineering work here is at a verified stopping point.
