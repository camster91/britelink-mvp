# BriteLink backup and recovery operations

Status: local encrypted logical restore rehearsal verified, and the production nightly archive
drilled against a real restore. The nightly archive is well-formed and **empty** — see "Production
archive drill" — so no backup currently evidences recoverability. Managed Supabase backup
configuration and a deployed staging restore remain pending.

## Recovery objectives for private beta

- Proposed RPO: no more than 24 hours of committed customer data.
- Proposed RTO: restore core authenticated service within 4 hours, with attachment recovery allowed to continue behind an explicit unavailable state.
- Run an isolated staging restore before beta and at least quarterly thereafter. Record source restore point, start/end times, lost-event window, counts, checksums, failed checks, owner, and approval.
- Do not restore directly over production as a drill.

These targets require owner approval after the hosted project tier, data volume, support coverage, and operating cost are known.

## Platform facts and implications

Supabase documents daily managed backups for paid projects and optional point-in-time recovery. It also states that database backups contain Storage metadata but **not Storage object bytes**, so BriteLink must protect the private attachment bucket separately. Logical backups use separate roles, schema, and data dumps, and restore through `psql` with failure-on-error and a single transaction.

Authoritative references:

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase Storage object downloads and backup warning](https://supabase.com/docs/guides/storage/management/download-objects)

## Required production backup set

1. Managed database backup or PITR restore point appropriate to the approved RPO.
2. Encrypted logical roles, schema, public/auth data, and migration-history exports stored outside the project.
3. Encrypted private-bucket object copy plus a manifest containing object path, byte size, SHA-256, attachment metadata ID, and backup timestamp.
4. Versioned application build, migrations, storage policies, environment inventory, and secret-rotation instructions. Never put secrets in the backup manifest or repository.
5. Independent retention/expiry controls aligned with the counsel-approved deletion schedule, including backup-expiry reconciliation for completed deletion requests.

## Restore sequence

1. Declare the incident, identify the last known-good restore point, stop writes where practical, and record the maximum data-loss window.
2. Restore into an isolated replacement environment. Pre-create required Supabase roles and managed schemas; restore roles/schema before auth/public data in a single transaction with `ON_ERROR_STOP`.
3. Restore private object bytes separately. Do not mark attachments available merely because Storage metadata exists.
4. Run the verification gate below. Any mismatch blocks cutover.
5. Rotate or reset credentials omitted from backups, recreate required publications/replication configuration, and verify background jobs and scanner/webhook endpoints.
6. Obtain incident-commander approval, switch traffic, watch errors/latency/auth failures, then preserve the failed environment for investigation.

## Mandatory verification gate

- All migrations and expected functions exist.
- Every public private-data table has RLS enabled and expected grants remain mutation-minimal.
- Table row counts and stable row fingerprints match the backup manifest.
- Synthetic household A can read its records; equally privileged household B reads zero.
- Guardian and staff RPC smoke tests and a new audited write succeed.
- Attachment object count, byte size, and SHA-256 match `case_attachments`; missing bytes remain unavailable.
- Latest payment event, delivery, consent, privacy request, audit event, and deletion job reconcile.
- Application login, parent journey, staff journey, export, and restore-specific monitoring pass before cutover.

## Local rehearsal

Run `npm run test:restore`. The script creates two disposable PostgreSQL 16 clusters, builds a source from all migrations, creates an encrypted database-and-object archive, restores into the clean target, and writes `qa/operations/local-restore-drill-report.json`.

That report proves the procedure locally only. Its timing is not a production RTO measurement, its snapshot has an artificial zero-second RPO, and it does not prove Supabase Dashboard/PITR, network, bucket, KMS, alert, or real-volume behavior.

Its 26 public tables are the ones the migrations create in the source it builds itself. It
therefore proves the schema is complete and that RLS is enforceable — and says nothing about
whether the deployed database ever received those migrations. That is what the drill below checks.

## Production archive drill

Run `npm run test:restore:production -- /opt/backups/britelink/<archive>.sql.gz [--repeat]`, on a
host with Docker and the `postgres:16-alpine` image. The script validates the archive, restores it
into a throwaway container with no published port, and writes a report to stdout (progress goes to
stderr, so the report can be captured on its own). It never writes to the backup directory and
never touches the `britelink-postgres` compose project.

| Exit | Meaning |
| --- | --- |
| 0 | the archive restored and its contents were verified |
| 2 | the restore or a verification step failed |
| 3 | the archive is empty, so it cannot evidence recoverability |

Exit 3 exists because an archive with no tables restores perfectly: declared table count matches
restored table count, no error is raised, and every downstream signal is vacuously healthy.

**Result for `britelink-20260917.sql.gz`** (report at `qa/operations/production-restore-drill-report.json`):

- 371 bytes compressed, 643 uncompressed, written by pg_dump 16.15 — a valid archive;
- 0 declared tables, 0 declared data blocks, and a clean restore producing 0 public tables and 0 rows;
- `recoveryEvidence: false`, `rlsCoverageComplete: null`, exit 3.

The backup job is working correctly: it dumps, compresses, sets mode 600, and retains 14 days. The
database it dumps is empty, so **no nightly success and no archive inspected to date constitutes
recovery evidence.** Eight archives from 2026-09-10 to 2026-09-17 are all 367–371 bytes.

### What makes this drill trustworthy

Verified against a synthetic source with known contents (3 tables, 7 rows) as a positive control,
and against a one-character mutation of the same dump as a content-sensitivity control:

- the fingerprint changed on the mutation (`1ecb3e49…` → `2484a242…`) while table and row counts
  stayed identical, so it measures content and not shape;
- restoring twice must produce identical fingerprints, which is the fidelity claim available when
  the source database is not reachable from the drill host;
- a manifest that describes fewer tables than the restore contains is a hard failure, not an empty
  result. The positive control caught exactly this: the first version of the drill read a manifest
  that never ran, fingerprinted nothing, and reported `recoveryEvidence: true` on a database it had
  not inspected;
- with no tables, the row fingerprint is reported as `null`, so the constant value that a broken
  manifest produces can never be read as a digest.

### Boundary

This is a logical restore into a same-host container. It does not prove Supabase Dashboard or PITR
behavior, restore of Storage object bytes, cutover, network or KMS dependencies, or alerting. The
2026-09-17 archive holds no data, so the "representative volume" objective is **not met** — it
cannot be met until the live database has been migrated and populated. Timing here (0.1–0.2 s of
restore) is a measurement of an empty database, not an RTO.

## Nightly backup with a restore check (GitHub Actions)

`.github/workflows/backup.yml` runs `scripts/backup-production.sh` on the VPS every night at 07:43 UTC. Each run:

1. writes a full `pg_dump` (custom format; public, auth and storage) to `/root/britelink-backups/nightly-<time>.dump.unverified`, mode `0600`, after checking there is disk room. It becomes `nightly-<time>.dump` only after the restore check below passes, so every `nightly-*.dump` is a proven backup. A file still ending in `.unverified` failed its check: never restore from it without investigating, and it is not counted or removed by retention;
2. restores it into a throwaway, network-less container of the **same** image as production;
3. requires identical row counts in every public table and in `auth.users`;
4. keeps the newest 14 nightly dumps.

A failed run makes GitHub email the owner. Restoring a dump into production is a manual, deliberate step:

`docker exec -i britelink-production-db-1 pg_restore -U postgres -d postgres --clean --if-exists < /root/britelink-backups/nightly-<time>.dump`

### Off-site copy in Google Drive

After the restore check passes, the same run encrypts that verified dump and puts it in the
**BriteLink backups** folder of the owner's Google Drive as `nightly-<time>.dump.gpg`. Copies older
than 30 days are removed (to Drive's trash). The dump streams from the VPS straight into `gpg`
(AES-256, with a passphrase), so the unencrypted data is never written anywhere but the VPS. Google
only ever holds the encrypted file.

Until both secrets below exist, this step is skipped with a notice, and the backup itself still
runs. Once they exist, a failed copy fails the run, which emails the owner.

**One-time setup (owner, about 10 minutes):**

1. **Passphrase.** Make a long random passphrase (at least 20 characters) and save it in your
   password manager. **Without it the Drive copies cannot be opened. Nobody can recover it for
   you.** Then add it in GitHub: Settings → Environments → `production` → Add secret, named
   `BACKUP_ENCRYPTION_PASSPHRASE`.
2. **Drive access.** On your own computer, install rclone (https://rclone.org/install/), then run:
   `rclone config create gdrive drive scope=drive.file`
   A browser opens: sign in with the Google account whose Drive should hold the backups, and allow
   access. `drive.file` lets rclone see only the files it creates, not the rest of your Drive.
3. Run `rclone config show gdrive`. Copy everything it prints, from the `[gdrive]` line down, into
   a second secret in the same place, named `GDRIVE_RCLONE_CONFIG`.
4. Actions → **Backup** → Run workflow. The last step should end with
   `ok … encrypted copies kept off-site`, and the folder **BriteLink backups** appears in your Drive.

**Restoring from a Drive copy:**

1. Download the `.gpg` file from Drive.
2. `gpg --decrypt nightly-<time>.dump.gpg > nightly-<time>.dump` (it asks for the passphrase).
3. Restore it as above, with `pg_restore … --clean --if-exists`, into the database you are
   rebuilding.

If you revoke rclone's access in your Google account, or change the passphrase, update the matching
secret. A new passphrase applies to new copies only: keep the old one for older copies.
