# BriteLink Private-Beta Incident Runbook

Status: draft for operator approval. This does not replace legal, privacy, security, or safeguarding advice.

## Ownership and severity

- Incident commander: named production operator on call.
- Privacy lead: named person authorized to assess child/family data exposure.
- Technical lead: named person with production logs, Supabase, hosting, and deployment access.
- Family communications owner: named person responsible for clear, non-technical updates.
- Severity 1: suspected cross-household access, child-data exposure, destructive data loss, account takeover, or unavailable secure plans for all families.
- Severity 2: one-household access failure, missed delivery SLA, repeated delivery bounce, incorrect plan publication, or broken privacy request.
- Severity 3: degraded non-critical workflow with a safe workaround.

Names, phone numbers, and the counsel/regulator contact path must be completed before private beta.

## First 30 minutes

1. Record discovery time, reporter, affected environment, households, cases, and current evidence without copying sensitive content into chat or tickets.
2. Stop the affected operation. For suspected authorization failure, disable the relevant feature or environment; do not delete logs or records.
3. Preserve audit, authentication, database, deployment, and delivery-event evidence with access restricted to the response team.
4. Confirm impact using a synthetic account where possible. Never test one family by opening another family’s records.
5. Assign severity and owners, start an incident timeline, and set the next update time.

## Containment and recovery

- Authorization/privacy: revoke sessions and affected credentials, disable the vulnerable path, verify RLS and server authorization, rotate exposed secrets, and run the complete cross-household denial suite before reopening.
- Bad publication: remove access to the affected artifact, preserve its version/audit record, notify the reviewer, publish only a newly reviewed version, and record parent acknowledgement.
- Delivery failure: record failed/bounced status and error, confirm the secure destination with the guardian, retry through the approved channel, and verify acknowledgement.
- Educator absence: place cases on hold, clear the unavailable assignment, notify the operational owner, reassign within capacity, and recalculate/document the SLA.
- Data loss: make production read-only where practical, restore into an isolated environment, validate household counts and referential integrity, then obtain incident-commander approval before cutover.

## Communications and closeout

- Communicate confirmed facts, what families should do, what BriteLink is doing, and the next update time. Do not speculate.
- The privacy lead and qualified counsel determine notification obligations and deadlines; the application team does not make that legal determination alone.
- Close only after recovery verification, affected-family follow-up, evidence retention, root-cause review, corrective actions with owners/dates, and a tested regression.

## Required launch evidence

- A completed tabletop covering cross-household exposure and educator absence.
- A local encrypted clean-cluster restore rehearsal is recorded in `qa/operations/local-restore-drill-report.json`; a representative deployed staging restore with actual RPO/RTO timings remains required.
- Alert delivery tested to the named operator.
- Production access/offboarding list reviewed.
- Incident template and secure evidence location tested.
