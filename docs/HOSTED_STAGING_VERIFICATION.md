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

**Read isolation (D1), 104 checks at the time of this run:**

> **Updated 2026-09-21.** The sweep now covers **28** tables and **116** checks. Three
> household-scoped tables with RLS enabled (`attachment_object_observations`,
> `attachment_object_deletions`, `retention_execution_ledger`) were outside this list, so the
> 104-check run below did not prove cross-household denial on them. Rerun D1 to obtain
> 116-check evidence before closing the gate.

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

**Run against the self-hosted staging stack on 2026-09-18** (`scripts/selfhosted-staging/up.sh`: a
real `supabase/postgres` + GoTrue + PostgREST + storage-api behind one gateway, every port bound to
127.0.0.1, 23 migrations applied with no shim, seeded with the synthetic two-household set):

- **D1 read isolation: passed.** 25 private tables at the time of the run, 104 checks — both actors, own-household visible
  and cross-household denied on each, plus the bucket list. The storage sentinel is load-bearing
  here: D1 refuses to report at all until *every* administrator can list an own-household object, so
  an empty own-household result fails rather than passes.
- **D2 mutation denial: 23 of 24 denied**, with 4 controls. The 24th is described below.

Read this as evidence about the **schema and its policies**, which are the same on hosted Supabase
because it is the same image, the same migration chain and the same policy SQL. It is *not* evidence
about a hosted project's network configuration, dashboard, backups or PITR, and should not be read
as closing those.

### The one inconclusive probe, and why it is not a gap

`insert.case_messages` returns **inconclusive**, not denied. A guardian forging another household's
case and sender is refused with `[P0001] household membership required`, raised by the
`enforce_insert_rate_limit` **BEFORE INSERT** trigger. By property 1 above a non-authorization error
cannot count as a denial, and that is the correct call: the trigger fires *before* RLS is evaluated,
so the probe cannot see whether RLS would also refuse the write.

It would. `case_messages` has RLS enabled and exactly one policy, `messages_member_select`, which is
`FOR SELECT` — there is no INSERT policy at all, and RLS denies by default. Confirmed behaviourally
rather than by inspection alone: the same guardian inserting into **its own** household, where the
trigger's membership precondition is satisfied and the trigger therefore passes, is still refused
with `42501 new row violates row-level security policy`. The write is denied at two layers; the probe
observes only the outer one.

So the surface *is* covered, but its reported verdict is inconclusive and the gate stays red until
that is resolved. The two sound resolutions are a probe that can observe the RLS layer (for instance
by requiring, statically, that RLS is enabled and that no permissive INSERT policy covers the
actor's role) or a trigger that does not pre-empt it. Widening the error-code check to accept any
`P0001` would be the wrong fix, because it would equally accept an authorization-shaped message from
a probe whose real failure is something else entirely.

The matrix proves each denial is household-specific given the actor's role. It does not prove the
same RPC succeeds on the actor's own household; that control would require writing to staging and
is deliberately not performed.

Neither verifier proves signed payment webhooks, malware scanning, durable multi-device saves,
backup/PITR, deletion execution, monitoring delivery, or production readiness. Those remain
separate release gates.
