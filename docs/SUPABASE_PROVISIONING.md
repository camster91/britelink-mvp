# Supabase Provisioning Checklist

This checklist documents the exact steps Cameron must complete to provision Supabase for BriteLink private beta. These steps must be completed before the authenticated workspace can operate with real family data.

> **Decision recorded 2026-09-18, superseding the entry that stood here earlier the same day:
> the backend is self-hosted.** The runtime is GoTrue + PostgREST + storage-api against Postgres on
> the existing VPS — `supabase/selfhosted/`, brought up by `scripts/selfhosted-staging/up.sh`. That
> matches `HOW-TO-RUN.md:26`'s "not hosted Supabase" rather than overriding it. An earlier revision
> of this file recorded the opposite decision ("hosted Supabase"); it was reversed the same day.
>
> **Read the rest of this checklist as the hosted path's reference, not as the plan.** It is kept
> because a hosted project remains a legitimate later option and these are the steps it would take,
> but the staging evidence the repository now actually holds comes from the self-hosted stack — see
> `docs/HOSTED_STAGING_VERIFICATION.md`, which records D1 passing 104 checks over 25 tables. Nothing
> below that creates a project, a payment method or credentials applies unless that path is chosen
> again.
>
> **Scope is still staging only, and production is still deliberately not provisioned.** Real family
> data is gated on the counsel-approved privacy notice and `VITE_PRIVACY_NOTICE_VERSION`; self-hosting
> changes where staging runs, not what has to be true before production exists. The self-hosted stack
> holds synthetic households only (`supabase/seed/synthetic-staging.sql`), and every port is bound to
> 127.0.0.1 precisely so it cannot quietly become production.
>
> The approval boundary still applies to the human steps: creating an account, configuring a payment
> method, and entering credentials are not automatable from this repository. Until a backend is wired
> to the deployed site the application runs as an unconfigured demo (`docs/STAGING_HANDOFF.md`), which
> remains the honest state — do not set `VITE_SUPABASE_*` to make it look otherwise.
>
> **Known blocker — read §7a before believing a live project will configure the site.** The
> deployed site currently *cannot* pick up these variables: `readSupabaseConfig()` reads
> `import.meta.env`, which Vite inlines at **build** time, and neither the Dockerfile nor
> `docker-compose.yml` passes any build argument. A provisioned project alone therefore leaves
> the deployed bundle an unconfigured demo. Local development via `.env.local` is unaffected.

## Prerequisites

- [ ] Supabase account created at https://supabase.com
- [ ] Payment method configured (if using paid tier)
- [ ] Approved privacy notice language from qualified counsel
- [ ] Decision on which pricing tier to use (Free/Pro/Team)

## 1. Create Supabase Projects

Create two projects now: **`britelink-dev`** (local development) and **`britelink-staging`**
(the hosted isolation checks and the full user journey). Do **not** create a production
project yet — see the scope note above.

### Region: choose `Canada (Central)` / `ca-central-1` — not `us-east-1`

BriteLink stores children's education data and is operated in Canada. Supabase offers a
Canadian region, so there is no reason to put this data in the United States:

| choice | what it does |
|---|---|
| **`ca-central-1` (Canada (Central))** | **Use this.** Keeps project data in Canada. |
| a general "Americas" region | **Do not use.** These auto-place by capacity and can land in `us-east-1`, outside Canada. |
| `us-east-1` etc. | Only justified if Canadian residency has been ruled out in writing. |

Pick the **specific** region code, not the continent grouping — the general regions are
explicitly capacity-routed and cannot be relied on to stay in Canada. This matters for the
privacy posture, so record the region you chose alongside the project refs.

### `britelink-dev`

- [ ] Create new project in Supabase dashboard
- [ ] Name: `britelink-dev`
- [ ] Region: `Canada (Central)` / `ca-central-1`
- [ ] Database password: Generate strong password, store in password manager
- [ ] Wait for project to finish initializing (~2 minutes)
- [ ] Note the Project URL: `https://[project-ref].supabase.co`
- [ ] Note the `anon` public key from Settings → API

### `britelink-staging`

- [ ] Create new project in Supabase dashboard
- [ ] Name: `britelink-staging`
- [ ] Region: **the same** `ca-central-1` (consistency is what makes staging predictive)
- [ ] Database password: Generate separate strong password, store in password manager
- [ ] Wait for project to finish initializing
- [ ] Note the Project URL: `https://[project-ref].supabase.co`
- [ ] Note the `anon` public key from Settings → API

