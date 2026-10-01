# Lesson save defect: authenticated guardian insert rejected by RLS

**Investigated:** 2026-09-19  
**Environment:** `ssh coolify` → container `britelink-production-db-1` → PostgreSQL database `postgres`  
**Scope of this pass:** read-only live diagnostics and evidence handoff. No policy, schema, role, function, data, or configuration changes were made.

## Summary

A signed-in guardian cannot save lesson progress because the write to `public.lesson_activities` fails with:

```json
{"code":"42501","message":"new row violates row-level security policy for table \"lesson_activities\""}
```

The user-visible effect is that the UI's `saveLessonActivity()` operation cannot persist a status, caregiver note, or rescheduling fields. The application issues a Supabase upsert followed by `.select().single()` in `src/supabase-repository.js`.

**RESOLVED 2026-09-20 by migration 040 `lesson_activity_readback.sql`.** The cause was the SELECT
policy, not the INSERT. `activities_member_select` required `can_read_plan(activity_plan_id(id))`,
and `can_read_plan()` demands an existing published plan. A brand-new activity has no plan link,
so `activity_plan_id(id)` is NULL, `can_read_plan(NULL)` is false, and the read-back fails. Because
PostgREST wraps every write in a CTE that re-reads the row, the whole statement aborted with a
misleading 42501 that pointed at the INSERT. The fix permits unlinked rows within the caller's own
household; cross-household reads stay blocked. Verified end to end through PostgREST. The original
diagnosis text below is preserved as history. The live catalog and plan show only one INSERT policy, and both parts of its `WITH CHECK` are true under the failing role and claims. No hidden restrictive or `ALL` policy, trigger, generated column, default rewrite, rule, view, partition, inheritance path, grant problem, or forced-RLS setting explains the refusal.

The strongest remaining hypothesis is an interaction between `RETURNING` and the SELECT policy. Every captured failing statement uses `RETURNING`. The SELECT policy calls `activity_plan_id(id)`, and that function reads `lesson_activities` by the candidate row's generated ID. A read-only probe with an absent candidate ID returns `activity_plan_id = NULL`, `can_read_plan = false`, and therefore the whole SELECT policy is false.

**UPDATE 2026-09-19 — hypothesis confirmed by the discriminating test.** The required test was subsequently authorised and run. On an empty table, otherwise-identical rolled-back inserts as `authenticated` produced:

```text
without RETURNING:  INSERT 0 1        (success)
with RETURNING id:  ERROR 42501       (failure)
```

The `RETURNING`/SELECT-policy interaction is therefore the failing mechanism, not merely a hypothesis. No write persisted (`final_rows = 0`).

**Important caveat for whoever fixes it.** A separate probe through PostgREST — the path the application actually uses — failed with *and* without `return=representation`, whereas raw SQL distinguishes the two. That means the mechanism above is confirmed at the SQL level, but the PostgREST behaviour is not fully explained by it, and a fix must be verified through the exact PostgREST call the app issues rather than raw SQL alone. An earlier attempted fix (dropping `return=representation` from the app call) did **not** resolve it and was reverted.

## Exact reproduction

The following is the exact raw-psql reproduction recovered from the PostgreSQL log at `2026-09-19 20:33:32 UTC`. It also failed after the INSERT and UPDATE policies were inlined, at `20:43:52 UTC`.

```sh
ssh coolify
docker exec -i britelink-production-db-1 psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
```

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"acd728e9-94ee-4269-bc63-4803e770c785","role":"authenticated"}';

insert into public.lesson_activities
  (household_id, learner_id, lesson_id, status, updated_by)
values
  ('8904bbba-de67-471a-8791-d24d4df2100a',
   '33efa33e-f1ed-4954-8531-6502b3856840',
   '70769d46-244d-4ad3-a22b-138f2eb4f02f',
   'in_progress',
   'acd728e9-94ee-4269-bc63-4803e770c785')
returning 'INSERT OK: ' || id;

