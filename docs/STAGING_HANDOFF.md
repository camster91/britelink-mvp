# Staging handoff checklist

Operators can use this page before creating or connecting hosted projects. It does not grant permission to provision infrastructure, invite families, or mark release gates complete.

## Honest current state

- Unconfigured `npm run dev` / production builds remain an interactive **demo**: fictional data, device-only persistence, and an explicit demo banner.
- No Supabase credentials, privacy-notice version approval, or real family accounts belong in this repository.
- VoiceOver and true Chrome 200%/400% zoom evidence remain **human-only** on macOS. Automated axe and viewport-equivalence checks are not substitutes.

## Invited-only Auth (when staging exists)

Configure Auth only after explicit infrastructure approval (`docs/GOAL_COMPLETION_PLAN.md` Workstream C):

| Setting | Required value |
| --- | --- |
| Account creation | Invitation only — no public self-serve signup |
| Sign-in | Passwordless magic link for invited guardians and staff |
| Redirect allowlist | Credential-free HTTPS app origins only |
| Email templates | Never ask for child, health, school, diagnosis, or IEP details |
| Session policy | Compatible with 15-minute inactivity sign-out and 10-minute recent-auth for export/deletion |

Uninvited addresses must be refused. Copy for empty household membership already tells invited users to contact support without sending child information.

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
Procedure and rationale: `docs/SUPABASE_PROVISIONING.md` §2a.

Service-role keys never enter Vite or browser env.

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

Track closure in `docs/RELEASE_READINESS.md` and the sequenced plan in `docs/GOAL_COMPLETION_PLAN.md`.
