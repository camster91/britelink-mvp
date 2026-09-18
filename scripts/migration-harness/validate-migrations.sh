#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres and exercise the deletion executor.
#
# Why this exists: supabase/migrations/*.sql target Supabase, so the repo's own tests read
# them *statically* -- they prove structure and intent, never that Postgres accepts the
# plpgsql. That is a real blind spot, and the migrations have never been applied anywhere.
# This harness closes it with a stub auth/storage surface (supabase-shim.sql) and a plain
# postgres:16-alpine container.
#
# Nothing here touches a live database. The container is isolated, has no published port,
# and is removed on exit.
#
# Usage:  bash scripts/migration-harness/validate-migrations.sh
# Needs:  docker with the postgres:16-alpine image already present (no network required).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
migrations="$repo/supabase/migrations"
container="britelink-migration-harness-$$"

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "FAIL: docker is not available." >&2; exit 1; }
if ! docker image inspect postgres:16-alpine >/dev/null 2>&1; then
  echo "== postgres:16-alpine is not present locally, pulling it =="
  docker pull postgres:16-alpine >/dev/null 2>&1 || {
    echo "FAIL: postgres:16-alpine is not present and could not be pulled." >&2
    echo "      On an air-gapped host, preload the image instead." >&2
    exit 1
  }
fi

echo "== starting throwaway Postgres ($container) =="
docker run -d --name "$container" \
  -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')" \
  -e POSTGRES_DB=britelink_harness \
  postgres:16-alpine >/dev/null

# Readiness here is subtler than it looks. The official image boots a TEMPORARY server to run
# its init scripts, stops it, then starts the real one -- and the temporary server answers on
# the same socket. Measured from its own log (postgres:16-alpine, 2026-09-18):
#
#   03:19:13.578  temp server ready          <- pg_isready starts returning 0 here
#   03:19:13.769  fast shutdown request
#   03:19:13.854  FATAL: the database system is shutting down   <- what CI hit
#   03:19:13.886  "PostgreSQL init process complete; ready for start up."
#   03:19:14.052  real server ready
#
# A ~308ms window where pg_isready (and even "select 1" against the real database) succeed,
# followed by a shutdown. Polling at 1s intervals misses it most of the time and hits it
# occasionally -- which is why this passed on a slower host and failed in CI. Both loops
# below close it independently, so neither is load-bearing on its own:
#   1. wait for the init handoff line, which the entrypoint prints after the temp server stops;
#   2. then require the connection to hold for three consecutive seconds, which no temporary
#      server survives.
for _ in $(seq 1 90); do
  docker logs "$container" 2>&1 | grep -q "PostgreSQL init process complete" && break
  sleep 1
done

stable=0
for _ in $(seq 1 90); do
  if docker exec "$container" psql -U postgres -d britelink_harness -tAc 'select 1' >/dev/null 2>&1; then
    stable=$((stable + 1))
    [ "$stable" -ge 3 ] && break
  else
    stable=0
  fi
  sleep 1
done
if [ "$stable" -lt 3 ]; then
  echo "FAIL: Postgres never became stably ready." >&2
  docker logs "$container" 2>&1 | tail -30 >&2
  exit 1
fi

psql_run() { docker exec -i "$container" psql -v ON_ERROR_STOP=1 -q -U postgres -d britelink_harness "$@"; }

echo "== applying Supabase shim =="
psql_run <"$here/supabase-shim.sql"

echo "== applying migrations in order =="
applied=0
for file in "$migrations"/*.sql; do
  name="$(basename "$file")"
  if psql_run <"$file" >/tmp/mh-out 2>/tmp/mh-err; then
    applied=$((applied + 1))
    printf '  ok   %s\n' "$name"
  else
    printf '  FAIL %s\n' "$name" >&2
    cat /tmp/mh-err >&2
    echo "FAIL: $name did not apply." >&2
    exit 1
  fi
done
printf '  %d migrations applied cleanly\n' "$applied"

echo "== applying storage policies =="
psql_run <"$repo/supabase/storage-policies.sql"

echo "== running behavioural assertions =="
# Each file brings its own fixtures and its own UUID namespace, and scopes its seed checks to
# those fixtures, so the two are independent and the glob order does not matter.
for assertions in "$here"/assert-*.sql; do
  printf '  %s\n' "$(basename "$assertions")"
  psql_run -f - <"$assertions"
done

# ---------------------------------------------------------------------------
# The synthetic staging seed runs AFTER the assertions, on purpose.
#
# The assertion files are unit tests over fixtures they create and scope to. The seed is a
# staging data set, and two of its rows are deliberately visible to *global* functions:
# admin_list_pending_scan_attachments() and admin_execute_due_deletion_jobs(). Both are
# written to take every matching row regardless of household. Apply the seed first and the
# assertions would be measuring the seed's rows alongside their own.
#
# Ordering is the cheap fix; the seed's deletion job is also set 90 days out so the executor
# can never select it even in a database where both exist at once. The verify step below is
# what makes this more than an assertion that the SQL parsed.
echo "== checking the seed's refusal guards =="
# A guard that has never been observed refusing is not known to be a guard. These two runs must
# fail; the successful run below is the third. Note the seed deliberately raises rather than
# \quit-ing, because psql's \quit exits 0 and a guard that exits 0 cannot be detected here.
seed_refuses() {
  local label="$1"; shift
  if psql_run "$@" -f - <"$repo/supabase/seed/synthetic-staging.sql" >/dev/null 2>/tmp/mh-guard; then
    echo "  FAIL: the seed ran without $label" >&2
    exit 1
  fi
  printf '  ok   refused without %s\n' "$label"
}
seed_refuses "seed_confirm"
seed_refuses "user uuids" -v seed_confirm=yes

echo "== applying the synthetic staging seed =="
seed_users=(-v create_auth_users=yes
            -v admin_a=5eed0000-0000-4000-8000-00000000ad01
            -v guardian_a=5eed0000-0000-4000-8000-00000000ad02
            -v educator_a=5eed0000-0000-4000-8000-00000000ad03
            -v admin_b=5eed0000-0000-4000-8000-00000000ad04)
psql_run -v seed_confirm=yes "${seed_users[@]}" -f - <"$repo/supabase/seed/synthetic-staging.sql"

echo "== verifying the seeded data =="
# Named verify-, not assert-, because the assert-*.sql glob above must not pick it up: it
# depends on the seed having already been applied, and would fail there.
psql_run "${seed_users[@]}" -f - <"$here/verify-synthetic-seed.sql"

echo "PASS: all $applied migrations applied and every behavioural assertion passed."