rollback;
```

Observed server result:

```text
ERROR: new row violates row-level security policy for table "lesson_activities"
```

The production client uses this upsert shape:

```js
client.from("lesson_activities")
  .upsert(row, { onConflict: "learner_id,lesson_id" })
  .select()
  .single()
```

PostgreSQL logs show PostgREST issuing `INSERT ... ON CONFLICT (learner_id, lesson_id) DO UPDATE ... RETURNING ...`; those statements fail with the same RLS error.

## Current live state

### RLS and role

```sql
select c.relowner::regrole, c.relrowsecurity, c.relforcerowsecurity,
       c.relhasrules, c.relhastriggers
from pg_class c
where c.oid = 'public.lesson_activities'::regclass;
```

```text
owner=postgres  relrowsecurity=true  relforcerowsecurity=false
relhasrules=false  relhastriggers=true
```

`authenticated` is not superuser and does not have `BYPASSRLS`. In the reproduced context, `row_security=on`. The `postgres` role on this host is also not marked superuser, but it **does** have `BYPASSRLS`; that is why the control insert bypassed RLS.

### Current policies

`pg_policies` and raw `pg_policy` both return exactly three policies:

| Policy | Command | Mode | Roles | Relevant expression |
|---|---|---|---|---|
| `activities_guardian_insert` | INSERT | PERMISSIVE | public | inlined membership `EXISTS` AND `updated_by = auth.uid()` |
| `activities_guardian_update` | UPDATE | PERMISSIVE | public | the same predicate in `USING` and `WITH CHECK` |
| `activities_member_select` | SELECT | PERMISSIVE | public | `is_household_member(household_id) AND can_read_plan(activity_plan_id(id))` |

There is no restrictive policy, no `FOR ALL` policy, and no second INSERT policy. The inlined investigation version is still live:

```sql
exists (
  select 1
  from public.memberships m
  where m.household_id = lesson_activities.household_id
    and m.user_id = auth.uid()
    and m.role in ('guardian','admin')
)
and updated_by = auth.uid()
```

### Identity and INSERT predicate

Executed after `SET ROLE authenticated` and setting the JWT claims shown above:

```sql
select current_user, session_user, auth.uid();

