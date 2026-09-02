# Hosted Staging Isolation Verification

Status: verifier implemented and locally contract-tested; no hosted project or credentials are configured in this workspace.

## Purpose

`npm run verify:hosted-isolation` performs a read-only, fail-closed staging check with two distinct synthetic household administrators. It never prints access tokens, entity identifiers, rows, or object names.

The verifier refuses non-HTTPS remote URLs and any environment other than the exact value `staging`. Never run it with production family accounts or production data.

## Required staging fixtures

Before running the verifier, apply all migrations and storage policies to an isolated staging project. Create two synthetic households with distinct administrator accounts. Each household must contain at least one policy-visible synthetic sentinel in every one of the 25 private household tables listed in `src/hosted-isolation.js`, plus one clean synthetic object and matching attachment metadata in the private `case-attachments` bucket.

The own-household sentinel requirement is deliberate: an empty foreign result cannot prove isolation when the foreign table or bucket has no data.

## Environment

Set the trusted-shell variables documented in `.env.example`:

- `BRITELINK_TEST_ENVIRONMENT=staging`
- `BRITELINK_SUPABASE_URL`
- `BRITELINK_SUPABASE_ANON_KEY`
- `BRITELINK_TEST_HOUSEHOLD_A_ID`
- `BRITELINK_TEST_HOUSEHOLD_B_ID`
- `BRITELINK_TEST_ADMIN_A_JWT`
- `BRITELINK_TEST_ADMIN_B_JWT`

Use short-lived access tokens. Do not place real values in `.env.example`, commits, screenshots, reports, terminal transcripts, or tickets.

## Pass contract

Run:

```sh
npm run verify:hosted-isolation
```

A pass requires 104 checks:

- both administrators can see an own-household sentinel on each of 25 private tables;
- neither administrator can see the other household on any of those tables;
- both administrators can list an own-household clean object in the private bucket;
- neither administrator can list the other household’s object prefix.

Any missing sentinel, unexpected response shape, authentication error, HTTP error, or leaked row/object fails the process. Store only the privacy-minimal summary JSON with the release evidence.

## Evidence boundary

This verifier closes the hosted read-isolation and bucket-list portion only after it passes against staging. It does not prove cross-household mutation denial, signed payment webhooks, malware scanning, durable multi-device saves, backup/PITR, deletion execution, monitoring delivery, or production readiness. Those remain separate release gates.
