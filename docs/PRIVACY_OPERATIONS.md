# BriteLink Family Data Operations

Status: implementation baseline pending qualified Canadian privacy counsel approval.

## MVP data rules

- Parent/guardian accounts only; no child login.
- Collect structured curriculum-planning context only. Do not collect diagnosis, health, IEP, school, address, or unbounded accommodation text in private beta.
- Store household ID on every private record and enforce authorization in both the server/service layer and Postgres RLS.
- Public demos, screenshots, fixtures, support examples, and training material use synthetic families only.
- Access is least-privilege, named, reviewed, audited, and removed immediately at offboarding.

## Guardian requests

1. Authenticate the guardian and confirm household membership without requesting sensitive information over ordinary email.
2. Create a case-scoped request record for access/export, correction, or deletion; record timestamps and assigned owner.
3. Export only records from the authenticated household. A second operator reviews scope before release.
4. Corrections create a new version and preserve the audit history; do not silently rewrite reviewed plans or consent history.
5. Deletion creates a pending request. An independent admin verifies identity, co-guardian impact, legal holds, and the approved retention basis before scheduling it at least 24 hours ahead. The schedule remains cancellable and does not itself erase data or disable access.
6. A separately authorized service job disables access and performs physical deletion only after the scheduled eligibility time, then reconciles primary data, derived files, search indexes, delivery artifacts, and backup expiry. That service job is not implemented or approved yet.
7. Deliver exports and confirmations through the secure portal and record guardian acknowledgement.

## Consent and retention

- Consent records include notice version, purpose list, guardian user, learner, timestamp, and withdrawal status.
- A notice change that materially changes purposes requires a new consent version.
- The production retention schedule must name each record class, purpose, trigger, duration, deletion method, backup expiry, and legal exception.
- Retention evaluation must run as an admin-only dry run first. Deletion execution requires a separately reviewed job, logged candidate counts, legal-hold exclusions, and post-run reconciliation.
- Until that schedule and notice are approved, real family data must not enter this MVP.

## Verification before private beta

- Counsel-approved notice, consent language, retention schedule, and breach-notification decision path.
- Cross-household denial tests against the deployed database for every private table and storage bucket.
- Export/correction/deletion exercises with two synthetic households proving no cross-household data appears.
- Staff access review, offboarding exercise, restore/deletion reconciliation, and audit-log review.
