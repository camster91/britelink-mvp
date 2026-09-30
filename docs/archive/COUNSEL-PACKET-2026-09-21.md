# Privacy counsel packet — BriteLink private beta

**Prepared:** 2026-09-21
**Status:** DRAFT for review. Not sent. Sending this to counsel is Cameron's action and requires his approval of the exact wording.
**Purpose:** give qualified Canadian privacy counsel everything needed to approve the notice, consent purposes, retention schedule, and breach path for a controlled 5–10 household private beta.

## How to use this document

This is the briefing an engineering team hands to counsel so counsel does not have to reverse-engineer the system. It is deliberately specific: every claim about what the software collects, stores, and deletes names the table or function that implements it, so counsel can verify rather than trust.

Five things are being asked of counsel, listed in "Decisions requested" below. Until they are answered, the product will not accept real family data — this is enforced in code, not by policy alone (see "Enforcement" below).

---

## 1. What BriteLink is

A service that provides homeschool families with an educator-authored, personalised learning plan, delivered through a web workspace, with case-based messaging between the family and BriteLink staff.

**Private beta shape:** 5–10 consented households, guardian accounts only. No public signup, no paid checkout, no child-facing accounts, no advertising, no third-party analytics, no data sale.

**Jurisdiction of operation:** Ontario, Canada. Beta families are expected to be Ontario residents.

## 2. Data collected in the beta

The product is deliberately narrow. This is the complete set.

| Data | Where it lives | Notes |
|---|---|---|
| Guardian email address | `auth.users` (Supabase-managed) | Used only for magic-link sign-in |
| Learner preferred name | `public.learners.preferred_name` | Free text, 1–80 chars. A first name or nickname, not necessarily legal name |
| Learner grade label | `public.learners.grade_label` | e.g. "Grade 3" |
| Learner jurisdiction | `public.learners.jurisdiction` | Province or country, for curriculum rules |
| Planning context | `public.learner_profiles.planning_context` (JSONB, versioned) | Structured curriculum-planning fields: subjects of interest, desired structure, learning-style preferences, scheduling constraints |
| Consent record | `public.guardian_consents` | Notice version, purpose list, guardian, learner, timestamp, withdrawal status |
| Case messages | `public.case_messages` | Family ↔ staff communication, scoped to one case |
| Attachments | `public.case_attachments` + private storage bucket | Family-uploaded files; private beta may ship with uploads disabled |
| Lesson activity state | `public.lesson_activities` | Start/pause/complete/skip, notes on a lesson |
| Authored plans | `public.plans` and children | The learning plan itself |
| Audit events | `public.audit_events` | Who did what, when. Operational, not content |

**Deliberately NOT collected.** Enforced by the intake validation function, not merely by policy:

- No diagnosis, health, or medical information
- No IEP or special-education designation
- No school board, school name, or enrolment record
- No home address, phone number, or postal code
- No unbounded free-text accommodation narrative
- No child login, no child email, no child password
- No payment card data (beta has no payment)

If counsel wants any of these added later, it is a new decision, not a configuration change.

## 3. Why each item is collected

One sentence per purpose, so counsel can assess necessity:

- **Guardian email** — to authenticate the guardian without a password. That is its only use.
- **Learner name, grade, jurisdiction** — an educator cannot author an appropriate plan without knowing roughly who the learner is and which curriculum rules apply.
- **Planning context** — the substance of the service. Without it there is no plan.
- **Consent record** — evidence that consent was obtained, what the guardian agreed to, and when they withdrew.
- **Messages and attachments** — the family needs to communicate with BriteLink about their case, and sometimes share a document.
- **Lesson activity** — turns "we did this" into a record the family can review and export.
- **Plans** — the deliverable the family paid for or, in beta, was given.
- **Audit events** — accountability: who accessed what, for incident investigation and access review.

## 4. Where the data lives and who can see it

- **Hosting:** Supabase (PostgreSQL, authentication, private object storage). Beta runs on infrastructure operated by Cameron at Ashbi on a self-hosted Supabase stack, not on Supabase's managed cloud.
- **Isolation:** every private record carries a household ID. Access is enforced in PostgreSQL row-level security on all 25 private tables, and in a verifier that proves two authenticated households cannot see each other's rows across every table and the private bucket.
- **Access by staff:** BriteLink staff (educators and administrators) can see only cases assigned to them or within their role, checked in the database, not the application. Access is named, least-privilege, audited, and removed at offboarding.
- **No third-party sharing.** No analytics vendor, no advertising, no data broker, no external AI processing of family content.
- **No cross-border transfer decision has been made.** This is one of the questions for counsel: whether the chosen hosting region and any processor relationship requires specific disclosure.

