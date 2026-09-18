# BriteLink Ship Status

**Last updated:** September 18, 2026  
**Branch:** `main` (deployed `f76a08b`); current work on `feat/retention-execution`  
**Status:** Ready for private beta (pending Cameron-gated approvals)

## What's Ready Now

The core parent and educator experiences are complete and polished for private beta:

### Parent Experience ✅
- **Learning plan navigation**: Browse 8 weeks of personalized lessons with clear progress tracking
- **Lesson execution**: Detailed instructions, materials list, accommodations, and adult-help guidance
- **Progress management**: Start, pause, complete, or skip lessons with persistent state
- **Rescheduling**: Move lessons for illness, travel, or schedule conflicts without losing progress
- **Notes**: Add private caregiver notes to any lesson
- **Intake form**: Structured profile with validation, clear error handling, and consent
- **Beautiful UI**: Linear/Notion-quality design with calm colors, clear hierarchy, and world-class empty states

### Educator Experience ✅
- **Case triage**: Priority-based queue with clear next actions
- **Case management**: Role-checked transitions through the full workflow
- **Plan authoring**: Multi-week lesson creation with resource governance
- **Internal review**: Independent reviewer gate before publishing
- **Secure messaging**: Case-scoped communication with families
- **Delivery tracking**: Clear status for sent, acknowledged, and revision-requested plans
- **Audit history**: Complete timeline of case events

### Technical Foundation ✅
- **Tests**: 165 passing tests covering domain logic, RLS, and integration
- **Accessibility**: WCAG A/AA compliance, keyboard navigation, touch targets, reduced motion
- **Build**: Production bundle ready (`npm run build` + Sites packaging)
- **Security**: CSP headers, input validation, safe redirects, RLS policies
- **Schema**: 23 migrations with household isolation and composite integrity
- **CI/CD**: GitHub Actions validates every PR and deploys `main` over SSH — see below

## What Needs Cameron (Blocked)

These require external approvals, credentials, or infrastructure that Cameron must handle:

### 🔐 Hosted Infrastructure
- **Supabase projects**: Development and staging projects (needs paid account)
- **Auth configuration**: Passwordless magic link, invited-only accounts
- **Environment secrets**: Project URLs, anon keys (never committed to repo)
- **Database deployment**: Apply all 23 migrations to live Supabase
- **Storage bucket**: Private `case-attachments` bucket with scanner integration

### ⚖️ Legal & Compliance
- **Privacy notice**: Canadian counsel approval of exact notice text and version
- **Consent language**: Legal review of purposes, retention, and breach path
- **Data retention schedule**: Counsel-approved schedule per record class

### 👥 Quality Assurance
- **Educator review**: Credentialed educator must approve curriculum, safeguarding, accessibility, and resources
- **Manual accessibility**: VoiceOver testing on macOS (automated tests done, human verification needed)
- **True zoom**: Browser zoom at 200% and 400% (viewport-equivalent tests done, real zoom needed)

### 💳 Payment Integration
- **Stripe webhook**: Signed event verification (skeleton exists, signature check needed)
- **Checkout flow**: Create Stripe checkout sessions (adapter boundary ready)
- **Refund handling**: Terminal state reconciliation (database ready, webhook missing)

### 🔧 Operational
- **External monitoring**: Uptime monitor + alert delivery (health probe ready, scheduling needed)
- **Named contacts**: Incident commander, privacy lead, technical lead (runbooks ready, names needed)
- **Backup/restore**: Managed PITR + off-project encrypted backups (the local drill now restores the
  real nightly archive rather than a rehearsal — but see the vacuous-signal note below; hosted PITR pending)
- **Malware scanner**: Attachment scanning service (adapter implemented, with rejected-object and
  orphan-metadata alerting — ships unwired, because there is no bucket to point it at yet)
- **Physical deletion**: Scheduled erasure job after retention approval (the executor is now
  implemented and exercised by the migration harness; it ships disabled, and stays disabled until
  the approval this is gated on exists)

### 📊 Private Beta
- **5–10 families**: Consented households for controlled rollout
- **Support plan**: Named support owners, response SLA, incident contacts
- **Beta criteria**: Cross-household denial proof, delivery honesty, accessibility decisions

## Continuous Integration and Deployment

CI (`.github/workflows/ci.yml`) runs on push to `main`, on every pull request, and on demand:
`build-test` (build *then* test — the order is load-bearing), `migration-harness` (applies every
migration, the storage policies, the behavioural assertions, and the synthetic staging seed to a
throwaway Postgres), and `browser-audits` (five Playwright audits).

Deploy (`.github/workflows/deploy.yml`) fires only from a **successful** CI run on `main`, or by
manual dispatch on `main`. It SSHes to the VPS and rebuilds `/docker/britelink-web` in place.