**CRITICAL:** Never use the `service_role` key in the browser or commit it to git.
`src/supabase-config.js` enforces this in code and will refuse to boot on a `service_role`
or `sb_secret_` key — but do not rely on that as the only guard.

## 2. Run Database Migrations

Do `dev` first, verify, then repeat for `staging`.

1. Install Supabase CLI if not already installed:
   ```bash
   npm install -g supabase
   ```

2. Link to your project:
   ```bash
   supabase link --project-ref [your-project-ref]
   # You'll be prompted for your database password
   ```

3. Run all **23** migrations in order:
   ```bash
   supabase db push
   ```

   There are 23 files in `supabase/migrations/` (the last is
   `202608280023_attachment_scan_adapter.sql`). Earlier revisions of this checklist said 21 —
   that was written before `022_retention_execution` and `023_attachment_scan_adapter` landed.
   The migration files are authoritative; count them rather than trusting this line.

   Pre-flight: `npm run test:migrations` applies every migration plus `supabase/storage-policies.sql`
   and both `assert-*.sql` files to a throwaway PostgreSQL 16 container. All 23 apply cleanly and
   every behavioural assertion passes. That is a *plain* Postgres rehearsal, not Supabase — useful
   as a smoke test, but it does not substitute for `supabase db push` against the real project.

4. Apply the storage policies, which `supabase db push` does **not** include:
   ```bash
   # paste supabase/storage-policies.sql into the dashboard SQL editor
   ```

5. Verify migrations succeeded:
   - Open Supabase dashboard → Database → Tables
   - Confirm you see the 29 tables the migrations create:

     ```
     households                  memberships                 learners
     guardian_consents           learner_profiles            service_cases
     orders                      educator_capacities         case_messages
     case_message_reads          case_attachments            plans
     plan_weeks                  plan_days                   lessons
     lesson_activities           resources                   plan_reviews
     deliveries                  revision_requests           privacy_requests
     deletion_jobs               payment_events              audit_events
     operation_rate_windows      operational_events          attachment_object_observations
     retention_execution_controls  retention_execution_ledger
     ```

   - Check Database → Policies to confirm RLS policies are in place

   **Earlier revisions of this checklist listed the wrong table names**, and it is worth
   knowing which, because a stale copy is easy to trust. Verified against
   `supabase/migrations/*.sql` on 2026-09-18:

   | name the checklist used | actual table |
   |---|---|
   | `household_members` | **`memberships`** |
   | `cases` | **`service_cases`** |
   | `lesson_resources` | **`resources`** |
   | `revisions` | **`revision_requests`** |
   | `consent_records` | **`guardian_consents`** |
   | `quota_limits` | *never built* — nearest is `operation_rate_windows` |
   | `operational_signals` | *never built* — returned by functions, not stored; nearest is `operational_events` |
   | `household_exports` | *never built* — export is a function; nothing is persisted |

   The migration files are authoritative. If a name here disagrees with them, they win.

## 2a. Seed staging with synthetic data

This is issue #1's AC3: *"Staging contains only documented synthetic households, learners,
cases, and staff identities."* `supabase/seed/synthetic-staging.sql` is the documented set.

It creates **two** households, because isolation needs a counterparty: household A is the
subject, household B is what A must not be able to reach. Each gets a learner, guardian
consent, profile, order, case, plan → week → day → lesson → activity, resource, plan review,
message, message read, attachment, delivery, revision request, audit row, payment event, rate
window, operational event, educator capacity, and a pending deletion request with a scheduled
job for the retention work in #6.

**The coverage target is all 25 tables, on both sides — not the interesting ones.**
`src/hosted-isolation.js` declares `PRIVATE_TABLES`, and its D1 check requires *both*
administrators to see an **own-household sentinel on every one of them**, for the reason given in
`docs/HOSTED_STAGING_VERIFICATION.md`: an empty foreign result proves nothing when the foreign
table has no data either. A fixture set that covers only the obvious surfaces leaves the rest
permanently unprovable, and the check fails outright with *"no visible own-household
sentinel"*. `verify-synthetic-seed.sql` sweeps exactly that list, so an under-covered table
fails in the harness rather than on staging after provisioning.

