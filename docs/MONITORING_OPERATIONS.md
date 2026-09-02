# BriteLink Operational Monitoring

This runbook covers the privacy-minimal household health probe implemented for staging and production monitors. It is locally verified only; no external monitor, alert destination, or named incident contact has been configured.

## Probe contract

Run `npm run health:hosted` from a trusted monitoring environment with:

- `BRITELINK_SUPABASE_URL`: the HTTPS project URL.
- `BRITELINK_SUPABASE_ANON_KEY`: the project’s public publishable/anon API key, supplied separately from the user session.
- `BRITELINK_MONITOR_JWT`: a short-lived token for a dedicated authenticated user holding only the admin membership needed for the monitored household. Do not use a guardian, educator, browser session, or service-role token.
- `BRITELINK_MONITOR_HOUSEHOLD_ID`: the exact household being monitored.

The probe calls the admin-only `admin_operational_health_snapshot` RPC. The project API key authenticates the gateway while the distinct user token supplies the admin identity; neither substitutes for the other. It emits aggregate codes, counts, oldest timestamps, and thresholds only—never learner names, message bodies, file names, IDs, or planning content. Credentials are never printed.

Exit codes are stable monitoring inputs:

| Exit | Meaning | Required response |
| --- | --- | --- |
| 0 | No active signals | Record success |
| 1 | Warning signal | Create a tracked operations warning |
| 2 | Error or critical signal | Page the on-call incident owner |
| 3 | Probe/configuration failure | Page the platform owner; health is unknown |

## Signals and response

| Signal | Severity | First response |
| --- | --- | --- |
| `attachment.scan_stale` | Error | Stop affected downloads, inspect scanner queue, follow attachment incident procedure |
| `delivery.failed` | Error | Inspect delivery provider, retry only through the audited workflow |
| `message.response_overdue` | Warning | Reassign or respond through the case queue |
| `case.sla_overdue` | Critical | Escalate service ownership and contact the family through the approved channel |
| `deletion.job_due` | Critical | Verify legal hold and approvals before the deletion operator acts |
| `payment.pending_stale` | Warning | Reconcile the signed provider event before changing case state |
| `payment.case_binding_missing` | Error | Suspend fulfillment and repair the audited order-to-case binding |
| `operations.recent_error` | Error | Start incident triage using the correlation key in the restricted admin event view |

## Deployment gate

Poll every five minutes and alert if either the probe exits non-zero or no successful probe is received for ten minutes. The trusted monitor must obtain or refresh the dedicated user token before expiry; an expired or failed refresh is a probe failure, not a healthy result. Before private beta, record the monitor platform, alert route, primary and backup incident owners, token refresh/rotation/revocation procedure, one delivered test alert, one expired-token test, and one missed-heartbeat test. A local passing probe is not evidence that alerts work.