## 5. Guardian rights and how they are implemented

These are built and locally verified. Each is a real path, not a promise.

- **Access / export** — a guardian can request and download an export of their own household's records only. The export is scoped in the database. A second operator reviews scope before release.
- **Correction** — corrections append a new profile version and preserve history. Reviewed plans and consent history are never silently rewritten.
- **Deletion** — a guardian requests deletion; the request is recorded as *pending*. An independent administrator then verifies identity, co-guardian impact, and legal holds before scheduling deletion at least 24 hours ahead. The schedule is cancellable. A separately authorised service job performs physical deletion after the eligibility time and reconciles primary data, derived files, search indexes, delivery artifacts, and backup expiry.
  - **Important for counsel:** the physical-deletion job is **not yet implemented**. Beta therefore promises a reviewed, scheduled deletion path, not instant erasure. Counsel should advise whether the beta notice must say so in those words.
- **Consent withdrawal** — ends educator profile access and holds cases. Built.
- **Offboarding** — staff removal holds assigned cases and refuses removal of the last guardian. Built.

## 6. Retention

**No retention schedule is currently approved, and this is the core ask of counsel.**

The shape we propose, for counsel to correct:

| Record class | Proposed trigger | Proposed duration | Deletion method |
|---|---|---|---|
| Learner profile versions | Last activity | Beta end + 12 months | Hard delete, backups expire per policy |
| Plans and lesson records | Last activity | Beta end + 12 months | Hard delete |
| Case messages and attachments | Last activity | Beta end + 6 months | Hard delete + object delete |
| Guardian consent records | Withdrawal or beta end | 24 months (evidence of consent) | Hard delete |
| Audit events | Event time | 24 months | Hard delete |
| Backups | Backup creation | 30 days rolling | Automated expiry |

These numbers are engineering guesses chosen to be conservative. Counsel should set them. The product enforces whatever schedule is approved — the schedule is data, not code.

## 7. Breach notification

A breach-notification decision path must be named before beta. The ask:

- What triggers notification under PIPEDA and any applicable Ontario requirement?
- Who is the decision-maker, and what is the internal timeline?
- What is the regulator contact path, and what is the family-communication template?

The operational runbooks exist (`docs/INCIDENT_RESPONSE.md`); the names and the legal thresholds do not. Counsel should supply the thresholds; Cameron supplies the names.

## 8. Enforcement — why this is not just policy

Counsel should know the controls are in code:

- `VITE_PRIVACY_NOTICE_VERSION` is a build-time value. Until counsel approves the exact notice text, it is **empty**, and an empty value locks guardian intake entirely. A build without it cannot accept a real family.
- Intake validation rejects a missing or malformed notice version at the database level.
- Consent is recorded with the notice version in force at the time.
- Cross-household access is denied by database policy and proven by test on two authenticated households.

**So: setting the notice version is the act that unlocks real data. Counsel's approval is the switch.**

## 9. Decisions requested

1. **Approve or amend the privacy notice text** and give the exact version string to set in `VITE_PRIVACY_NOTICE_VERSION`.
2. **Approve or amend the consent purposes** — planning, service delivery, secure messaging, and export/deletion administration.
3. **Set the retention schedule** per record class: purpose, trigger, duration, deletion method, backup expiry, legal exception.
4. **Name the breach-notification threshold and decision path.**
5. **Confirm the beta may proceed without the physical-deletion job implemented**, provided the notice describes the reviewed, scheduled path honestly — or specify what must change first.

## 10. Documents to send with this packet

- `docs/PRIVACY_OPERATIONS.md` — the operations baseline
- `docs/RELEASE_READINESS.md` — the privacy gate and its current evidence
- `docs/INCIDENT_RESPONSE.md` — the runbook awaiting thresholds and names
- Intake and consent screens (screenshots, synthetic data only)
- The exact notice text currently in the repository

## Open drafting notes — for Cameron, remove before sending

- The hosting answer in section 4 needs confirming: self-hosted Supabase at Ashbi vs managed cloud. The doc says self-hosted, based on `supabase/` config in the repo and the `docker exec britelink-production-db-1` reality. Confirm before this goes out.
- Retention durations in section 6 are mine, chosen as conservative placeholders. Replace or let counsel set them; do not present them as decided.
- Section 5's deletion limitation is the honest weak point. Do not soften it — counsel will find the gap, and finding it disclosed is better than finding it hidden.
- Consider whether counsel should also see `docs/HOMESCHOOL-RESEARCH.md`, which explains why the product avoids compliance theatre. It is context, not a legal input.