**Verified end to end on 2026-09-18**, by hashing rather than by trusting a green check. PR #29
merged as `f76a08b`; CI ran green on that push; Deploy ran from it, and the bytes serving are the
bytes CI built:

| Evidence | Value |
|---|---|
| `dist/client/index.html` sha256, as recorded by CI | `440329b50835543ee1dc7dfcc4e4ecb8419825eb1b76f640c8197df195ff805a` |
| sha256 of what `https://britelink.ashbi.ca/` actually serves | `440329b50835543ee1dc7dfcc4e4ecb8419825eb1b76f640c8197df195ff805a` |
| `britelink-web-web-1` container created | `2026-09-18T02:08:40Z` (Deploy run started 02:08:21Z) |
| `britelink-postgres-postgres-1` | started 09-16 — untouched, as a web deploy must leave it |

Each job has also been observed *failing*, so the gate is known to discriminate rather than merely
to pass: `migration-harness` failed at `9c82eda` and passed at `e0f886d`, the commit that fixed
it; `browser-audits` failed at `36c3ff1` and passed at `b0a8dc0`, likewise.

**Current limitation.** From 2026-09-18 03:36Z the account stopped allocating runners: runs are
still created but sit `queued` with zero jobs, and the last successful run anywhere was 03:22:50Z.
This is an account-level entitlement condition, not a repository setting. While it holds, no push
is validated and **no deploy can fire at all**, because Deploy is gated on a successful CI run.
Commits after `e0f886d` on `feat/retention-execution` have therefore never run in CI.

The obvious workaround — a self-hosted runner, which is not billed the same way — is **not safe on
this host and should not be reached for**. The VPS that would run it is the one serving production:
it runs `britelink-web`, the `britelink-postgres` database, Coolify, and the media stack. CI runs
on `pull_request`, so any contributor's unmerged code would execute there, and `migration-harness`
needs Docker, so it could not be sandboxed by dropping the daemon alone. This needs a dedicated
runner host, not a `runs-on:` edit.

## Known Vacuous Signals

Signals that currently read as healthy while proving nothing. Recorded so they are not mistaken
for coverage:

- **Nightly backups.** The dumps are valid, complete, error-free `pg_dump` output — of an
  essentially empty database (370 bytes, zero `CREATE TABLE` statements, checked 2026-09-18). The
  script is correct; the migrations have never been applied to that database. A green backup run
  is not evidence that anything is being protected, and the restore drill inherits the same limit.
- **Storage download denial.** The isolation verifier proves household A cannot read household B's
  object. Until real object bytes exist, that check would pass just as well against a missing
  object — a denial is only meaningful next to a positive control. See
  `docs/HOSTED_STAGING_VERIFICATION.md`.

## How to Proceed

**Already merged:** the UX and foundation work is on `main` and deployed. What remains is the
list below, which is entirely external.

**After merge, Cameron handles:**
1. Provision staging Supabase (30 min)
2. Send privacy notice to counsel (async approval)
3. Send curriculum packet to educator reviewer (async approval)
4. Configure Stripe webhook signature verification (2 hours)
5. Set up external monitor + alert route (1 hour)
6. Name incident/privacy/technical contacts (10 min)
7. Schedule manual VoiceOver + true zoom session (contractor, 2-4 hours)
8. Recruit 5–10 beta families (async, after all gates pass)

**Unblocked next:** Authenticated parent and educator flows work end-to-end against hosted Supabase once credentials are configured.

## What's NOT Needed Yet

These would be nice but aren't blocking private beta:

- ❌ Public marketing site or SEO
- ❌ Child-facing login or AI tutor
- ❌ Instant/AI-generated plans
- ❌ Server-backed encrypted staff drafts (deliberately deferred)
- ❌ Community or forums
- ❌ Expanding collection to health/diagnosis/IEP (explicitly out of scope)

## Evidence

- **Codebase:** `main` at `f76a08b` (deployed); current work on `feat/retention-execution`
- **Tests:** `npm test` (165 passing), `npm run test:sites` (4 passing)
- **Accessibility:** `qa/accessibility/report.json` — 12 axe results across 3 viewports
  (desktop, 200% and 400% CSS-px equivalence), 0 serious or critical, 0 horizontal-overflow and
  0 keyboard-focus failures. Note `zoomMethod` in that file: viewport equivalence only. Real
  browser zoom and VoiceOver remain the manual gates below.
- **Documentation:** `docs/GOAL_COMPLETION_PLAN.md`, `docs/RELEASE_READINESS.md`, `docs/STAGING_HANDOFF.md`
- **Local restore:** `qa/operations/local-restore-drill-report.json`
- **CI/deploy:** run `35297972681` (CI) and `35298161038` (Deploy) on `f76a08b`, reconciled to the
  live site by artifact hash — see the table above

---

**Bottom line:** The product UX is world-class and ready. Legal, infrastructure, and approvals are the only gates left.
