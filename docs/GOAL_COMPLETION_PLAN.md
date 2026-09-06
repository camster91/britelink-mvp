# BriteLink Goal Completion Plan

This is the sequenced plan to close every remaining official product goal. A checked local foundation in `docs/IMPLEMENTATION_PLAN.md` is not enough: each goal below is complete only when the evidence named here exists.

Governing ledgers:

- Product intent and original blockers: `REAL_WORLD_REVIEW.md`
- Local checkbox ledger: `docs/IMPLEMENTATION_PLAN.md`
- Release evidence ledger: `docs/RELEASE_READINESS.md`
- GitHub execution units: issues [#1](https://github.com/camster91/britelink-mvp/issues/1)–[#13](https://github.com/camster91/britelink-mvp/issues/13), roadmap [#14](https://github.com/camster91/britelink-mvp/issues/14)

This plan does not reopen completed local work. It finishes the hosted, legal, quality, operational, and private-beta gates that still block real family use.

## Destination

BriteLink is approved for a controlled 5–10 household private beta when, and only when, all eight release gates in `docs/RELEASE_READINESS.md` have deployed or human-approved evidence:

| Gate | Destination evidence |
| --- | --- |
| Honest demo | Unconfigured builds stay labelled fictional; live builds never invent order, educator, or ETA status |
| Parent journey | Invited guardian can complete intake, run a published plan, message, acknowledge delivery, request an entitled revision, export, correct, and request deletion against hosted Auth and storage |
| Educator journey | Invited educator/admin can triage, assign, author, independently review, publish, deliver/retry, complete a revision, and handle absence/overdue against hosted data |
| Household isolation | Two real authenticated staging households denied across all 25 private tables, RPCs, the private bucket, and the mutation matrix |
| Accessibility | Manual VoiceOver journeys and true Chrome 200%/400% zoom pass with recorded evidence |
| Privacy | Counsel-approved notice/consent/retention; hosted Auth policy; exercised export/correction/deletion/offboarding; scheduled erasure job ready |
| Reliability | External monitor + delivered alerts, named contacts, managed backup/PITR, encrypted object backups, staging restore timings, incident tabletop |
| Quality | Credentialed educator approves curriculum, safeguarding, accessibility, and resource review for the beta corpus |
| Private beta | Named owners and 5–10 consented households using production safely |

Until that table is green, the product remains **not approved** for real family data or paid delivery.

## What is already done

Do not rebuild these. They are locally verified and remain the implementation baseline:

- Honest browser-only demo with fictional data and device-only persistence
- Distinct 8-week / 5-day / unique-lesson plan model, lesson states, reschedule, intake validation
- Automated WCAG A/AA, keyboard, contrast, reduced-motion, and viewport-equivalence checks
- Twenty-one migrations, 25-table RLS, RPC-only sensitive writes, author/reviewer separation
- Authenticated parent and educator journeys against synthetic repositories
- Payment-event ingestion boundary (unsigned), attachment quarantine model, export v2, deletion scheduling
- Local encrypted restore rehearsal, security headers, runbooks, hosted-isolation verifier contracts

Remaining work is almost entirely **hosting, adapters, approvals, and live evidence**.

## Sequencing rules

1. Synthetic data only until counsel approves notice, consent, and retention language.
2. Provision staging before production. Never run isolation or restore drills against production family accounts.
3. Do not set `VITE_PRIVACY_NOTICE_VERSION` in a build that can reach real guardians until counsel signs the exact notice text.
4. Payment checkout and physical deletion stay off until their staging evidence and approvals exist.
5. Private-beta invitations are the last step, not a way to discover missing gates.
6. Close a GitHub issue only when its stated acceptance criteria and required evidence pass.

Workstreams A and the counsel/educator briefing packets can start immediately. Hosted work needs explicit infrastructure approval. Private beta needs every prior gate.

```text
A Local closeouts ──────────────┐
B Counsel + educator packets ───┼─► C Hosted staging ─► D Live verification
                                │                              │
                                └──────────────────────────────┼─► E Payments, scanner, erasure
                                                               ├─► F Reliability + tabletop
                                                               ├─► G Human quality sign-off
                                                               └─► H Private beta
```

---

## Workstream A — Local closeouts

**Closes:** leftover local integrity; Sites handoff; accessibility protocol execution.  
**Owner:** engineering + a macOS assistive-technology tester.  
**Approval required:** none for build/test; VoiceOver evidence needs a human tester on macOS.

### A0. Staging handoff hygiene

Keep `docs/STAGING_HANDOFF.md` accurate for operators: env checklist, invited-only Auth expectations, Sites packaging commands, and an explicit list of evidence that remains human-only. Do not invent completed gates.

**Pass:** Operators can follow the handoff doc without guessing which secrets belong in Vite vs trusted shell, and the unconfigured build remains an honest demo.

### A1. Sites packaging evidence

`tests/sites-worker.test.mjs` requires a current production build.

- Run `npm run build && npm run test:sites`.
- Confirm `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` exist.
- Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and the Sites test intact.

**Pass:** `npm run test:sites` is green on a clean checkout after `npm run build`.

### A2. Manual VoiceOver and true browser zoom

Follow `docs/MANUAL_ACCESSIBILITY_QA.md` exactly. Automated axe and resized-viewport checks do not substitute.

- Demo parent journey (Overview, Learning plan, Learner profile, Educator demo).
- Authenticated parent harness journey.
- Educator harness journey.
- True Chrome zoom at 200% and 400% on a 1280px-wide window for all four demo views.

**Pass:** `qa/accessibility/manual-report.md` plus sanitized artifacts under `qa/accessibility/manual/` show no critical or serious blocker. Medium findings have an owner and a documented private-beta decision. Then check the VoiceOver/zoom boxes in `docs/IMPLEMENTATION_PLAN.md`.

### A3. Keep the public demo honest

If any later change adds live status, educator presence, or delivery estimates to the unconfigured build, revert that before beta.

**Pass:** Unconfigured `npm run dev` still shows the interactive-demo banner, fictional names, and no live-operations claims.

---

## Workstream B — Approval packets (start in parallel)

**Closes:** the blocking inputs for privacy and quality gates.  
**Owner:** operator + qualified Canadian counsel + credentialed educator.  
**Approval required:** yes. Engineering cannot self-close these.

### B1. Counsel packet

Prepare, then obtain written approval for:

- Privacy notice text and exact version string for `VITE_PRIVACY_NOTICE_VERSION`
- Consent purposes (planning, service delivery, secure messaging, export/deletion administration)
- Retention schedule per record class: purpose, trigger, duration, deletion method, backup expiry, legal exception
- Breach-notification decision path and regulator contact
- Confirmation that MVP collection stays limited to structured planning context (no diagnosis, health, IEP, school, address, or unbounded accommodation text)

Source material: `docs/PRIVACY_OPERATIONS.md`.

**Pass:** dated counsel memo naming the approved notice version, purposes, retention table, and breach path. Store the memo outside the public repository if it contains privileged advice; record only the approved version string and date in the evidence ledger.

### B2. Educator quality packet

Prepare a review set from fictional or staging-synthetic plans only:

- One Essentials (8-week), one Complete (16-week), and one revision-with-change-summary example
- Resource list with cost, rights, attribution, region, privacy, and substitutes
- Safeguarding and accessibility checklist used by the independent reviewer gate

**Pass:** named credentialed educator signs curriculum mapping, safeguarding, accessibility, and resource-rights review. This is the Quality gate. Software author/reviewer separation is already implemented; it is not a substitute.

### B3. Named operating owners

Fill the blanks in `docs/INCIDENT_RESPONSE.md` and `docs/MONITORING_OPERATIONS.md`:

- Incident commander, privacy lead, technical lead, family communications owner
- Primary and backup on-call for monitoring alerts
- Counsel/regulator contact path

**Pass:** names and contact paths exist in the approved operator copy of the runbooks. Public docs may use roles only.

---

## Workstream C — Hosted staging foundation

**Closes:** “provision development and staging Supabase projects” and hosted Auth configuration.  
**Owner:** engineering, after infrastructure approval.  
**Approval required:** explicit approval before creating paid/external projects.

### C1. Projects and secrets

- Create separate **development** and **staging** Supabase projects. Do not reuse one project for both.
- Store URL, anon key, service role, and SMTP/Auth secrets in a secret manager. Never commit them. Never put a service-role key in Vite/browser env.
- Confirm `src/supabase-config.js` still rejects insecure project URLs and server secrets before bundling.

**Pass:** two project IDs recorded in the operator inventory; secret-manager paths listed; `npm audit --omit=dev` still clean.

### C2. Schema, storage, and privileges

On both projects, in order:

1. Apply all twenty-one migrations in `supabase/migrations/`.
2. Apply `supabase/storage-policies.sql`.
3. Create the private `case-attachments` bucket with the documented MIME and 10 MB limits.
4. Confirm portable authenticated privileges from `202608280014_authenticated_privileges.sql` (no extra broad grants).

**Pass:** migration history matches the repo; RLS enabled on all 25 private tables; bucket is private; no authenticated update/delete storage policies.

### C3. Hosted Auth

Configure invited-account passwordless sign-in:

- Redirect allowlist limited to credential-free HTTPS app origins
- Email templates that never ask for child, health, school, diagnosis, or IEP information
- JWT lifetime and refresh-token settings compatible with 15-minute inactivity sign-out and 10-minute recent-auth for export/deletion
- No public self-serve account creation

**Pass:** an invited synthetic guardian and an invited synthetic educator can each complete a magic-link sign-in on two devices; uninvited addresses are refused; redirect to a non-allowlisted origin is rejected.

### C4. Synthetic two-household seed

Create households A and B with distinct administrator accounts plus guardian/educator memberships as required by `docs/HOSTED_STAGING_VERIFICATION.md`.

Each household needs a policy-visible sentinel in every one of the 25 private tables and one clean synthetic object in `case-attachments`.

**Pass:** seed script or operator checklist recorded; no real names or family data.

---

## Workstream D — Live staging verification

**Closes:** hosted isolation, multi-device durability, parent/educator journeys on real Auth, deployed privacy exercises.  
**Owner:** engineering.  
**Depends on:** C complete. Real-family language from B1 is not required if only synthetic data is used.

### D1. Hosted read isolation (104 checks)

Set trusted-shell variables from `.env.example` (`BRITELINK_TEST_ENVIRONMENT=staging` and the two admin JWTs). Run:

```sh
npm run verify:hosted-isolation
```

**Pass:** 104 checks green. Store only the privacy-minimal summary JSON. Any leaked row, missing sentinel, or HTTP error fails the gate.

### D2. Hosted mutation-denial matrix

Extend D1 with writes, not only reads:

- Guardian A cannot write activities, messages, intake, export, or deletion against household B
- Educator A cannot transition, author, review, deliver, or message household B
- Direct table inserts that forge household or actor attribution are denied
- Attachment upload to the other household prefix is denied; clean download of the other household’s object is denied

**Pass:** dated staging report listing each denied mutation. The current verifier explicitly does not cover this; this workstream does.

### D3. Multi-device parent journey

Against staging, with a real invited guardian session on two browsers/devices:

1. Complete versioned intake and consent (use a staging-only notice version until B1 is signed).
2. After staff publish (D4), open the plan, start/pause/complete/skip a lesson, add a note, reschedule for illness.
3. Send a message with an allowed attachment; see pending-scan; retry a failed upload without duplicating the message.
4. Acknowledge delivery; request an entitled revision on Complete; download household export; submit a deletion request; withdraw consent on a throwaway household.

**Pass:** both devices show the same durable state after reload; no demo-banner claims; screenshots/notes use synthetic names only.

### D4. Multi-device educator journey

Against staging, with distinct author and reviewer accounts:

1. Accept usable intake and start the package SLA.
2. Assign within capacity; author a multi-week plan; attach a governed resource to a non-first lesson; link a required-resource substitute.
3. Reviewer (not author) approves; publish; deliver; retry a bounced delivery without duplicating the artifact.
4. Accept a revision, author a new version, re-review, complete with change summary, re-deliver.
5. Admin absence hold and overdue evaluation.

**Pass:** author cannot approve own plan in the live database; parent sees the selected lesson’s actual instructions, materials, adaptations, adult-help, and resources; delivery states are not conflated.

### D5. Deployed privacy and offboarding exercises

On staging synthetic households, exercise:

- Correction that appends a profile version
- Export scoped to one household
- Deletion request → independent schedule → cancellation
- Staff offboarding that holds assigned cases and refuses removal of the last guardian
- Consent withdrawal that holds cases and ends educator profile access

**Pass:** written staging exercise log. Physical erasure is Workstream E, not this step.

---

## Workstream E — Payments, scanner, and erasure

**Closes:** paid-case production path, attachment safety, counsel-approved deletion execution.  
**Owner:** engineering + operator.  
**Depends on:** C and D for adapters; B1 retention schedule before erasure jobs can run on any environment that might later hold real data.

### E1. Signed payment webhook and checkout

`docs/PAYMENT_OPERATIONS.md` is the contract. The database already ingests verified events; it does not verify signatures or create sessions.

- Choose a provider and implement signature verification at a server-side webhook (not in the browser).
- Map only event key, checkout ID, package, status, currency, amount, case, and occurrence time into `admin_ingest_payment_event`.
- Configure secret rotation, rate limits, alerting, and dead-letter/retry.
- For private beta, either a real checkout or an operator-triggered verified test event is acceptable; unsigned manual SQL is not.

**Pass:** staging provider events for paid, exact replay, altered replay, refund, stale event, and chargeback reconcile to the provider dashboard. Raw payloads, cards, and signatures are never stored.

### E2. Malware scanner and attachment lifecycle

Follow `docs/ATTACHMENT_OPERATIONS.md`:

- Isolated scanner reads quarantined objects with service credentials
- Records only `clean` or `rejected` through a trusted adapter
- Rejected objects deleted promptly; metadata retained per retention schedule
- Alerts on stale scans, scanner failure, rejected objects, and orphan metadata

**Pass:** staging proof of unsafe-file rejection, scanner outage honesty, uploader-owned retry, and cross-household download denial. Staff never mark an object clean from a desktop scan.

### E3. Physical deletion job

After B1’s retention schedule exists:

- Implement the separately authorized service job described in `docs/PRIVACY_OPERATIONS.md`
- Disable access and erase primary data, derived files, search indexes, delivery artifacts, and backup-expiry records only after scheduled eligibility
- Dry-run first; log candidate counts and legal-hold exclusions; reconcile after run

**Pass:** staging dry-run and one synthetic scheduled erasure with reconciliation. The schedule RPC remains cancellable and does not itself erase data.

---

## Workstream F — Reliability

**Closes:** monitoring, backups, restore, incident tabletop.  
**Owner:** engineering + named operators from B3.  
**Depends on:** C; E2 if attachments are in the restore set.

### F1. External monitoring and alerts

Follow `docs/MONITORING_OPERATIONS.md`:

- Poll `npm run health:hosted` every five minutes from a trusted environment
- Alert on non-zero exit or a 10-minute missed heartbeat
- Dedicated admin monitor JWT, refreshed before expiry; expired token is a probe failure
- One delivered test alert, one expired-token test, one missed-heartbeat test

**Pass:** monitor platform, alert route, primary/backup owners, and the three tests recorded.

### F2. Managed backups and off-project copies

Follow `docs/RECOVERY_OPERATIONS.md`:

- Paid-project managed backups or PITR meeting the approved RPO (proposed ≤ 24 hours)
- Encrypted logical roles/schema/data export stored outside the project
- Encrypted private-bucket object copy plus SHA-256 manifest
- Versioned app build, migrations, policies, and secret-rotation instructions (no secrets in the manifest)

**Pass:** backup inventory with locations, encryption, and retention aligned to B1.

### F3. Deployed staging restore drill

Restore a staging clone at representative volume into an isolated project. Do not restore over the live staging app.

**Pass:** report with source restore point, start/end, lost-event window, row fingerprints, full RLS check, cross-household denial, attachment checksums, post-restore write, and measured RPO/RTO. Local `npm run test:restore` remains necessary but not sufficient.

### F4. Incident tabletop

Run the tabletop required by `docs/INCIDENT_RESPONSE.md`: cross-household exposure and educator absence.

**Pass:** dated notes, severity calls, comms draft, and corrective actions with owners. Production access/offboarding list reviewed.

---

## Workstream G — Human quality sign-off

**Closes:** Quality gate.  
**Owner:** credentialed educator from B2, after D4 has a reviewable staging corpus.  
**Depends on:** B2 packet + at least one staging-authored plan from D4.

**Pass:** written approval covering curriculum, safeguarding, accessibility, and resource rights for the plans that beta families will receive. If the educator rejects the corpus, fix and re-review before H.

---

## Workstream H — Private beta

**Closes:** Private beta gate and the original “5–10 family private beta” goal.  
**Owner:** named support and incident owners.  
**Depends on:** A–G all passed.  
**Approval required:** explicit approval immediately before invitations or production family data.

### H1. Production cutover checklist

- Production project is a new project, not a renamed staging project
- Migrations, storage, Auth, scanner, webhook, monitor, and backups applied
- `VITE_PRIVACY_NOTICE_VERSION` equals the counsel-approved version
- Isolation verifier and health probe run against production using **synthetic** admin households that remain in production for canaries
- Invite-only accounts; no public signup

### H2. Invite and support

- 5–10 consented households, guardian accounts only
- Written support hours, response SLA, and incident owners
- Package entitlements honored (Essentials 0 revisions / 5-day SLA; Complete 1 / 7-day; Annual 4 / 7-day)
- Start SLA only after usable intake

### H3. Beta success criteria

The beta passes only if:

- No cross-household access incident
- Every delivered plan was independently reviewed
- Delivery, bounce/retry, and acknowledgement are honest in the parent UI
- Export, correction, and deletion requests complete through the approved path
- Monitor alerts reached a human at least once in a planned test during the beta window
- Open medium accessibility findings have documented decisions

**Pass:** dated beta report in the evidence ledger; GitHub issues #1–#13 closed only against that evidence.

---

## Goal-to-workstream map

Every remaining official goal maps to exactly one primary workstream.

| Remaining official goal | Workstream | Evidence artifact |
| --- | --- | --- |
| Manual VoiceOver + true 200%/400% zoom | A2 | `qa/accessibility/manual-report.md` |
| Sites production bundle | A1 | `npm run build` + `npm run test:sites` |
| Provision development and staging Supabase | C1–C2 | Project inventory + applied migrations |
| Hosted Auth, multi-device persistence, redirect/JWT/email | C3, D3–D4 | Two-device sign-in and save/reload notes |
| Counsel-approved notice, consent, retention | B1 | Counsel memo + version string |
| Deployed retention/deletion jobs | E3 | Staging dry-run + synthetic erasure |
| Deployed correction, offboarding, restore exercises | D5, F3 | Staging exercise log + restore report |
| Secrets, external monitoring, named incident contacts | C1, F1, B3 | Secret inventory, alert tests, named roster |
| Managed backups/PITR + staging restore | F2, F3 | Backup inventory + restore timings |
| Private attachment bucket + scanner | C2, E2 | Bucket policies + scanner staging proof |
| Signed payment webhook / checkout | E1 | Provider staging reconciliation |
| Credentialed educator approval | B2, G | Signed quality review |
| 5–10 household private beta | H | Beta report |
| Hosted isolation (104 checks) | D1 | Privacy-minimal verifier JSON |
| Hosted mutation isolation | D2 | Mutation-denial report |
| Incident tabletop | F4 | Tabletop notes |

Original thin-MVP parent and educator journeys are already implemented locally. D3, D4, E1, and H make them true against hosted production.

---

## Out of scope for this plan

These would improve competitiveness but are **not** required to pass the current official goals. Do not block private beta on them:

- Public marketing site, pricing page, or SEO
- Child-facing learner login or AI tutor
- Instant/AI-generated plans
- Server-backed encrypted staff drafts across browser sessions (explicitly deferred)
- Community, forums, or co-op features
- Expanding collection into health, diagnosis, or IEP data

---

## Approval boundaries (unchanged)

Explicit approval is required immediately before:

- Provisioning paid/external infrastructure
- Production deployment
- Real-family data collection
- External communications
- Customer-visible pricing changes
- Private-beta invitations

Local code, tests, documentation, and synthetic preview work remain reversible and in scope without those approvals.

## Highest-leverage next actions

If only one engineering track can start: **Workstream A** (build/Sites + schedule the macOS VoiceOver session).

If infrastructure approval is granted: **Workstream C** on staging, then D1 the same week.

If operators are available: send **Workstream B** packets to counsel and the educator now. Those approvals are on the critical path and do not need a live project.