One consequence worth stating, since it looks like a mistake: household B's
`educator_capacities` row is held by `admin_b`. The env contract in `.env.example` has no
`EDUCATOR_B_USER_ID`, and that table's select policy admits an educator *or* an admin of the
household — so an admin holding the capacity row satisfies the check without inventing a fifth
required UUID for the operator to supply.

**Order matters: create the four auth users first.** Users belong to Supabase Auth — insert
them through the dashboard or the admin API, so they get real identities that can mint JWTs.
Inserting into `auth.users` directly produces rows that cannot sign in. Then pass the four
resulting UUIDs in:

```bash
psql "$STAGING_DATABASE_URL" \
  -v seed_confirm=yes \
  -v admin_a=<uuid> -v guardian_a=<uuid> \
  -v educator_a=<uuid> -v admin_b=<uuid> \
  -f supabase/seed/synthetic-staging.sql
```

Properties worth knowing before you run it:

- **It refuses to run without `seed_confirm=yes` and all four UUIDs.** The refusals *raise*;
  they do not `\quit`, because `\quit` exits 0 and a guard that exits 0 is not a guard.
- **It refuses to re-run** once the seed households exist, so a second invocation cannot
  silently double the object graph.
- **It prints a paste-ready block of the `BRITELINK_TEST_*` variables** the isolation checks in
  `docs/HOSTED_STAGING_VERIFICATION.md` consume — 16 ids, no dashboard archaeology.
- **It cannot mint the four JWTs.** One per user, from Supabase Auth. That half stays manual.

Two things it deliberately does **not** do, both of which you must finish by hand:

- **The storage object bytes.** The seed writes `case_attachments` metadata and the
  `object_path` the storage policies key on, but no file reaches the bucket.
  `docs/ATTACHMENT_OPERATIONS.md` is explicit that an object is never marked clean by hand, so
  upload through the normal path and let the scanner record the verdict. Until the bytes exist,
  a download check that expects *denial* passes vacuously — it would pass just as well against
  a missing object.
- **The `case-attachments` bucket itself**, private, 10 MB limit, MIME allow-list
  `application/pdf,image/jpeg,image/png,text/plain`. See §4.

**The scheduled deletion job is deliberately not due** (`eligible_at` is 90 days out).
`admin_execute_due_deletion_jobs()` has no household scope — it takes *every* due job — so a
due fixture here would let the next executor run anywhere destroy household B, taking all 24
D2 mutation checks with it and surfacing as two dozen unrelated failures. Do not "fix" the
timestamp.

`scripts/migration-harness/validate-migrations.sh` applies this seed to a throwaway Postgres
on every run, tests that both refusals refuse, and then verifies the seeded data with
`verify-synthetic-seed.sql` — including that the storage policies admit the seeded pending
upload and hide the counterparty's clean object. Proving it there is cheaper than proving it
on staging.

## 3. Configure Authentication

For each project:

### Email Authentication