select exists (
  select 1 from public.memberships m
  where m.household_id='8904bbba-de67-471a-8791-d24d4df2100a'::uuid
    and m.user_id=auth.uid()
    and m.role in ('guardian','admin')
) as membership_half,
'acd728e9-94ee-4269-bc63-4803e770c785'::uuid=auth.uid() as updated_by_half;
```

```text
current_user=authenticated
session_user=postgres
auth.uid()=acd728e9-94ee-4269-bc63-4803e770c785
membership_half=true
updated_by_half=true
```

The visible membership row is:

```text
household_id=8904bbba-de67-471a-8791-d24d4df2100a
user_id=acd728e9-94ee-4269-bc63-4803e770c785
role=guardian
```

## What was already eliminated

These items came from the completed prior investigation. This pass did not repeat destructive setup or token generation. Where possible, it corroborated the result from the live catalog or server log.

1. **Status value.** The supplied test matrix reports identical RLS failures for each of the five statuses tested. The live enum currently has six labels: `not_started`, `in_progress`, `paused`, `completed`, `skipped`, and `rescheduled`. The server log independently records repeated failures from status probes, though bind values are not logged. No status is referenced by any live RLS policy.
2. **Row existence/conflict.** The supplied evidence says the failure persisted on a fresh insert after deleting all activity rows. This pass did not repeat deletion. Current state now contains one exact learner/lesson pair—the bypass-RLS control row inserted later—so current row count is not evidence against that earlier clean-table test.
3. **Token identity.** The supplied hand-minted JWT and genuine GoTrue session both resolved to the same user and both failed. This pass independently confirmed `auth.uid() = acd728e9-94ee-4269-bc63-4803e770c785` under raw psql claims and found the expected guardian membership.
4. **Triggers.** `pg_trigger` returns 12 triggers, all `tgisinternal=true` referential-integrity triggers for the six foreign keys. There is no user trigger and no `BEFORE` trigger.
5. **SECURITY DEFINER write-policy helpers.** The prior session replaced `has_household_role(...)` with the inlined membership query and the failure persisted. The live policy is still that inlined version. Note that the planner still injects `is_household_member(m.household_id)` while reading `memberships`, because `memberships` has its own SELECT RLS policy; however, the complete in-context membership `EXISTS` returns true.
6. **Foreign keys.** `pg_constraint` returns the six expected FKs: household, learner, lesson, updated user, and the two composite household/learner and household/lesson keys. The referenced household, learner, and lesson are all visible to the authenticated role, and both child rows report the same household ID. The supplied prior investigation verified the referenced unique indexes.
7. **Client/PostgREST.** PostgreSQL logs contain the raw psql failure at `20:33:32 UTC` and again after policy inlining at `20:43:52 UTC`. This independently confirms the defect outside PostgREST.
8. **Grants.** `has_table_privilege('authenticated', 'public.lesson_activities', 'INSERT') = true`. `information_schema.column_privileges` returns INSERT privilege for all ten columns, including `updated_by`.
9. **Both INSERT-policy halves.** The exact role/claims query above returns `true, true`. The membership row itself is visible and has role `guardian`.

The supplied control result—an identical write under the RLS-bypassing `postgres` role succeeds—is consistent with the current persisted row, whose household, learner, lesson, status, and `updated_by` match the test values. This pass did not execute another control insert.

## Additional diagnostics performed

### `EXPLAIN (VERBOSE)`

Both the plain INSERT and the `ON CONFLICT ... DO UPDATE ... RETURNING *` form were planned without execution.

The plain INSERT plan constructs exactly the sent values plus only the declared defaults:

```text
Output: gen_random_uuid(),
        '8904bbba-de67-471a-8791-d24d4df2100a'::uuid,
        '33efa33e-f1ed-4954-8531-6502b3856840'::uuid,
        '70769d46-244d-4ad3-a22b-138f2eb4f02f'::uuid,
        'not_started'::lesson_activity_status,
        NULL::text,
        'acd728e9-94ee-4269-bc63-4803e770c785'::uuid,
        now(), NULL::text, NULL::date
```

Its only displayed policy subplan scans `memberships` by `household_id` and filters on:

```text
is_household_member(m.household_id)
AND m.role = ANY ('{guardian,admin}'::membership_role[])
AND m.user_id = auth.uid()
```

The upsert plan names the expected conflict index, `lesson_activities_learner_id_lesson_id_key`, and shows three copies of the same membership subplan for the INSERT/UPDATE checks. It exposes no extra false predicate.

### Columns, defaults, and generated values

`pg_attribute`/`pg_attrdef` show ten ordinary local columns. None is generated or identity. Defaults are limited to:

- `id = gen_random_uuid()`
- `status = 'not_started'`
- `updated_at = now()`

`updated_by` is `NOT NULL` and has **no default**. The plan shows the exact UUID sent, so no default rewrites it.

### Rules, views, inheritance, and partitions

- Relation kind is `r` (ordinary table).
- `pg_rules` returns zero rows.
- `relhasrules=false`.
- `relispartition=false`, `relhassubclass=false`.
- `pg_inherits` returns zero rows.
- Every column has `attinhcount=0` and `attislocal=true`.

There is no view/rule rewrite or inherited/partitioned target.

### SELECT-policy interaction probe

The live SELECT policy is:

```sql
is_household_member(household_id)
and can_read_plan(activity_plan_id(id))
```

`activity_plan_id(uuid)` is `STABLE SECURITY DEFINER` and begins its lookup from `public.lesson_activities a where a.id = target_activity`.

For an absent candidate UUID, under the authenticated role and exact claims:

```sql
with candidate as (
  select '11111111-1111-4111-8111-111111111111'::uuid as id
)
select
  public.is_household_member('8904bbba-de67-471a-8791-d24d4df2100a') as select_member_half,
  public.activity_plan_id(candidate.id) as activity_plan_id_for_absent_candidate,
  public.can_read_plan(public.activity_plan_id(candidate.id)) as select_plan_half,
  public.is_household_member('8904bbba-de67-471a-8791-d24d4df2100a')
    and public.can_read_plan(public.activity_plan_id(candidate.id)) as whole_select_policy
