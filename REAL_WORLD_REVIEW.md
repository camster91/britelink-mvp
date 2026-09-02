# BriteLink MVP Real-World Review

Reviewed from three independent perspectives: family use, educator/service operations, and technical/privacy readiness. Current-flow screenshots are in `audit-real-world/`.

## Overall verdict

The repository now contains an honest browser-only demo plus locally verified authenticated parent and educator MVP workflows. The original misleading-state and core workflow gaps below have been resolved locally, but the product is still not approved for real family data or paid-service delivery because hosted infrastructure, legal, human-quality, assistive-technology, monitoring, and private-beta gates remain open.

## Implementation progress — 2026-09-01

The frontend now explicitly identifies itself as an interactive browser-only demo, uses fictional data, and no longer presents a live case, educator status, or delivery estimate. It contains eight distinct weeks and correctly scoped week/day/lesson activity, detailed lesson states, illness/travel/caregiver/catch-up rescheduling that preserves work, device-only reload persistence, structured demo intake validation, guardian demo consent, visible focus, readable metadata, 44px attachment actions, coarse-pointer sizing, reduced-motion behavior, and improved accessibility semantics. Automated domain and browser evidence is stored under `qa/p0-integrity/`. A repeatable axe audit now passes WCAG A/AA rules, keyboard traversal/visible-focus checks, and horizontal-overflow checks across all four views at desktop plus 200%- and 400%-equivalent responsive widths; contrast defects found by the first run were corrected. Manual VoiceOver and true 200%/400% browser zoom verification remain outstanding.

The secure Supabase/Postgres scaffold now has twenty-one migrations executing in embedded PostgreSQL. Equally privileged synthetic identities prove cross-household isolation across all 25 private tables plus guardian/staff attribution, portable least-privilege grants, composite tenant-reference integrity on the two directly writable tables, independent author/reviewer separation, atomic authoring, governed publication, server-owned messaging, recoverable quarantined attachment metadata, manifest-backed household portability, recent-authentication enforcement, revision re-delivery, operational exceptions, usable-intake/SLA acceptance, payment-event integrity, database-enforced abuse quotas, allowlisted non-content operational metadata, privacy-minimal operational signals, and reviewed/cancellable deletion scheduling. Sensitive export and deletion RPCs reject JWTs older than 10 minutes, the UI offers a non-account-creating fresh sign-in link, and inactive workspaces sign out after 15 minutes. The versioned export includes the complete plan hierarchy, governed resources, and attachment integrity/scan/object metadata; private binary files are explicitly marked for separate authenticated retrieval and authentication secrets are explicitly excluded. Failed parent attachment uploads can be reset only by the original uploader and reuse the original database-owned path and record; rendered recovery proves the message is not resent or duplicated. Browser configuration rejects insecure project URLs and both modern and legacy server secrets before bundling. An admin-only aggregate health snapshot and credential-safe hosted probe are behaviorally verified with separate project/user credentials and without exposing learner content or entity identifiers. A real PostgreSQL 16 rehearsal now creates an encrypted logical database-and-object archive, restores it into a separate clean cluster, matches all row fingerprints, verifies RLS and cross-household denial, reconciles attachment SHA-256, and completes a post-restore write. The migrations remain unapplied to hosted Supabase, so real Auth configuration, private object storage/scanning, multi-device durability, physical deletion/retention execution, managed backup/PITR and staging restore, externally delivered alerts, named incident contacts, approved privacy language, and launch readiness are not claimed.

