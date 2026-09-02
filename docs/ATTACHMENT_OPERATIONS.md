# Secure message attachment operations

Status: metadata, quarantine states, browser upload adapter, authorization, and storage policies are locally implemented. The private bucket and malware scanner are not deployed.

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

## Deployment requirements

1. Create a private `case-attachments` bucket with the MIME and 10 MB limits documented in `supabase/storage-policies.sql`.
2. Apply the owner-upload and clean-member-download policies. Do not add authenticated update or delete policies.
3. Connect object creation to an isolated malware scanner. The scanner reads quarantined objects with service credentials and records only `clean` or `rejected` through a trusted server adapter.
4. Delete rejected objects promptly while retaining privacy-minimal audit metadata according to the approved retention schedule.
5. Alert when scans remain pending, scanner calls fail, rejected objects appear, or metadata exists without a matching object.
6. Exercise cross-household upload/download denial, unsafe-file rejection, scanner outage, retry, and lifecycle deletion in staging.

Staff must never manually mark an object clean based only on its file name or a local desktop scan. The current admin review RPC is a database trust boundary for a future authenticated scanner adapter, not a browser control.
