# Staging handoff checklist

Operators can use this page before creating or connecting hosted projects. It does not grant permission to provision infrastructure, invite families, or mark release gates complete.

## Honest current state

- Unconfigured `npm run dev` / production builds remain an interactive **demo**: fictional data, device-only persistence, and an explicit demo banner.
- No Supabase credentials, privacy-notice version approval, or real family accounts belong in this repository.
- VoiceOver and true Chrome 200%/400% zoom evidence remain **human-only** on macOS. Automated axe and viewport-equivalence checks are not substitutes.

## Auth settings

Owner decision 2026-10-06: an open free beta, so anyone may create an account (`docs/TODO.md`
item 3). Configure Auth only after explicit infrastructure approval:

| Setting | Required value |
| --- | --- |
| Account creation | Open (`GOTRUE_DISABLE_SIGNUP=false`), but only with a confirmed email (`GOTRUE_MAILER_AUTOCONFIRM=false`; Ops check prints "email confirmation: required (safe)") |
| Sign-in | Passwordless magic link for guardians and staff |
| Sign-in email rate limit | Per visitor at the gateway (`supabase/selfhosted/gateway.conf`), on top of GoTrue's site-wide email budget |
| Redirect allowlist | Credential-free HTTPS app origins only |
| Email templates | Never ask for child, health, school, diagnosis, or IEP details |
| Session policy | Compatible with 15-minute inactivity sign-out (with a one-minute warning) and 10-minute recent-auth for export/deletion |

A new account with no household sees "Set up your household". A staff educator with no family yet
sees a waiting screen instead (migration 061).

## Environment checklist (staging shell only)

Copy names from `.env.example`. Never commit real values.

**Browser build (Vite):**

- `VITE_SUPABASE_URL` — HTTPS project URL
- `VITE_SUPABASE_ANON_KEY` — public anon key only
- `VITE_PRIVACY_NOTICE_VERSION` — leave empty until counsel approves the exact notice text

**Trusted monitoring shell:**

- `BRITELINK_SUPABASE_URL` / `BRITELINK_SUPABASE_ANON_KEY`
- `BRITELINK_MONITOR_JWT` / `BRITELINK_MONITOR_HOUSEHOLD_ID`

**Hosted isolation verifier:**

- `BRITELINK_TEST_ENVIRONMENT=staging` (exact value)
- Two synthetic household IDs and short-lived admin JWTs (`BRITELINK_TEST_*`)

Those IDs are not something to invent by hand. `supabase/seed/synthetic-staging.sql` creates the
two households and prints the whole `BRITELINK_TEST_*` block ready to paste. It prints every
variable the verifier reads **except** the four JWTs, which only Supabase Auth can mint — and that
gap is asserted in the migration harness, so it cannot silently grow as the verifier changes.
Procedure and rationale: `docs/archive/SUPABASE_PROVISIONING.md` §2a.

Service-role keys never enter Vite or browser env.

## Automated journeys (after the synthetic seed)

`npm run test:staging-journeys` drives the deployed staging app with the seed's guardian and educator
accounts, signed in through real magic links minted with the staging service key. It proves a
learning note and a lesson completion each survive a reload and are visible on a second device (then
cleans both up), that a
calendar link serves a signed-out client and stops when turned off, and that the educator lands in
the workbench. It writes `qa/staging/journey-report.json`.

Set `BRITELINK_STAGING_APP_URL` and `BRITELINK_STAGING_SERVICE_ROLE_KEY` (see `.env.example`) plus
the seed's `BRITELINK_TEST_*` block. It refuses to run unless `BRITELINK_TEST_ENVIRONMENT=staging`
and neither URL is a production host. Never give it a production service key.

## Calendar subscription feed (migration 050)

The web container serves `/feed/<64-hex token>.ics` by proxying to `public.calendar_feed(token)`
with the **anon** key, which it takes from the same `VITE_SUPABASE_ANON_KEY` build argument as the
bundle, so nothing new needs configuring. In the demo build the route answers 404.

- The token is in the URL path. nginx does not log that route, but check that Traefik's access log
  is off or path-redacted for the BriteLink routers before any family creates a link.
- `npm run test:staging-journeys` creates a link, fetches it signed out, turns it off and expects a
  404.

## Sites packaging (local, no credentials)

```sh
npm run build && npm run test:sites
```

Confirm `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` exist. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact.

## Evidence that stays human-only

Do not mark these complete from this Linux environment or from automated audits alone:

1. Manual VoiceOver journeys and true browser zoom — `docs/MANUAL_ACCESSIBILITY_QA.md`
2. Counsel-approved privacy notice / consent / retention
3. Credentialed educator curriculum, safeguarding, accessibility, and resource sign-off
4. Live hosted Auth, isolation, restore, monitoring alerts, payments, malware scanner, physical erasure
5. Private-beta invitations to real households

Track closure in `docs/RELEASE_READINESS.md` and the sequenced plan in `docs/archive/GOAL_COMPLETION_PLAN.md`.

## Staging from GitHub Actions (no SSH needed)

Actions → **Staging** → Run workflow on `main`:

- **rebuild-and-verify** is for the first run, because staging predates migration 038.
  - It wipes the staging stack's volumes; staging holds synthetic data only. It refuses if any auth user is not `@britelink.invalid`, and it refuses any compose project that is not `*staging*`.
  - It updates the stack's compose files from the dispatched commit, keeping a backup in `.pre-rebuild-<time>/`.
  - It re-runs `scripts/selfhosted-staging/up.sh`: all migrations, the private bucket, the synthetic seed, the staging identities and `.env.staging`.
  - It then runs verify.
- **verify** does the following:
  - It builds a staging copy of the app from the production Dockerfile, pointed at the staging API.
  - It serves the app on `127.0.0.1:8097`, and a staging-only compose override lets GoTrue send magic links there.
  - It runs the hosted isolation verifier (D1 + D2) and the parent + educator journeys (#39) in a Playwright container.
  - It prints both results and fails if either does.

Staging keys and minted tokens stay on the VPS in `0600` files that are removed after the run. `scripts/staging-ops.sh` holds the logic.