When public Supabase configuration is supplied, the application conditionally loads an invited-account-only passwordless sign-in shell and RLS-backed household workspace. It includes session loading, unavailable, membership-empty, learner-empty, retry, explicit multi-household/role selection, learner switching, structured versioned guardian intake/correction, explicit fixed-purpose consent and withdrawal, published-plan/week/day/lesson navigation, learner-scoped activity reads and writes, optimistic rollback, privacy-minimal scheduling exceptions, secure case messaging and unread acknowledgement, delivery acknowledgement, entitled revision request, isolated JSON export, pending deletion request, and sign-out states. Household switches remount all scoped child state and superseded household/plan/message requests are ignored, preventing a slow prior selection from overwriting the active workspace or learner. Intake remains locked until the operator configures the exact privacy-notice version after review. Rendered synthetic-backend audits exercise the full parent journey, two-role household switching, delayed-response isolation, empty states, and WCAG A/AA checks. Unconfigured builds continue to show the explicitly labelled browser-only demo. This parent journey is implemented and locally verified but remains unverified against a live Supabase project; durable multi-device persistence, actual deletion, and legal approval are not claimed.

Authenticated educator/admin accounts now route to a responsive workbench with usable-intake/SLA acceptance, prioritized queue/context, capacity assignment, dynamic multi-week/day authoring, governed resources, secure messages/read/resolution and quarantined attachments, independently reviewed publication, delivery/retry, revision completion/re-delivery, and absence/overdue controls. Governed resources can be attached to any selected lesson, and a required resource must select a reviewed substitute before it can be added; rendered QA proves both relationships. Authors cannot approve their own plan in either the UI or database. Staff plan drafts are isolated by household, case, and author, survive case switches and reloads within the authenticated browser session, clear after a successful immutable save, support explicit discard, and can clone the latest immutable plan. The staff workbench refreshes queue, learner, and supporting context every minute, ignores stale responses, preserves selected-case form state, clears scoped state if a case disappears, and keeps prior trusted panel data if a partial refresh fails. Writes are blocked while authoritative supporting context is incomplete, and mutation actions are single-flight to prevent rapid duplicate submissions. Rendered failure paths prove these refresh and mutation boundaries. Parents receive the actual selected lesson instructions, materials, adaptations, adult-help estimate, and governed resource details; failed, bounced, pending, sent, and acknowledged deliveries are no longer conflated. Case switching still clears selected attachments and approval state. The rendered audits exercise the modeled journeys, including a household-scoped parent attachment upload that remains visibly pending scan, mobile overflow, and WCAG A/AA serious/critical findings. Local payment ingestion, attachment quarantine, and deletion scheduling boundaries are implemented and behaviorally tested, but signed payment webhooks, a deployed private attachment bucket/scanner, hosted Supabase verification, physical deletion jobs, external monitoring/alerts, counsel approval, and a private beta remain incomplete.

## Original parent-flow findings (2026-08-28 baseline)

The findings and backlog below preserve the starting audit. Local completion status is governed by `docs/IMPLEMENTATION_PLAN.md`; they should not be read as descriptions of the current build.

1. **Overview — visually healthy, operationally misleading.** Clear status and next actions, but progress, ETA, Messages, and resource availability are not connected to a real case.
2. **Learning plan — visually healthy, functionally unsafe.** The product promises eight weeks but defines four; weekdays do not change content; all weeks reuse the same lessons; completion state is shared across weeks and disappears on refresh.
3. **Learner profile — readable, but not a valid intake.** Save is local-only; “complete” is shown without validation; essential planning, accessibility, consent, resource, and scheduling context is absent.

## Original P0 launch blockers

### 1. Honest state, authentication, and persistence

- Add parent/guardian authentication and household isolation.
- Persist learner profiles, plans, messages, and completion records.
- Add loading, success, error, retry, session-expired, and conflict states.
- Until persistence exists, label the build as a demo and remove “saved” or live-delivery claims.
- Use synthetic names and content in public bundles and screenshots.

### 2. Correct curriculum and completion model

- Scope data by learner, plan, week, day, and lesson.
- Give every week/day distinct content and make day selection functional.
- Replace one-click “Done” with start, pause, complete, skip, reschedule, and parent note.
- Support illness, travel, missed days, catch-up, adaptations, and schedule reflow without losing work.
- Add lesson objectives, instructions, materials, adult-help estimate, accommodations, and resource substitutions.

### 3. Order-to-delivery service workflow

