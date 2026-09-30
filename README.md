# BriteLink

Educator-authored learning plans for homeschool families, delivered through a private workspace.

Parents get a personalised plan their educator wrote and a place to run it day to day. Educators get a
case workbench with an independent review gate. Nothing is AI-generated: every plan is authored and
reviewed by a person, and the software enforces that separation.

**Status: private beta, invited accounts only.** Not open for public signup, not handling real family
data yet. See [Current state](#current-state) before assuming any capability is live.

---

## What it does

**For families**
- Intake that captures structured planning context (never diagnosis, health, school, or address)
- A multi-week plan with lessons, materials, adaptations, and honest adult-help estimates
- Lesson execution: start, pause, complete, skip, reschedule, and notes
- Secure case-scoped messaging with attachments
- Export, correction, and deletion requests that go through a reviewed path

**For educators and administrators**
- A priority-ordered case queue with SLA awareness
- Case lifecycle: intake → triage → assign → author → review → publish → deliver → revise
- Plan authoring with governed resources
- An independent review gate: **the author of a plan cannot approve it**, enforced in the database
- Delivery tracking, revision re-delivery, and exception handling

## Architecture

A React single-page app with a PostgreSQL backend that does the security work. There is no bespoke
application server in the beta path: the browser talks to Supabase (PostgreSQL + Auth + private
object storage) under row-level security.

```
Browser (React 19 / Vite)
   │  anon key, never a service key
   ▼
Supabase  ──  PostgreSQL with RLS on all 25 private tables
          ──  Auth (passwordless magic link, invited accounts only)
          ──  Private bucket (case attachments, quarantined on upload)
```

**Authorization lives in the database, not the UI.** Every private row carries a household id, and
PostgreSQL row-level security decides visibility. Sensitive writes go through `SECURITY DEFINER`
functions rather than direct table access. A frontend permission check is treated as a convenience,
never as the control.

For the web tier: nginx serves the built SPA. The Content-Security-Policy names its API origin by
deriving it from the same build arg that configured the bundle, so the policy and the code cannot
disagree about where the API lives.

### Layout

| Path | What lives there |
|---|---|
| `src/` | Application code. `App.jsx` is the interactive demo; `AuthenticatedApp.jsx` is the real one |
| `supabase/migrations/` | 40 migrations, numbered and ordered. The schema's source of truth |
| `tests/` | 185 tests (`node:test`) covering domain logic, RLS, security schema, and repository behaviour |
| `scripts/` | Browser audits, migration harness, deploy helpers |
| `docs/` | Operational runbooks, release ledgers, research, and the plan to launch |
| `worker/` | Optional edge worker for the hosted-assets deployment path |

## Local setup

**Prerequisites:** Node 22.12 or newer. This is not a preference — it is the intersection of what the
dependencies declare, and CI runs Node 22.

```bash
npm ci          # install exactly the lockfile
npm run dev     # dev server on http://localhost:5173
```

With no environment configuration, the app runs the **interactive demo**: fictional family data,
changes kept in this browser only, and a banner saying so. This is the default and it is honest —
an unconfigured build never claims live status.

### Environment variables

Copy `.env.example` and fill in only what you need. Nothing here is required for local development.

| Variable | Purpose | Sensitivity |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL | Public |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | **Public by design** — ships in the bundle |
| `VITE_PRIVACY_NOTICE_VERSION` | Approved notice version; **empty locks guardian intake** | Public |
| `BRITELINK_STRIPE_WEBHOOK_SECRET` | Stripe signing secret | **Secret** — server only |
| `BRITELINK_MONITOR_JWT` | Short-lived admin token for the health probe | **Secret** — never in Vite |
| `BRITELINK_BUILD_COMMIT` | Commit stamped into `/version.json` | Public |

**Never place a service-role key in a `VITE_` variable.** `src/supabase-config.js` decodes the JWT and
fails the build rather than shipping a bundle that hands every visitor an RLS bypass.

## Commands

```bash
npm run build              # production build + Sites packaging + version stamp
npm test                   # 185 unit and integration tests
npm run test:sites         # hosted-assets packaging test
npm run test:a11y          # axe WCAG 2 A/AA across 4 views × 3 viewports
npm run test:authenticated # full parent journey in a browser
npm run test:staff         # full educator workbench journey
npm run test:households    # multi-household role routing and scope
npm run test:migrations    # apply all 40 migrations to throwaway PostgreSQL (needs Docker)
npm run verify:hosted-isolation  # 104 cross-household checks against a hosted project
npm run health:hosted      # hosted health probe
```

The browser audits spawn their own dev server. They pin the Supabase variables empty so they test the
demo regardless of what is in your `.env.local`.

## Testing philosophy

Tests protect behaviour that matters, not a coverage number:

- **Security schema** — static checks that policies, grants, and revocations match intent
- **RLS by execution** — a real PostgreSQL (PGlite) where cross-household reads are attempted and denied
- **Migration chain** — all 40 migrations applied in order to throwaway PostgreSQL in CI
- **Browser journeys** — the actual parent and educator flows, driven as a user would
- **Provenance guard** — `scripts/check-tracked-test-imports.mjs` fails CI if a tracked test imports
  a file git does not track

That last one exists because it happened repeatedly: a fix lived in an uncommitted source file while a
tracked test asserted the fixed behaviour, so the working copy went green and a clean checkout went
red. A green working copy is not evidence that the repository works.

## Deployment

The web tier deploys to a VPS that builds and serves the SPA. `.github/workflows/deploy.yml` resets to
an exact commit, verifies the VPS HEAD matches the CI-verified SHA, builds, and then **fails the deploy
if the served `/version.json` does not name that commit**.

`GET /version.json` returns the live revision:

```json
{ "commit": "…40 hex…", "commitShort": "…12 hex…", "builtAt": "…ISO…" }
```

A local build with no `BRITELINK_BUILD_COMMIT` reports `"unknown"` rather than guessing from the
checkout — a wrong stamp would be worse than none.

Staging is a self-hosted synthetic stack on the same VPS; see `docs/STAGING_HANDOFF.md`.

## Current state

Honest summary, so nobody has to reverse-engineer it. **`docs/TODO.md` is the one list of what is left.**

**Live and verified (2026-09-30):**
- `britelink.ashbi.ca` runs current `main` and deploys on every merge.
- It is backed by a self-hosted Supabase stack on the VPS: real auth, all migrations applied.
- The approved privacy notice is live, so guardian intake is open.
- An hourly external monitor and nightly restore-verified backups are running.
- Evidence is in `docs/PROJECT-STATUS.md`.

**Not yet proven or not yet real:**
- Sign-in email is configured (Mailgun) but not yet proven with a real invited family account.
- There is no live payment provider (webhook verification exists; the provider and prices are undecided).
- The malware scanner is not deployed, so attachments stay quarantined.
- Manual accessibility (VoiceOver, true browser zoom) is a human gate, not yet run.

**Deliberately out of scope:** child logins, AI-generated plans, community features, and any expansion
into health, diagnosis, or IEP data.

### Where things are tracked

| Document | Purpose |
|---|---|
| `TODO.md` | What is left before and after the first real families, with owners |
| `PROJECT-STATUS.md` | What is verified in production, with evidence |
| `APPLYING_MIGRATIONS.md` | Running the production database and the ops workflows |
| `RELEASE_READINESS.md` | The release gates and their evidence |
| `PRIVACY_OPERATIONS.md` | Data rules, guardian rights, retention |
| `INCIDENT_RESPONSE.md` | Runbook awaiting thresholds and named owners |
| `archive/` | Superseded plans and evaluations, kept for history |

## Contributing notes

- **Read `docs/TODO.md` first.** It lists what is left and who can do it.
- The repository has no TypeScript or linter; `npm test` and the browser audits are the validation path.
- Migrations are append-only and numbered. A destructive migration needs approval and a rollback path.
- Do not commit anything that puts real family data, credentials, or production tokens in the tree.
- Accessibility and the honesty rules in `docs/BUILD-PRIORITIES.md` are constraints, not aspirations:
  no shame streaks, no "behind" labels, no assumed school pacing.
