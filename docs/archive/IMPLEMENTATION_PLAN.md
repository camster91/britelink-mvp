# BriteLink MVP Implementation Plan

This plan tracks the active goal against `REAL_WORLD_REVIEW.md`. A checked item means current repository evidence exists; it does not imply production launch approval.

For complete end-to-end ship planning including competitor parity, phased roadmap, and private beta → paid launch path, see `docs/END_TO_END_SHIP_PLAN.md`.

## GitHub tracking

- Repository: <https://github.com/camster91/britelink-mvp>
- Governing roadmap: <https://github.com/camster91/britelink-mvp/issues/14>
- Open release gates: issues [#1](https://github.com/camster91/britelink-mvp/issues/1) through [#13](https://github.com/camster91/britelink-mvp/issues/13)
- Verified local-foundation summaries: issues [#15](https://github.com/camster91/britelink-mvp/issues/15) through [#18](https://github.com/camster91/britelink-mvp/issues/18)

GitHub issues are the execution units; this document and `docs/RELEASE_READINESS.md` remain the evidence ledger. An issue closes only when its stated acceptance criteria and required evidence pass.

## Phase 0 — Product integrity

- [x] Clearly label the frontend as an interactive demo.
- [x] Replace potentially real names with explicitly fictional sample data.
- [x] Remove fabricated live order progress, educator status, and delivery estimates.
- [x] Provide eight distinct weeks, five distinct days per week, and unique lesson identifiers.
- [x] Scope activity by lesson and persist sample changes across browser reloads.
- [x] Add start, pause, complete, skip, caregiver note, lesson details, materials, support, and adult-help metadata.
- [x] Add illness, travel, caregiver-schedule, catch-up, and other rescheduling without losing lesson work.
- [x] Add structured sample intake validation and explicit demo consent.
- [x] Add semantic progress, selection states, validation messages, and live save status.
- [x] Add visible keyboard focus, coarse-pointer touch sizing, and reduced-motion behavior.
- [x] Pass automated WCAG A/AA rendered checks, measured contrast, reduced-motion context, and horizontal-overflow checks across all four views at desktop and 320px zoom-equivalent viewport.
- [x] Define a reproducible manual VoiceOver and true Chrome 200%/400% zoom protocol with evidence and pass criteria in `docs/MANUAL_ACCESSIBILITY_QA.md`.
- [ ] Complete manual VoiceOver journey testing and true browser 200%/400% zoom testing with recorded evidence.

## Phase 1 — Secure data foundation

- [x] Define the initial Supabase/Postgres schema and role model.
- [x] Include household isolation and row-level-security policies in the migration.
- [ ] Provision development and staging Supabase projects.
- [x] Implement conditional invited-account Auth and authenticated household-scoped repositories when public Supabase configuration is supplied.
- [ ] Provision and configure hosted Auth, then verify real multi-device persistence, redirect allowlists, email templates, JWT lifetime, and refresh-token behavior.
- [x] Execute PostgreSQL integration tests proving cross-household denial for every household-scoped private table using equally privileged synthetic admins.
- [ ] Implement and schedule deployed retention/deletion jobs after the counsel-approved retention schedule.
- [x] Wire explicit loading, retry, session-expired, offline/conflict handling, and optimistic rollback/recovery into the authenticated parent and educator workflows, including preservation of the last trustworthy staff view when refresh fails.

Implemented but not yet a substitute for live Supabase verification:

- [x] Supabase browser client and repository adapters cover passwordless sign-in, household-scoped reads, activities, and case messages when public environment configuration is supplied.
- [x] Adapter tests verify explicit household/learner/case query scopes and surface database errors with operation context.
- [x] Executable repository boundary denies cross-household reads, writes, messages, exports, and deletion requests.
- [x] Guardian, educator, and admin role checks cover current service operations.
- [x] Versioned consent, household export, soft deletion request, and immutable audit-event behavior are exercised in tests.
- [x] Guardian correction creates a linked immutable profile version; deterministic admin-only retention evaluation identifies eligible records without deleting them.
- [x] Staff offboarding revokes membership, safely holds assigned cases, audits the reason, and prevents removal of the last guardian.
- [x] Operations migration adds RLS-protected orders, messages, reviews, resources, deliveries, and revision requests.
- [x] Reusable operation controller classifies offline, conflict, expired-session, retryable-error, loading, and success states and verifies optimistic rollback/retry behavior.
- [x] Supabase adapter validates and bounds authentication, identifier, lesson-activity, and case-message inputs before issuing queries.
- [x] Auth redirect URLs are restricted to credential-free HTTP(S), and message due/read timestamps require real ISO instants with explicit time zones before network calls.
- [x] Application bootstrap keeps the unconfigured browser-only demo honest and conditionally loads an invited-account passwordless Auth shell when public Supabase configuration exists.
- [x] Authenticated parent shell exposes loading, membership/learner/plan/message empty states, retries, session changes, sign-out, learner switching, published plan navigation, lesson activity writes with optimistic rollback, secure messages, and unread acknowledgement.
- [x] Durable lesson schedule exceptions store a privacy-minimal reason/date pair while preserving activity status and caregiver notes; validation, PostgreSQL constraints, RLS, repository, and rendered interaction checks pass.
- [x] Authenticated guardian intake collects bounded subjects, starting point, strengths, goals, practical supports, language, schedule, caregiver availability, device/printer access, budget, content constraints, and accessibility needs.
- [x] Intake submission is an atomic RPC that self-attributes a fixed-purpose consent, locks and appends an immutable profile version, and writes an audit event; direct table-write bypasses and forged attribution are denied.
- [x] Intake UI remains locked until an operator configures the exact reviewed privacy-notice version; repository status does not claim that counsel approval has occurred.
- [x] Consent withdrawal is a separate self-attributed, one-time, audited RPC; immutable notice/purpose fields cannot be directly updated, active cases move on hold, and educator profile access ends when no active consent remains.
- [x] Guardian service controls acknowledge sent deliveries exactly once, update the linked case, and audit the acting user through a household-scoped RPC.
- [x] Guardian revision requests require acknowledged delivery and enforce package entitlements (Essentials 0, Complete 1, Annual 4) through an audited RPC; direct revision inserts are denied.
- [x] Guardian household export is isolated and audited, and the parent workspace downloads the resulting JSON with a sensitive-data warning.
- [x] Guardian deletion requests are explicit, bounded, idempotent, audited pending requests; they do not erase records before identity, co-guardian, retention, backup, and operator review.
- [x] Rendered authenticated-parent audit verifies versioned intake/consent, delivery acknowledgement, entitled revision, export download, deletion request, activity save, scheduling, message send/read, consent withdrawal, learner-switch isolation, household-scoped repository calls, empty states, and serious/critical WCAG findings.
- [x] All twenty-one migrations execute in embedded PostgreSQL; tests prove all-table household isolation across 25 private tables, composite tenant-reference integrity, portable authenticated privileges, guardian/staff attribution, independent author/reviewer separation, atomic authoring, governed publication, delivery/retry, server-owned messaging and attachment quarantine/retry, manifest-backed portability, recent-authentication enforcement, revision completion/re-delivery, operational exceptions, payment-event integrity, abuse quotas, allowlisted non-content operational metadata, operational-signal privacy, and deletion scheduling safeguards using synthetic identities. (Historical record, true at the time it was written: the repository now carries **40** migrations. The embedded-PostgreSQL fixture still executes the first 21 and is honestly scoped as a subset; full-chain execution of all 40 runs in `scripts/migration-harness/validate-migrations.sh` on every CI push and PR.)
- [x] Add a staging-only, credential-safe hosted verifier that requires own-data sentinels and proves bidirectional denial across all 25 private tables and the private attachment bucket (104 checks); local contract tests pass, while live execution remains a staging gate.
- [x] Replaced the overly broad lesson-activity member-write policy with member read plus guardian/admin self-attributed writes.

## Phase 2 — Paid case and educator delivery

- [x] Create order/package entitlement and locally verified paid/refunded state ingestion; provider checkout and signed webhook adapter remain a deployment gate.
- [x] Implement case lifecycle, usable-intake SLA clock, exception states, and assignment queue.
- [x] Build educator intake triage and secure clarification requests.
- [x] Build versioned plan/week/day/lesson authoring and governed resource metadata.
- [x] Add internal review checklist, distinct named author/reviewer, publish lock, and audit history; self-review is rejected by the database and hidden in the workbench.
- [x] Add secure delivery, retry/bounce tracking, and parent acknowledgement.
- [x] Add entitled revision requests, reviewed completion, change summary, and re-delivery.
- [x] Render complete parent lesson execution details—objective, instructions, materials, adaptations, adult-help estimate, and governed resources—and distinguish every delivery state honestly.

Implemented domain/prototype foundations:

- [x] Valid and invalid case transitions are executable and role-checked.
- [x] Educator demo covers intake-to-review transitions, review-before-publish, case clarification, and visible audit history.
- [x] Delivery acknowledgement and package revision entitlements are covered by domain tests.
- [x] Messaging is case-scoped, household-checked, length-limited, and audited in the service layer.
- [x] Audited refund/chargeback ingestion, missed-SLA evaluation, educator-absence hold, and delivery failure/retry branches are executable and tested.
- [x] Usable-intake acceptance validates required planning context and versioned consent before starting a package-specific 5–7 business-day SLA.
- [x] Staff triage queue prioritizes overdue and earliest-due work; assignment enforces household-scoped educator capacity.
- [x] Versioned plan authoring preserves named authors and prior content; the latest reviewed version is the only publishable version.
- [x] Resource governance blocks publication until link, privacy, rights/attribution, region, paid-cost, and required-substitute checks pass.
- [x] Entitled revisions support staff accept/decline decisions, required decline reasons, immutable new plan versions, fresh internal review, change summaries, re-delivery, and guardian re-acknowledgement.
- [x] Authenticated educator/admin accounts route to a distinct responsive workbench with an urgent/SLA-prioritized queue, consented-intake and latest-plan context, loading/empty/error/retry states, valid transition controls, capacity-aware admin assignment, required review checks, and revision disposition.
- [x] Staff triage renders all twelve canonical intake fields in a stable order with explicit empty values; no schedule, caregiver, device, budget, content, or accessibility context is truncated.
- [x] Staff case transitions, assignment, plan review, and revision decisions are RPC-only, self-attributed, role/household checked, and audited; broad direct case/plan/review/delivery writes are removed.
- [x] Rendered staff audit verifies role routing, queue priority, plan approval, publish transition, revision acceptance, household scoping, mobile overflow, and serious/critical WCAG findings against a synthetic repository.
- [x] Staff can build immutable nested week/day/lesson versions, add validated HTTPS/cost/region/rights/privacy/link evidence, and publish only the latest approved governance-complete version.
- [x] Staff can target governed resources to any selected lesson in the latest plan; rendered QA proves the resource is persisted on the chosen non-first lesson only.
- [x] Required resources can select an existing reviewed substitute, preventing the prior publication dead end; rendered QA creates and links the substitute.
- [x] Staff queue, learner, and supporting context refresh every minute; generation guards ignore stale responses, partial failures preserve prior trusted panel data and block mutations, selected-case removal clears scoped form state, and rendered QA verifies each boundary.
- [x] Staff mutations are single-flight, saved immutable plans clear their recovered browser draft, and rendered QA proves rapid plan submission creates one version only.
- [x] Staff can deliver the latest published plan and retry the same failed/bounced record without duplicating the artifact; both operations are authenticated and audited.
- [x] Accepted revisions require a newer approved governance-complete plan and immutable change summary before completion; re-delivery uses that exact new version.
- [x] Message response ownership and due times are server-derived; direct message inserts are denied, and only the response owner or an admin can resolve an open message.
- [x] Admin absence handling clears the assignment, places the case on hold, preserves the prior operational state, and audits a bounded reason; overdue evaluation is time-bounded, role-checked, and audited.
- [x] Case selection resets unsaved authoring, review, decision, message, and exception state so data/checks cannot carry into another learner’s case.
- [x] Submitted-to-triage is reserved for a dedicated RPC that locks the case, validates the latest submitted profile and active fixed-purpose consent, requires core planning context, and starts the Essentials 5-day or Complete/Annual 7-day business SLA atomically.

## Phase 3 — Private-beta readiness

- [x] Household-scoped case messaging includes per-user unread acknowledgement, explicit response ownership, response due times, resolution, overdue evaluation, and locally verified quarantined attachment metadata/upload states. Deployment still requires the private bucket and trusted malware scanner.
- [x] Resource cost, rights, attribution, privacy, region, substitute, and link-health checks are modeled and enforced in the service boundary and schema.
- [ ] Complete secrets controls, external production monitoring/alerts, and named incident contacts. Database-enforced quotas, bounded operational-signal storage, an admin-only aggregate health RPC, a credential-safe severity/exit-code probe, RLS, and repository input validation are locally verified.
- [x] Draft incident, delivery failure, educator absence, data-loss, and privacy operations runbooks define pre-beta evidence and explicit approval limits.
- [x] Deployment worker applies CSP, clickjacking, MIME sniffing, referrer, permissions, and HTTPS transport headers.
- [x] Upgrade Vite to 6.4.3 and refresh vulnerable transitive packages; `npm audit --omit=dev` reports zero known vulnerabilities on 2026-09-01.
- [x] Implement and pass a local encrypted logical database-plus-object restore rehearsal with row fingerprints, full public-table RLS verification, cross-household denial, attachment checksum reconciliation, and post-restore writes.
- [ ] Configure managed backups/PITR and encrypted off-project object backups, then pass the same restore gate against a deployed staging clone at representative volume.
- [ ] Privacy notice and consent language approved by qualified Canadian counsel.
- [ ] Curriculum and safeguarding review approved by a credentialed educator.
- [ ] Exercise correction, account offboarding, retention execution, and restore scenarios in a deployed staging environment.
- [x] Exercise correction, retention eligibility, and account offboarding safeguards in the in-memory service test suite.
- [x] Exercise in-memory export, deletion, refund/chargeback, educator absence, missed-SLA, and delivery-retry scenarios with automated tests.
- [ ] Run a controlled 5–10-household private beta with named support and incident owners.

Locally actionable findings retained from the independent real-world review:

- [x] Make parent and staff message/attachment failures recoverable through an uploader-owned attachment-only retry that reuses the original message, record, and object path, including repeated failures and remaining queued files.
- [x] Preserve staff plan drafts across case switches, reloads, transient offline periods, and auth refresh within the active browser session; isolate by household/case/author, show recovery status, clone the latest immutable plan, and require explicit discard. Cross-browser-session persistence is deliberately deferred until server-backed encrypted drafts exist.
- [x] Add explicit multi-household/role selection, stale-response protection, role rerouting, and full scoped child-state reset on a switch.
- [x] Degrade staff and guardian privacy panels independently, fail closed when no authoritative panel is available, preserve the last known staff workbench during a core refresh outage, and distinguish a successful mutation receipt from a failed follow-up refresh with explicit retry. Rendered parent and staff audits exercise these failure paths.
- [x] Sign authenticated workspaces out after 15 minutes of inactivity and require a server-verified JWT issued within 10 minutes for export/deletion. Rendered QA proves the invited-account fresh-sign-in recovery path and inactivity sign-out; hosted JWT lifetime, email template, redirect allowlist, and refresh-token settings remain deployment gates.
- [x] Expand the household export to schema version 2 with a machine-readable manifest, complete plan/week/day/lesson/resource records, attachment integrity/scan/object metadata, and explicit reasons for separately authenticated binary retrieval and excluded authentication secrets.
- [x] Add repeatable keyboard traversal/visible-focus evidence, 200%/400% responsive viewport-equivalence checks, and readable/touch-safe metadata and attachment controls across all four demo views.
- [ ] Complete manual VoiceOver journey testing and true browser 200%/400% zoom testing with recorded evidence.

## Current verification evidence

- `npm test`: domain and packaging suite.
- `npm run build`: production/Sites bundle.
- `qa/p0-integrity/`: browser evidence for honest demo state, scoped plan state, reload persistence, layout, and validated intake.
- `supabase/migrations/202608280001_core.sql`: proposed secure data foundation; not yet applied to a live environment.
- `supabase/migrations/202608280002_operations.sql`: proposed paid-case and delivery operations schema; not yet applied to a live environment.
- `supabase/migrations/202608280003_lesson_scheduling.sql`: paired reason/date scheduling fields on guardian-controlled lesson activity; not yet applied live.
- `supabase/migrations/202608280004_guardian_intake.sql`: RPC-only atomic profile/consent versioning, direct-write denial, and audited consent withdrawal; not yet applied live.
- `supabase/migrations/202608280005_guardian_service_privacy.sql`: guardian delivery acknowledgement, entitled revision, household export, and pending deletion-request RPCs with direct-write denial; not yet applied live.
- `supabase/migrations/202608280006_staff_operations.sql`: RPC-only staff lifecycle, capacity assignment, review, and revision decisions with authenticated actor attribution; not yet applied live.
- `supabase/migrations/202608280007_staff_authoring_delivery.sql`: atomic nested plan authoring, resource governance, secure delivery, and retry RPCs with direct-write denial; not yet applied live.
- `supabase/migrations/202608280008_staff_revision_messaging_exceptions.sql`: revision completion, server-owned messaging, resolution, absence hold, and overdue-evaluation RPCs; not yet applied live.
- `supabase/migrations/202608280009_usable_intake_sla.sql`: usable-intake validation and weekend-aware package SLA acceptance with generic triage bypass removed; not yet applied live.
- `supabase/migrations/202608280010_payment_integrity.sql`: idempotent case/order/package payment-state ingestion, direct-write denial, terminal refunds/chargebacks, and privacy-minimal payment event audit; not yet applied live.
- `supabase/migrations/202608280011_operational_controls.sql`: per-user/household quotas on sensitive writes plus bounded, admin-only operational signals; not yet applied live.
- `supabase/migrations/202608280012_deletion_safeguards.sql`: independently reviewed, delayed, cancellable deletion scheduling with direct-write denial and immutable audit evidence; physical erasure remains a separate approved service job.
- `supabase/migrations/202608280013_secure_attachments.sql` and `supabase/storage-policies.sql`: bounded RPC-only attachment metadata, generated household/case/message object paths, upload failure and scan quarantine, clean-only private download policy, and audit evidence; bucket/scanner deployment remains pending.
- `supabase/migrations/202608280014_authenticated_privileges.sql`: explicit portable schema/table/sequence privileges with RLS-preserving read access and mutations limited to the two direct-upsert tables.
- `supabase/migrations/202608280015_operational_health.sql`, `src/operational-health.js`, and `scripts/hosted-health-check.mjs`: admin-only aggregate health signals and a strict HTTPS monitor probe; external scheduling, missed-heartbeat detection, alert delivery, and named responders remain pending.
- `supabase/migrations/202608280016_independent_plan_review.sql`: database-enforced separation between the immutable plan author and internal reviewer.
- `supabase/migrations/202608280017_tenant_reference_integrity.sql`: composite foreign keys preventing authenticated direct writes from mixing household, learner, lesson, or message tenants.
- `supabase/migrations/202608280018_operational_metadata_privacy.sql`: table-level and RPC-level allowlist that rejects learner content, nested structures, arbitrary keys, and oversized diagnostic values from operational logs.
- `supabase/migrations/202608280019_attachment_retry.sql`: uploader-owned reset of a failed attachment record so binary retry never creates a second message, metadata record, or object path.
- `supabase/migrations/202608280020_portable_export_manifest.sql`: versioned portability manifest with the full authored hierarchy, governed resources, attachment reconciliation metadata, and explicit binary/credential exclusions.
- `supabase/migrations/202608280021_recent_authentication.sql`: recent-JWT enforcement wrapper for household export and deletion requests, with the privileged internal implementations removed from authenticated access.
- `scripts/local-restore-drill.sh`, `tests/restore-drill.test.mjs`, and `qa/operations/local-restore-drill-report.json`: encrypted clean-cluster logical restore plus object-byte reconciliation evidence; not a hosted restore or production RTO measurement.
- `tests/service-domain.test.mjs`: executable household, role, case-lifecycle, messaging, delivery, revision, export, and deletion checks.
- `tests/supabase-repository.test.mjs`: repository query-scope and database-error behavior.
- `tests/input-validation.test.mjs`: bounded identifiers, email normalization, safe redirect URLs, strict timestamps, activity, message, and acknowledgement validation.
- `tests/sites-worker.test.mjs`: SPA fallback boundaries and deployment security headers.
- `tests/postgres-rls.test.mjs`: executable PostgreSQL migrations and two-household RLS evidence across all 25 household-scoped private tables, including guardian service/privacy/payment/operations/attachment RPC denial; hosted Supabase Auth/storage verification remains separate.
- `qa/operations/`: browser evidence for review-gated publishing, case messaging, and visible audit events.
- `qa/operations/authenticated-workspace-report.json` and `03-authenticated-parent-workspace.png`: rendered authenticated parent intake/consent, delivery, revision, export, deletion request, activity/scheduling, messaging, consent withdrawal, learner-switch, scoping, and accessibility evidence against a synthetic repository.
- `qa/operations/staff-workspace-report.json` and `04-authenticated-staff-workbench.png`: rendered triage, nested authoring, exact non-first-lesson resource targeting, safe periodic queue refresh, secure messaging/resolution, review/publish, delivery/retry, revision completion/re-delivery, absence/overdue controls, case-switch reset, household scoping, mobile, and accessibility evidence.
- `scripts/staff-attachment-recovery-audit.mjs`: rendered staff network-interruption evidence proving one message, one attachment record, and attachment-only recovery.
- `scripts/multi-household-audit.mjs`: rendered guardian/admin dual-membership switching evidence proving explicit selection, role routing, remount/reset behavior, and household-scoped reads.
- `qa/accessibility/report.json` and screenshots: repeatable axe WCAG A/AA, keyboard focus, and overflow evidence for four views at desktop, 640px/200%-equivalent, and 320px/400%-equivalent widths; real VoiceOver and browser zoom remain manual gates.
- `docs/INCIDENT_RESPONSE.md` and `docs/PRIVACY_OPERATIONS.md`: draft operational controls and required private-beta evidence; pending named owners and approvals.
- `docs/RELEASE_READINESS.md`: reconciled evidence ledger separating verified local foundations from deployed, approved, and customer-validated gates.
- `docs/MONITORING_OPERATIONS.md`: privacy-minimal signal/exit-code response contract and explicit external deployment evidence gate.
- `src/hosted-isolation.js`, `scripts/hosted-isolation-check.mjs`, and `docs/HOSTED_STAGING_VERIFICATION.md`: staging-only read-isolation verifier with own-sentinel controls, bidirectional 25-table denial, private-bucket prefix denial, and privacy-minimal output.