- [ ] Go to Authentication → Providers
- [ ] Disable all providers except **Email**
- [ ] Enable Email provider
- [ ] Disable "Confirm email" (we're using magic links)
- [ ] Set "Secure email change" to enabled

### Magic Link Settings

- [ ] Go to Authentication → URL Configuration
- [ ] Add Site URL: `https://your-production-domain.com` (or `http://localhost:5173` for staging)
- [ ] Add Redirect URLs:
  - `http://localhost:5173/**` (for local development)
  - `https://your-staging-domain.com/**` (if using staging domain)
  - `https://your-production-domain.com/**` (production only)

### Email Templates

- [ ] Go to Authentication → Email Templates
- [ ] Customize "Magic Link" template:
  ```html
  <h2>Sign in to BriteLink</h2>
  <p>Click the link below to sign in to your secure BriteLink workspace:</p>
  <p><a href="{{ .ConfirmationURL }}">Sign in to BriteLink</a></p>
  <p>If you didn't request this, you can safely ignore this email.</p>
  <p><strong>Do not forward this email or share this link.</strong></p>
  ```

### JWT Settings

- [ ] Go to Settings → API → JWT Settings
- [ ] Set JWT expiry to 3600 seconds (1 hour)
- [ ] Note: Inactivity timeout (15 minutes) is handled by application code

## 4. Configure Storage (for attachments)

For each project:

- [ ] Go to Storage → Buckets
- [ ] Create new bucket: `case-attachments`
- [ ] Set to **Private**
- [ ] Enable RLS policies on the bucket

### Apply Storage Policies

Run this SQL in the SQL Editor:

```sql
-- Apply the storage policies from supabase/storage-policies.sql
-- (Copy the contents of that file and run it here)
```

- [ ] Verify policies were created in Storage → Policies

## 5. Configure Realtime (Optional)

BriteLink doesn't require Realtime for MVP, but if you want live updates:

- [ ] Go to Database → Replication
- [ ] Enable replication on tables: `case_messages`, `lesson_activities`
- [ ] Note: This increases database load and costs

## 6. Set Up Database Backups

For the `staging` project (and for production later, when it exists):

- [ ] Go to Settings → Backups
- [ ] Verify daily backups are enabled (default on Pro tier)
- [ ] Enable Point-in-Time Recovery (PITR) if on Pro/Team tier
- [ ] Document recovery procedures in `/docs/RECOVERY_OPERATIONS.md`

**Do not read a green backup as proof of anything.** The current nightly job has produced nine
consecutive valid archives that were all *empty* — well-formed dumps of a database with no
tables, because the migrations were never applied to the live instance. A backup is only
evidence once something is in it, which is why §2's verification step matters more than this
one. The archive drill that catches this is `npm run test:restore:production`; it exits 3 on an
empty archive rather than reporting success.

## 7. Configure Environment Variables

These are **build-time** values, not runtime ones — see §7a. Vite inlines `VITE_*` into the
client bundle when `npm run build` runs, so setting them after a build does nothing.

### For Local Development

Create `.env.local` (never commit this file):

```bash
VITE_SUPABASE_URL=https://[dev-project-ref].supabase.co
VITE_SUPABASE_ANON_KEY=[dev-anon-key]
# Leave empty until counsel approves the exact notice language.
VITE_PRIVACY_NOTICE_VERSION=
```

### For the deployed site

The site is **not** on Vercel, Netlify, or Cloudflare Pages. It is an nginx container built by
`Dockerfile` and served on the VPS behind Traefik at `britelink.ashbi.ca`, deployed by
`.github/workflows/deploy.yml`. The deploy runs `docker compose up -d --build` from a
depth-1 clone of this repository on the VPS, so the build environment is the VPS, not GitHub
Actions.

**IMPORTANT:** leave `VITE_PRIVACY_NOTICE_VERSION` empty until counsel approves the exact
privacy notice language. Do not carry the old `2026-09-09` placeholder forward — an unapproved
version string is worse than none, because it asserts an approval that has not happened.

## 7a. Blocker: the deploy path has no build-time env plumbing

**As it stands, provisioning a project does not configure the deployed site.** Verified
2026-09-18 against `Dockerfile`, `docker-compose.yml`, and `src/supabase-config.js`:

- `readSupabaseConfig(environment = import.meta.env)` reads `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` from `import.meta.env` — **inlined by Vite at build time**.
- `Dockerfile` runs `RUN npm run build` with **no `ARG`/`ENV` for any `VITE_*` variable**.
- `docker-compose.yml` passes **no `build.args`**, and the service is only
  `build: .`, `restart: unless-stopped`, `ports: 127.0.0.1:8088:80`.

So even with `britelink-staging` fully provisioned, a rebuilt container would still ship the
unconfigured demo, and `readSupabaseConfig()` would keep returning `configured: false`.

Closing it needs, minimally: `ARG VITE_SUPABASE_URL` / `ARG VITE_SUPABASE_ANON_KEY` (and the
privacy version) declared before `RUN npm run build` in the Dockerfile, plus matching
`build.args` in the compose file sourced from an env file that lives **on the VPS and is never
committed**. Note the `anon` key is designed to be public — it ends up in the shipped bundle
either way — so this is not a secret-leakage problem; but the service-role key must never be
passed here, and `supabase-config.js` will refuse to boot if one ever is.

This is deliberately **not** wired up yet: doing so would put a real backend behind the public
site, which is a deployment change gated on the same approval as provisioning. Local
development needs none of it.

## 8. Test Staging Environment

Before touching production:

1. [ ] Run the hosted isolation check:
   ```bash
   # Create two test admin users in Supabase Auth dashboard
   # Get their short-lived JWTs from the dashboard
   export BRITELINK_TEST_ENVIRONMENT=staging
   export BRITELINK_TEST_HOUSEHOLD_A_ID=[household-a-uuid]
   export BRITELINK_TEST_HOUSEHOLD_B_ID=[household-b-uuid]
   export BRITELINK_TEST_ADMIN_A_JWT=[short-lived-jwt-a]
   export BRITELINK_TEST_ADMIN_B_JWT=[short-lived-jwt-b]
   npm run verify:hosted-isolation
   ```

2. [ ] Verify **all 128** isolation checks pass — 104 read-isolation checks (D1) plus 24
   mutation-denial probes behind 4 controls (D2, the cross-household write matrix). Both read
   `docs/HOSTED_STAGING_VERIFICATION.md` for what each one proves. The D2 matrix sends real
   cross-household writes that must all be denied, so point it at `staging` and never at a
   project holding real family data.

3. [ ] Test the complete user journey:
   - Sign in with magic link
   - Create a learner
   - Submit intake
   - Send a secure message
   - Export household data
   - Request deletion

4. [ ] Verify all RLS policies work correctly (no cross-household data leaks)

## 9. Security Hardening

For the `staging` project:

- [ ] Go to Settings → API → API Settings
- [ ] Review and restrict CORS origins to the origins that actually serve the app
      (`http://localhost:5173` for dev, and the staging hostname — not a production domain
      that does not exist yet)
- [ ] Set rate limits on Authentication endpoints (if available on your tier)
- [ ] Enable email rate limiting to prevent abuse

- [ ] Go to Settings → Billing
- [ ] Set up budget alerts to prevent surprise costs
- [ ] Review pricing calculator for expected usage

## 10. Monitoring Setup

For the `staging` project (extend to production when it exists):

- [ ] Enable database logs (Settings → Logs)
- [ ] Set up external monitoring (Sentry, LogRocket, or similar)
- [ ] Configure alerts for:
  - Database connection errors
  - Failed authentication attempts
  - RLS policy violations
  - Storage quota approaching limit
- [ ] Document monitoring procedures in `/docs/MONITORING_OPERATIONS.md`

## 11. Operational Health Checks

- [ ] Verify the health check endpoint works against `staging`:
   ```bash
   export BRITELINK_SUPABASE_URL=https://[staging-project-ref].supabase.co
   export BRITELINK_SUPABASE_ANON_KEY=[staging-anon-key]
   export BRITELINK_MONITOR_JWT=[admin-jwt-for-health-check]
   export BRITELINK_MONITOR_HOUSEHOLD_ID=[test-household-uuid]
   npm run health:hosted
   ```
   These are `BRITELINK_*`, not `VITE_*` — they are read at **runtime** by a Node script, so
   unlike §7 they do not need to be present at build time.

- [ ] Verify the health check returns HTTP 200 with expected signals
- [ ] Set up external monitoring to call this endpoint every 5 minutes
- [ ] Configure alerts if health check fails 3 times in a row

## 12. Create Initial Admin User

For the `staging` project:

- [ ] Go to Authentication → Users
- [ ] Add user manually:
  - Email: Your admin email
  - Password: Not used (magic link only)
  - Confirm email: Yes
- [ ] Note the user UUID

- [ ] Run this SQL to create the admin household and membership. The previous revision of this
  checklist used `household_members`, which **does not exist** — the table is
  `public.memberships` (migrations 001). Do not copy the old snippet:

  ```sql
  -- Create the admin household. Let the database generate the id so there is no
  -- 'admin-household-uuid' placeholder to forget to replace.
  with new_household as (
    insert into public.households (display_name)
    values ('BriteLink Operations')
    returning id
  )
  -- Grant admin membership. role is the enum public.membership_role.
  insert into public.memberships (household_id, user_id, role)
  select id, '[your-user-uuid]'::uuid, 'admin'
  from new_household;
  ```

- [ ] Confirm the membership landed:
  ```sql
  select h.display_name, m.role
  from public.memberships m
  join public.households h on h.id = m.household_id
  where m.user_id = '[your-user-uuid]'::uuid;
  ```
- [ ] Test signing in as admin
- [ ] Verify you can see the admin workspace

## 13. Backup and Disaster Recovery

- [ ] Document the exact Supabase project IDs and regions in a secure location
- [ ] Store database passwords in a password manager (1Password, LastPass, etc.)
- [ ] Document who has access to the Supabase dashboard
- [ ] Test the database restore procedure in staging:
  1. Take a manual backup
  2. Create a new project
  3. Restore the backup
  4. Verify data integrity

## 14. Pre-Launch Checklist

Before allowing real families to use the system:

- [ ] All 23 migrations applied successfully
- [ ] RLS policies verified with hosted isolation check (128 checks passed: 104 D1 + 24 D2)
- [ ] Email templates customized and tested
- [ ] Backup strategy documented and tested
- [ ] Monitoring and alerts configured
- [ ] Disaster recovery plan documented
- [ ] Admin access confirmed
- [ ] Privacy notice approved by counsel
- [ ] Counsel-approved `VITE_PRIVACY_NOTICE_VERSION` set
- [ ] Private beta families recruited (5-10)
- [ ] Support procedures documented

## Common Issues and Solutions

### Issue: "Invalid API key"
**Solution:** Verify you're using the `anon` key, not the `service_role` key. The anon key is safe for browser use.

### Issue: "Permission denied for table"
**Solution:** RLS policies may not be set up correctly. Re-run migrations and verify policies in Database → Policies.

### Issue: "JWT expired"
**Solution:** JWT tokens expire after 1 hour. Users need to sign in again. This is by design.

### Issue: "Redirect URL not allowed"
**Solution:** Add the redirect URL to Authentication → URL Configuration → Redirect URLs.

### Issue: Attachments not uploading
**Solution:** Verify the `case-attachments` bucket exists and has the correct RLS policies from `supabase/storage-policies.sql`.

### Issue: Cross-household data leak in testing
**Solution:** STOP. Do not proceed past staging. Review RLS policies and re-run the isolation check until all 128 checks (104 D1 + 24 D2) pass.

## Post-Provisioning

After `dev` and `staging` are provisioned:

- [ ] Record the project refs and **the region you chose** in a secure doc, not in git
- [ ] Confirm both projects are `ca-central-1` — a region mismatch between them is easy to
      create and makes staging non-predictive
- [ ] Note in the secure doc that no production project exists yet, and why

The items below belong to the **private-beta** phase and are gated on approvals that have not
happened. Do not work the list downward from here:

- [ ] Share access with Cameron and any other administrators
- [ ] Create the production project *(gated: privacy notice approved by counsel)*
- [ ] Schedule the first private beta family onboarding *(gated: 5–10 consented households)*
- [ ] Monitor the system daily during the first week
- [ ] Review Supabase billing after the first month

## Support

If you encounter issues during provisioning:

1. Check the Supabase docs: https://supabase.com/docs
2. Check the BriteLink implementation plan: `/docs/IMPLEMENTATION_PLAN.md`
3. Review the RLS verification: `/docs/HOSTED_STAGING_VERIFICATION.md`
4. Check GitHub issues: https://github.com/camster91/britelink-mvp/issues

## Next Steps After Provisioning

Once `dev` and `staging` exist and the isolation checks pass:

1. Run the full test suite: `npm test`
2. Run the migration harness: `npm run test:migrations`
3. Run the production archive drill: `npm run test:restore:production`
4. Point local development at `britelink-dev` via `.env.local` and confirm the app leaves the
   unconfigured-demo state
5. Close §7a — add the Dockerfile build args and compose `build.args` — **only if** the hosted
   staging site is meant to be a live backend. This is a deployment change and needs the same
   approval as provisioning.

The following remain gated and are not "next steps" in the ordinary sense:

6. Deploy a hosted environment backed by real data *(gated)*
7. Run manual accessibility testing (VoiceOver, 200%/400% zoom)
8. Recruit 5-10 private beta families *(gated: consented households)*
9. Train educators on the staff workbench
10. Begin private beta with daily monitoring

---

**Last Updated:** 2026-09-18  
**Owner:** Cameron  
**Status:** Decision made — hosted Supabase, `dev` + `staging`, region `ca-central-1`. Awaiting project creation (Cameron's account and payment method). Production project deferred behind the privacy gates. §7a is an open in-repo gap. The synthetic staging seed (§2a) is written and proven against a throwaway Postgres on every harness run; it has not yet been applied to a hosted project, because none exists.