from candidate;
```

```text
select_member_half=true
activity_plan_id_for_absent_candidate=NULL
select_plan_half=false
whole_select_policy=false
```

For the existing bypass-RLS control row, the same authenticated role sees the row and all relevant predicates are true: household membership, published-plan readability, and `updated_by = auth.uid()`.

This makes the `RETURNING`/SELECT-policy path the leading hypothesis, but the read-only evidence does not establish when PostgreSQL evaluates that self-lookup relative to insertion of the candidate row.

### Temporary diagnostic function drift

Migration `202608280039_diagnose_identity.sql` exists in the checkout, but the function is **not currently present live**:

```sql
select n.nspname, p.proname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.proname='diagnose_caller_identity';
```

Result: `0 rows`.

The PostgreSQL log explains the discrepancy: the function was created at `20:05:34 UTC` and explicitly dropped at `21:03:59 UTC`. Therefore the statement that it “has NOT been removed” was accurate earlier but is stale for current live state. No function change was made during this pass.

## Conclusion

**Resolved 2026-09-20 — cause confirmed.** This section is preserved as the historical record;
the resolution is at the top of this document and the fix is migration
`202608280040_lesson_activity_readback.sql`.

The contradiction described below was real, and the answer lay outside the INSERT path entirely:
the failing statement was never the INSERT but the read-back. PostgREST wraps every write in a CTE
that re-reads the inserted row, so the SELECT policy ran on the new row. That policy required
`can_read_plan(activity_plan_id(id))`, and `can_read_plan()` demands an existing published plan. A
brand-new activity has no plan link, so `activity_plan_id(id)` was NULL, `can_read_plan(NULL)` was
false, the read-back failed, and the whole statement aborted with a 42501 message that pointed at the
INSERT. The raw-SQL tests appeared to distinguish `RETURNING` because raw SQL only performs that
re-read when `RETURNING` is present.

**Cause: the SELECT policy's plan gate, not the INSERT path.** Every catalog-visible INSERT gate was
correctly excluded; the failing gate was on SELECT and applied to the read-back.

## Historical note on the superseded diagnostic step

The step below was completed and is no longer needed: the discriminating test was run, and it
confirmed the `RETURNING`/read-back interaction. Preserved for history only.

On an isolated clone, or with explicit approval for transactionally rolled-back DML on this database, run two otherwise-identical statements against a fresh learner/lesson pair:

1. `INSERT ... VALUES (...)` **without** `RETURNING`.
2. The same `INSERT ... VALUES (...) RETURNING id`.

Wrap each in its own `BEGIN`/`ROLLBACK`, and capture the server result. Do not use `ON CONFLICT`, so UPDATE policies cannot enter the result.

- If the no-`RETURNING` insert succeeds and the `RETURNING` form fails, the SELECT-policy/self-lookup interaction is proved. The next fix investigation should make the SELECT predicate derive the plan from `lesson_id`/the lesson hierarchy without querying the not-yet-visible activity row by its generated `id`, or use an RPC that returns after a controlled insert; any fix requires separate approval and regression checks for publication isolation.
- If both fail, enable executor-level RLS tracing in a disposable PostgreSQL 15 clone or temporarily replace only the INSERT policy with two named one-half policies in that clone, then execute the insert to identify which executor check diverges from the standalone query.

Nothing else is blocked for diagnosis except authority to execute this discriminating DML test or access to a disposable clone.
