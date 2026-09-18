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

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d britelink_harness >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d britelink_harness >/dev/null 2>&1 || {
  echo "FAIL: Postgres never became ready." >&2; docker logs "$container" | tail -20 >&2; exit 1; }

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
psql_run -f - <"$here/assert-retention-execution.sql"

echo "PASS: all $applied migrations applied and the retention executor behaves as specified."