- Connect purchase to package entitlement, family, learner, and service case.
- Use a real lifecycle: Paid -> Intake pending -> Submitted -> Triage -> Clarification -> Assigned -> Drafting -> Internal review -> Published -> Delivered -> Acknowledged -> Revised/Closed.
- Add on-hold, overdue, cancelled, refunded, chargeback, and educator-absence branches.
- Start the 5-7-day SLA only when a usable intake is received.
- Track delivery, bounce/retry, secure access, and parent acknowledgement.

### 4. Educator workbench and quality gate

- Add case queue, assignment, capacity, due date, and clarification requests.
- Add plan authoring, curriculum mapping, lesson/resource editing, autosave, and version history.
- Require a named credentialed author plus internal review checklist before publishing.
- Keep an audit history of staff access, content changes, approval, delivery, and revisions.

### 5. Child and family data protection

- Establish guardian notice/consent, purpose limitation, retention/deletion, correction, export, and account-deletion workflows.
- Validate Canadian and applicable provincial child/privacy obligations with counsel.
- Use parent/guardian accounts for MVP; avoid child accounts initially.
- Use strict server-side authorization and household row-level security.
- Do not collect health, diagnosis, IEP, or accommodation free text until classification, access, retention, and incident controls are defined.

## Original P1 private-beta requirements

- Structured intake: age/grade, jurisdiction, subjects, prior attainment, learning needs, language, schedule, caregiver availability, devices/printer, budget, content constraints, accessibility, and consent.
- Secure case messaging with unread state, attachments, response ownership, and service SLA. Change “no back-and-forth” to “no required calls.”
- Revision entitlement and workflow for Complete and Annual packages, including eligibility, remaining revisions, version diff, approval, and re-delivery.
- Resource governance: required/optional, free/paid, estimated cost, accounts/ads/privacy, region/edition, attribution, rights, link health, and substitutes.
- Minimal privacy-safe operational monitoring, backups, restore drill, staging/production separation, incident runbook, and account offboarding.
- Security headers, rate limits, schema/input validation, safe sessions, secrets management, and cross-household access tests.

## Original accessibility gaps

- Add `aria-current` or `aria-pressed` to navigation, week/day selection, and lesson completion controls.
- Use a semantic labelled progress element for plan progress.
- Announce save, error, and completion changes with an `aria-live` status.
- Do not hide useful status/actions on mobile; increase 10-11px interface text and verify touch targets.
- Do not rely on colour-only subject/status marks.
- Run keyboard, screen-reader, zoom, contrast, and reduced-motion testing; screenshots alone cannot establish WCAG compliance.

## Original recommended thin MVP

### Parent side

- Sign in
- Complete and submit structured intake
- Respond to clarification requests
- See honest case status and delivery estimate
- Open a published plan with distinct weeks/days/lessons
- Start, pause, complete, skip, reschedule, and annotate a lesson
- Request an entitled revision

### Educator side

- Triage and assign a paid case
- Request clarification
- Draft a versioned plan from structured intake
- Complete curriculum, resource-rights, safety, and accessibility review
- Publish securely and track acknowledgement
- Process revision or exception

## Original pragmatic implementation order

1. Replace hard-coded claims with explicit demo states and synthetic data.
2. Define privacy/data map, lifecycle state machine, and minimal schema.
3. Add Supabase Auth, Postgres, strict row-level security, and save/reload behavior.
4. Implement correct learner/week/day/lesson state and schedule exceptions.
5. Build educator triage, authoring, review, publish, and audit flow.
6. Add messaging, delivery acknowledgement, revisions, resource governance, and accessibility states.
7. Run cross-household denial tests, backup restore, export/delete, consent review, and a 5-10-family private beta.

## Evidence limits

This review now combines frontend/browser evidence with local synthetic-repository and executable PostgreSQL/RLS evidence. It does not establish legal compliance, curriculum quality, hosted production security, or accessibility conformance. Those still require counsel, a credentialed educator, deployed infrastructure testing, and assistive-technology testing.
