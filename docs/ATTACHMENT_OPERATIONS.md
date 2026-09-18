# Secure message attachment operations

Status: metadata, quarantine states, browser upload adapter, authorization, storage policies, the
scanner adapter, and rejected/orphan-object alerting are implemented in this repository. The
private bucket and a ClamAV instance are **not deployed**, so no object has ever actually been
scanned: the scanner ships unwired and exits 2.

## Safety model

- Accept only PDF, JPEG, PNG, and plain-text files, up to 10 MB each.
- Allow at most three active attachments and 20 MB total per message.
- Generate object paths in the database as `household/case/message/attachment`; never trust a browser-provided path.
- Upload into the private `case-attachments` bucket with overwrite disabled.
- Record a browser SHA-256 digest, then keep the object in `pending_scan` quarantine.
- Permit downloads only when metadata is `clean` and the requester is still a household member.
- Never expose a public bucket URL. Clean downloads use a 60-second signed URL.
- Show pending, rejected, and failed states honestly. A message remains delivered if one of its attachments fails.
- Retry a failed upload only through `retry_message_attachment_upload`; it verifies the original uploader, resets the same metadata row to `pending_upload`, and returns the same database-owned path. Parent and staff composers retain remaining queued files and retry them against the original message. Never resend the message or create a second attachment record to recover a binary transfer.
- Fail closed. There is deliberately no `scan_failed` state: a scanner outage leaves the object in `pending_scan` quarantine so `attachment.scan_stale` escalates, and nothing a failed scan can do makes an object downloadable.

## Deployment requirements

Each requirement is annotated with its true state. **In repository** means the code exists and is
covered by tests; it does not mean it is deployed.

1. Create a private `case-attachments` bucket with the MIME and 10 MB limits documented in `supabase/storage-policies.sql`. — **Not deployed.**
2. Apply the owner-upload and clean-member-download policies. Do not add authenticated update or delete policies. — The policies exist in `supabase/storage-policies.sql`; they are unapplied, because there is no bucket to attach them to.
3. Connect object creation to an isolated malware scanner. The scanner reads quarantined objects with service credentials and records only `clean` or `rejected` through a trusted server adapter. — **Adapter written; not deployed.**
   - `supabase/migrations/202608280023_attachment_scan_adapter.sql` adds `admin_record_attachment_scan`, the trusted server adapter that records a verdict. It is revoked from `public` and granted to nobody, so no client — including a household admin — can mark its own upload clean.
   - `scripts/attachment-scanner.mjs` is the service job that drives it. It holds a service-role key and must never run in client code. Unconfigured it prints `UNWIRED` and exits **2, not 0**, because an unconfigured scanner must never read as a passing scan.
   - On any scanner error, timeout, or digest mismatch it records nothing, leaving the object quarantined. `parseClamdReply` treats an unrecognised reply as an error; defaulting an unknown reply to `clean` would quietly publish unscanned files.
4. Delete rejected objects promptly while retaining privacy-minimal audit metadata according to the approved retention schedule. — The scanner removes the rejected object after recording the verdict, and the verdict carries only a bounded result code, never a file name or object path. **Not exercised: no bucket.**
5. Alert when scans remain pending, scanner calls fail, rejected objects appear, or metadata exists without a matching object. — **Implemented.**
   - `attachment.scan_stale` (pre-existing) covers scans that remain pending and scanner calls that fail, since a failed call leaves the row pending.
   - `admin_attachment_integrity_snapshot` adds `attachment.rejected_present`, `attachment.metadata_orphaned`, `attachment.object_orphaned`, and `attachment.reconciliation_stale`. It is admin-gated and household-scoped, like `admin_operational_health_snapshot`.
   - `attachment.reconciliation_stale` is the guard against a vacuous green: the two orphan signals are silently empty for a household nobody has reconciled, so "no orphans" would otherwise read as healthy. SQL cannot enumerate a bucket, so reconciliation is a separate adapter step — `admin_reconcile_attachment_objects`, driven by `--reconcile` — which replaces the observed set rather than accumulating it.
6. Exercise cross-household upload/download denial, unsafe-file rejection, scanner outage, retry, and lifecycle deletion in staging. — **Outstanding.** It needs the bucket and a ClamAV instance. The local migration harness verifies the trust boundary and the record-keeping against a real Postgres; it does not perform a malware scan.

## Not yet verified against real infrastructure

- `listAllObjects` walks Supabase Storage's non-recursive listing to reconcile object paths. No bucket exists, so this walk has never run against real Storage. It is the piece that needs staging evidence before the reconciler is trusted.
- The scanner has never seen a live clamd reply. Its parser is unit-tested against recorded reply shapes; the protocol framing is not.

Staff must never manually mark an object clean based only on its file name or a local desktop scan. `admin_review_message_attachment` and `admin_record_attachment_scan` are database trust boundaries that only a service-credentialed adapter may cross; neither is a browser control.
