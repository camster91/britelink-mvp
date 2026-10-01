# Staging provisioning runbook — BriteLink

**Prepared:** 2026-09-21
**Status:** operator runbook. Every step that creates external infrastructure or spends money needs Cameron's explicit approval immediately before it runs.
**Purpose:** take the repository from "verified locally" to "hosted staging with real authentication and two synthetic households", so the isolation, durability, and journey gates can be closed with deployed evidence.

## Before you start

**Read this first.** The most likely failure is following a stale document. As of 2026-09-21:

- The repository has **40 migrations**, not 21 or 23. Several documents still said otherwise until today; they are corrected, but if you find one that disagrees, trust `ls supabase/migrations/*.sql | wc -l`.
- Production currently runs commit `c805455`. The repository is ahead. Do not assume production reflects the repo.
- The private-beta path does **not** require Stripe, the malware scanner, or the deletion job. Those are separate gates.

**Approval boundary:** creating a Supabase project, configuring auth, and any spend require Cameron's explicit approval immediately before the action. Local preparation does not.

## What you are provisioning

Two projects, deliberately separate:

- **Development** — for schema work and breakage
- **Staging** — for the isolation drills, journey tests, and restore drill

Never reuse one project for both. Never run isolation drills against production.

## Step 1 — Create the projects

1. Create the development project. Record: project ID, region, owner, cost, teardown procedure.
2. Create the staging project. Same records, distinct values.
3. Confirm both are not reachable by the public internet in any way you did not intend.

**Verify:** two distinct project IDs recorded. Neither is a rename of the other.

## Step 2 — Apply the schema

On **each** project, in order:

1. Apply **all 40** migrations from `supabase/migrations/`, in filename order.
2. Apply `supabase/storage-policies.sql`.
3. Create the private bucket `case-attachments` with the documented MIME allowlist and 10 MB limit.
4. Confirm the portable authenticated privileges from migration `202608280014` applied (no extra broad grants).

**Verify:**

```
# on the project's database
select count(*) from information_schema.tables
  where table_schema = 'public';
-- 25 private tables should be RLS-enabled
select relname from pg_class where relrowsecurity and relnamespace = 'public'::regnamespace;
```

Migration history should match the repository exactly. If a migration fails, stop — do not skip it.

## Step 3 — Configure authentication

Invited accounts only. There is no public signup in the beta.

- Redirect allowlist: credential-free HTTPS app origins only. No wildcards, no localhost in staging.
- Email templates: must **never** ask for child, health, school, diagnosis, or IEP information.
- JWT lifetime and refresh settings must support the 15-minute inactivity sign-out and the 10-minute recent-auth window used for export and deletion.
- No public self-serve account creation.

**Verify:** an invited synthetic guardian and an invited synthetic educator can each complete a magic-link sign-in on two devices. An uninvited address is refused. A redirect to a non-allowlisted origin is rejected.

## Step 4 — Configure the client build

Set only the public variables in the build environment:

```
VITE_SUPABASE_URL=<project url>
VITE_SUPABASE_ANON_KEY=<public anon key>
VITE_PRIVACY_NOTICE_VERSION=
```

**Leave the notice version empty.** Until counsel approves the exact text, an empty value is what locks guardian intake. Setting it early would record consent to a notice nobody approved.

**Never** place a service-role key in a Vite variable. `src/supabase-config.js` rejects it at build time by decoding the JWT — if the build fails on that check, the wrong key was supplied.

**Verify:** `npm run build` succeeds and the bundle contains no service-role key.

## Step 5 — Seed two synthetic households

Apply `supabase/seed/synthetic-staging.sql`. It creates households A and B with distinct administrators, plus guardian and educator memberships.

Each household needs a policy-visible sentinel in **every one of the 25 private tables**, and one clean synthetic object in `case-attachments`.

The seed has refusal guards; if it runs without the expected environment it should refuse rather than half-seed.

**Verify:** no real names, no real family data. Both household A and household B sentinels exist in all 25 tables.

## Step 6 — Run the isolation verifier

Fill the trusted-shell variables from `.env.example` — the staging block, not the monitoring block. Then:

```
BRITELINK_TEST_ENVIRONMENT=staging npm run verify:hosted-isolation
```

This runs 104 read checks across 25 private tables and the bucket, for both administrators.

**Verify:** 104 checks green. A leaked row, a missing sentinel, or an HTTP error fails the gate. Store only the privacy-minimal summary JSON — never the raw output, which contains row identifiers.

**If this fails, stop and fix before proceeding.** Everything downstream assumes isolation holds.

## Step 7 — Run the mutation-denial matrix (not yet built)

Same project, the write-side counterpart to step 6. **This does not exist yet.**

`docs/GOAL_COMPLETION_PLAN.md` D2 specifies it, and the read-only verifier explicitly does not cover writes. There is no `npm run` script for it today, and the `.env.example` variables for household B case, plan, lesson, activity, message, delivery, revision, attachment, consent, and learner ids exist in preparation for it.

**Options:** build the matrix as part of Phase 2, or accept read isolation plus the local mutation tests as the beta bar and record that decision. Do not treat this step as complete because the variables exist — they are inputs waiting for a consumer.

**Verify:** either a dated mutation-denial report exists, or the decision to defer is recorded with its reasoning.

## Step 8 — Prove multi-device durability

With a real invited guardian session on two browsers:

1. Complete versioned intake and consent, using a **staging-only** notice version.
2. Confirm both devices show the same durable state after reload.

**Verify:** no demo-mode claims, synthetic names only, both devices agree.

## Step 9 — Record the deployed revision

Now that the build takes `BRITELINK_BUILD_COMMIT`, confirm `/version.json` names the expected commit.

**Verify:** `curl -s https://<staging-host>/version.json` returns the commit you deployed.

## What this runbook deliberately does not cover

- **Stripe webhook and checkout** — separate gate, needs a Stripe account and keys.
- **Malware scanner** — beta may ship with uploads disabled.
- **Physical deletion job** — not implemented; requires the approved retention schedule first.
- **External monitoring** — separate gate; the probe contract exists.
- **Backups and PITR** — configure in the dashboard for the paid tier; needs the approved RPO.
- **Manual accessibility (VoiceOver, true zoom)** — human gate, cannot be closed here.

## If something goes wrong

- **Migration fails partway:** do not hand-fix the database. Drop the project and reapply from scratch. A half-migrated staging project produces evidence that looks valid and is not.
- **Isolation verifier fails:** stop. That is the one failure that must never be worked around.
- **Wrong key supplied:** the build rejects it. Do not disable the check.
- **Cost or access concern:** stop and ask Cameron.

## Handoff note

This runbook prepares the work. It does not authorise it. Creating projects, configuring auth, and any spend need Cameron's explicit approval immediately before the step runs.
