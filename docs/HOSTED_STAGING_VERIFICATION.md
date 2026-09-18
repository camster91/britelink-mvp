# Hosted Staging Isolation Verification

Status: both verifiers implemented and locally contract-tested; no hosted project or credentials
are configured in this workspace, so neither has ever run against staging.

## Purpose

`npm run verify:hosted-isolation` performs a fail-closed staging check with distinct synthetic
household administrators. It never prints access tokens, entity identifiers, rows, or object
names.

The verifier refuses non-HTTPS remote URLs and any environment other than the exact value
`staging`. Never run it with production family accounts or production data.

**D1 is read-only. D2 is not.** The mutation-denial matrix sends cross-household write attempts
that are all required to be denied. On a correctly configured project they have no effect, but
that is the property under test, so point this at staging only.

## Required staging fixtures

Before running the verifier, apply all migrations and storage policies to an isolated staging
project. Create two synthetic households with distinct accounts:

- **Household A** needs a guardian, an educator, and an admin, each with its own user id and
  short-lived access token.
- **Household B** needs an admin, plus one real row id per surface the matrix probes: a case,
  plan, lesson, lesson activity, message, delivery, revision request, attachment, consent, and
  learner, plus one clean object in the private `case-attachments` bucket.
- Both households need at least one policy-visible synthetic sentinel in every one of the 25
  private household tables listed in `src/hosted-isolation.js`.

The own-household sentinel requirement is deliberate: an empty foreign result cannot prove
isolation when the foreign table or bucket has no data.

## Environment

Set the trusted-shell variables documented in `.env.example`: the seven read-check variables,
then the matrix variables below them. Use short-lived access tokens. Do not place real values in
`.env.example`, commits, screenshots, reports, terminal transcripts, or tickets.

## Pass contract

```sh
npm run verify:hosted-isolation
```

A pass requires two independent parts.

**Read isolation (D1), 104 checks:**

- both administrators can see an own-household sentinel on each of 25 private tables;
- neither administrator can see the other household on any of those tables;
- both administrators can list an own-household clean object in the private bucket;
- neither administrator can list the other household's object prefix.

**Mutation denial (D2), 24 probes behind 4 controls:**

- household A's guardian cannot message, submit intake, export, request deletion, withdraw
  consent, request a revision, acknowledge a delivery, or drive the attachment upload lifecycle
  against household B;
- household A's educator cannot transition, author, review, deliver, message, or decide a
  revision against household B;
- household A's admin cannot assign staff to household B's case;
- a guardian cannot insert a membership, a message, or a lesson activity that forges household B
  or a forged actor, and cannot update household B's lesson activity by id;
- a guardian cannot upload into household B's prefix or obtain a clean download of its object.

Store the summary JSON with the release evidence.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | every configured check passed |
| 2 | a check failed |
| 3 | the read check passed and the mutation matrix could not run for lack of configuration |

Exit 3 exists so that "we could not check" can never be recorded as "we checked and it was
clean". The summary names every missing variable.

## What makes the matrix discriminating

Three properties, each of which a simpler implementation would get wrong:

1. **A denial must be an authorization denial.** A validation error raised before the role check
   looks identical from the outside — same status, same opaque shape. An RPC probe only counts as
   denied when the error message is one of the four authorization messages the migrations
   actually raise. A different message, a `PGRST202` from a misspelled argument name, or a
   not-null violation on a forged insert is reported as **inconclusive**, and inconclusive fails
   the gate. `tests/hosted-isolation.test.mjs` pins each of those three cases.
2. **Every actor must hold the role it claims.** Each token's membership row is read first and
   must show the expected role. Without that, a token belonging to an unrelated account would
   deny every probe with `guardian access required` — for entirely the wrong reason — and the
   matrix would pass while proving nothing.
3. **Household B must be able to reach its own data.** Household B's admin must be able to sign
   its own object before any cross-household storage denial is accepted. Without that control a
   404 or 400 would be uninformative.

The RPC argument names and the four authorization messages are not taken on trust:
`tests/hosted-isolation.test.mjs` reads `supabase/migrations/*.sql` and asserts that each probe
addresses a function that exists, with exactly the arguments the probe sends, and that the
function's first possible failure is an authorization gate. That catches drift between this
verifier and the schema without needing a hosted project.

## Evidence boundary

D1 closes the hosted read-isolation and bucket-list portion, and D2 the cross-household mutation
portion, **only after they pass against staging**. Neither has run there yet, and the matrix
carries stated assumptions about its fixtures (reported in the summary): that every `foreign` id
refers to a row that exists, and that the activity id used for the no-effect probe exists — if it
did not, "0 rows affected" would prove nothing.

The matrix proves each denial is household-specific given the actor's role. It does not prove the
same RPC succeeds on the actor's own household; that control would require writing to staging and
is deliberately not performed.

Neither verifier proves signed payment webhooks, malware scanning, durable multi-device saves,
backup/PITR, deletion execution, monitoring delivery, or production readiness. Those remain
separate release gates.
