#!/usr/bin/env bash
# Production nightly-dump restore drill.
#
# scripts/local-restore-drill.sh rehearses the *method* against a database it seeds itself, so
# it can prove the mechanics but never that the real nightly archive is recoverable. This drill
# points the same mechanics at an actual archive from /opt/backups/britelink and reports what it
# really contains. It is the difference between "the procedure works" and "this backup works".
#
# What it does:
#   1. validates the archive before trusting it (gzip integrity, dump header, dumping version);
#   2. reads what the archive claims to hold, so a restore cannot be judged against itself;
#   3. restores it into a throwaway PostgreSQL 16 container -- no published port, its own name,
#      removed on exit -- and never into an existing database;
#   4. measures real elapsed time and a real row fingerprint (per-table row count and an
#      md5 over the ordered rows as text);
#   5. with --repeat, restores a second time and requires an identical fingerprint, which is the
#      only fidelity claim available when the source database is not reachable from here.
#
# Exit codes:
#   0  recovery evidence produced: the archive restored and its contents verified
#   2  the restore or a verification step failed
#   3  the archive is empty, so no recovery evidence is possible from it
#
# Exit 3 is the point of this script. An archive with no tables restores perfectly and every
# downstream check would pass vacuously; reporting that as a healthy backup is exactly the
# failure this project has already been burned by.
#
# Usage:
#   bash scripts/production-restore-drill.sh <dump.sql.gz|-> [--repeat] [--keep-container]
#
# Needs: docker with the postgres:16-alpine image present. The restoring psql must understand
# every meta-command the dump was written with; pg_dump has emitted \restrict since 16.10, so
# an older psql fails here loudly rather than being silently patched.
set -euo pipefail

archive=""
repeat=false
keep=false
for arg in "$@"; do
  case "$arg" in
    --repeat) repeat=true ;;
    --keep-container) keep=true ;;
    -*) echo "FAIL: unknown option $arg" >&2; exit 2 ;;
    *) archive="$arg" ;;
  esac
done
if [ -z "$archive" ]; then
  echo "Usage: bash scripts/production-restore-drill.sh <dump.sql.gz|-> [--repeat] [--keep-container]" >&2
  exit 2
fi

log() { printf '%s\n' "$*" >&2; }

work="$(mktemp -d "${TMPDIR:-/tmp}/britelink-restore-drill.XXXXXX")"
cleanup() {
  # Cleared by name pattern, not by a variable: restore_into runs inside a $(...) subshell, so a
  # container name it assigned could never reach this trap, and the first iteration would leak.
  if [ "$keep" = false ]; then
    local ids
    ids="$(docker ps -aq --filter "name=britelink-restore-drill-$$-" 2>/dev/null || true)"
    [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "FAIL: docker is not available." >&2; exit 2; }
docker image inspect postgres:16-alpine >/dev/null 2>&1 || {
  echo "FAIL: postgres:16-alpine is not present locally. Preload it; this drill does not pull." >&2
  exit 2
}

dump="$work/dump.sql.gz"
if [ "$archive" = "-" ]; then
  cat > "$dump"
  archive_name="stdin"
else
  [ -f "$archive" ] || { echo "FAIL: $archive does not exist." >&2; exit 2; }
  cp "$archive" "$dump"
  archive_name="$(basename "$archive")"
fi

log "== validating the archive =="
gzip -t "$dump" || { echo "FAIL: $archive_name is not a readable gzip stream." >&2; exit 2; }
dump_sha="$(sha256sum "$dump" | awk '{print $1}')"
compressed_bytes="$(wc -c < "$dump" | tr -d ' ')"
uncompressed_bytes="$(gzip -dc "$dump" | wc -c | tr -d ' ')"
header="$(gzip -dc "$dump" | head -1)"

# A pg_dump plain-text archive opens with this comment. Anything else is not a dump, and
# restoring it would produce meaningless results rather than a clear failure.
if [ "$header" != "--" ] || ! gzip -dc "$dump" | sed -n '2p' | grep -q 'PostgreSQL database dump'; then
  echo "FAIL: $archive_name does not look like a pg_dump plain-text archive." >&2
  exit 2
fi
dump_version="$(gzip -dc "$dump" | sed -n 's/^-- Dumped by pg_dump version //p' | head -1)"

# What the archive claims to hold. Counted from the dump text so the restored database is
# checked against the archive rather than against itself.
declared_tables="$(gzip -dc "$dump" | grep -c '^CREATE TABLE ' || true)"
declared_public_tables="$(gzip -dc "$dump" | grep -c '^CREATE TABLE public\.' || true)"
declared_data="$(gzip -dc "$dump" | grep -cE '^(COPY |INSERT INTO )' || true)"
log "   $archive_name: $compressed_bytes bytes compressed, $uncompressed_bytes uncompressed"
log "   dumped by pg_dump $dump_version; declares $declared_tables table(s), $declared_public_tables public, $declared_data data block(s)"

empty=false
if [ "$declared_public_tables" -eq 0 ] && [ "$declared_data" -eq 0 ]; then
  empty=true
fi

start_ms="$(date +%s%3N)"

# Starts one container, restores the archive into it, and prints the elapsed restore time in ms.
# The caller sets $container first: this function's body runs in a subshell whenever its output is
# captured with $(...), so any name it assigned itself would be discarded on return, and every
# later docker exec would be handed an empty name.
restore_into() {
  local label="$1"
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker run -d --name "$container" \
    -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')" \
    -e POSTGRES_DB=britelink_restore \
    postgres:16-alpine >/dev/null

  # The image boots a temporary server to run its init scripts, stops it, then starts the real
  # one, and the temporary server answers on the same socket -- a ~300ms window where a naive
  # readiness check succeeds and is immediately followed by a shutdown. Both gates below close
  # it independently.
  for _ in $(seq 1 90); do
    docker logs "$container" 2>&1 | grep -q "PostgreSQL init process complete" && break
    sleep 1
  done
  local stable=0
  for _ in $(seq 1 90); do
    if docker exec "$container" psql -U postgres -d britelink_restore -tAc 'select 1' >/dev/null 2>&1; then
      stable=$((stable + 1))
      [ "$stable" -ge 3 ] && break
    else
      stable=0
    fi
    sleep 1
  done
  if [ "$stable" -lt 3 ]; then
    echo "FAIL: the throwaway Postgres never became stably ready." >&2
    docker logs "$container" 2>&1 | tail -20 >&2
    exit 2
  fi

  local restore_start restore_end
  restore_start="$(date +%s%3N)"
  if ! gzip -dc "$dump" | docker exec -i "$container" \
      psql -v ON_ERROR_STOP=1 --single-transaction -q -U postgres -d britelink_restore >"$work/$label-psql.log" 2>&1; then
    echo "FAIL: the archive did not restore cleanly into a fresh database:" >&2
    tail -20 "$work/$label-psql.log" >&2
    exit 2
  fi
  restore_end="$(date +%s%3N)"
  printf '%s' "$((restore_end - restore_start))"
}

log "== restoring into a throwaway PostgreSQL 16 container =="
container="britelink-restore-drill-$$-first"
restore_duration_ms="$(restore_into first)"

public_tables="$(docker exec "$container" psql -U postgres -d britelink_restore -At \
  -c "select count(*) from pg_tables where schemaname='public'")"
rls_tables="$(docker exec "$container" psql -U postgres -d britelink_restore -At \
  -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")"

# One row per public table: its name, row count, and an md5 over its rows rendered as ordered
# text. query_to_xml runs the per-table query server-side, so this is one round trip and the
# table name is quoted by format() rather than interpolated.
#
# -i is load-bearing. The query arrives on stdin, and without it docker leaves psql with no input:
# psql then exits 0 having printed nothing, the manifest is empty, and the fingerprint below is
# md5 of a newline -- a verified-looking report of a restore nobody inspected. This drill caught
# that on its own first run against a dump with known contents.
manifest() {
  docker exec -i "$1" psql -U postgres -d britelink_restore -At -F '|' <<'SQL'
select c.relname || '|' || (xpath('/row/d/text()', query_to_xml(format($fmt$select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), 'no-rows') as d from public.%I t$fmt$, c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r'
 order by c.relname
SQL
}

manifest_lines="$(manifest "$container" | sort)"
manifest_count="$(printf '%s' "$manifest_lines" | grep -c . || true)"

# The manifest must describe every public table. If it describes fewer, the query did not run --
# and an absent manifest is indistinguishable from an empty database by row count alone, so this
# is checked as a structural precondition rather than inferred from the rows it reports.
if [ "$manifest_count" -ne "$public_tables" ]; then
  echo "FAIL: the row manifest described $manifest_count of $public_tables public table(s); it did not run. Refusing to fingerprint a database that was not inspected." >&2
  exit 2
fi

fingerprint="$(printf '%s\n' "$manifest_lines" | md5sum | awk '{print $1}')"
total_rows="$(printf '%s\n' "$manifest_lines" | awk -F'|' '{split($2,a,":"); s+=a[1]} END{print s+0}')"

# With no tables there is no row content, and md5 of an empty manifest is a constant that looks
# like a real digest. Reporting null keeps that constant from ever being read as evidence -- it is
# the same value a broken manifest produced before this drill checked itself.
if [ "$public_tables" -eq 0 ]; then
  fingerprint_json="null"
else
  fingerprint_json="\"$fingerprint\""
fi
log "   restored $public_tables public table(s), $total_rows row(s), fingerprint $fingerprint"

if [ "$public_tables" -ne "$declared_public_tables" ]; then
  echo "FAIL: the archive declares $declared_public_tables public table(s) but the restore produced $public_tables." >&2
  exit 2
fi

repeat_json='{"performed": false}'
if [ "$repeat" = true ] && [ "$empty" = false ]; then
  log "== restoring a second time to compare fingerprints =="
  container="britelink-restore-drill-$$-second"
  second_ms="$(restore_into second)"
  second_lines="$(manifest "$container" | sort)"
  second_fingerprint="$(printf '%s\n' "$second_lines" | md5sum | awk '{print $1}')"
  if [ "$second_fingerprint" != "$fingerprint" ]; then
    echo "FAIL: two restores of the same archive produced different contents." >&2
    diff <(printf '%s\n' "$manifest_lines") <(printf '%s\n' "$second_lines") >&2 || true
    exit 2
  fi
  repeat_json="{\"performed\": true, \"durationMs\": $second_ms, \"fingerprintsMatched\": true, \"fingerprint\": \"$second_fingerprint\"}"
  log "   second restore matched: $second_fingerprint"
elif [ "$repeat" = true ]; then
  repeat_json='{"performed": false, "reason": "the archive is empty, so a second restore would prove nothing"}'
fi

end_ms="$(date +%s%3N)"
total_ms="$((end_ms - start_ms))"

# Coverage claims are reported as null rather than true when the archive is empty: 0 of 0 tables
# having RLS is not RLS coverage, and saying so would be the vacuous green this drill exists to
# catch.
#
# RLS coverage is recorded but does NOT decide the verdict. This drill answers "is this archive
# recoverable", and a table without RLS in a correctly restored dump is a finding for the access
# control gate, not a failure to restore. Folding the two together would let an unrelated
# schema observation masquerade as a broken backup.
if [ "$empty" = true ]; then
  rls_json="null"
  coverage_json="null"
  verified_json="false"
  reason="The archive is a well-formed pg_dump file that contains no public tables and no data, so restoring it cannot demonstrate that a production database is recoverable. It restores cleanly, and every health signal derived from it would be vacuous."
else
  rls_json="$rls_tables"
  if [ "$rls_tables" -eq "$public_tables" ]; then
    coverage_json="true"
  else
    coverage_json="false"
  fi
  verified_json="true"
  reason="The archive restored cleanly, its declared public table count matched the restored count, and its contents were fingerprinted."
fi

log "== result =="

# Every value embedded below is a number, a hex digest, an ISO-8601 timestamp, a version string
# from the dump header, or a filename reduced to a safe character set -- so no JSON escaping is
# required and none is attempted.
safe_name="$(printf '%s' "$archive_name" | tr -c 'A-Za-z0-9._-' '_')"
printf '{\n'
printf '  "generatedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '  "scope": "production nightly archive restored into a disposable PostgreSQL 16 container",\n'
printf '  "productionRestore": true,\n'
printf '  "archive": {\n'
printf '    "name": "%s",\n' "$safe_name"
printf '    "sha256": "%s",\n' "$dump_sha"
printf '    "compressedBytes": %s,\n' "$compressed_bytes"
printf '    "uncompressedBytes": %s,\n' "$uncompressed_bytes"
printf '    "pgDumpVersion": "%s",\n' "${dump_version:-unknown}"
printf '    "declaredTables": %s,\n' "$declared_tables"
printf '    "declaredPublicTables": %s,\n' "$declared_public_tables"
printf '    "declaredDataBlocks": %s,\n' "$declared_data"
printf '    "isEmpty": %s\n' "$empty"
printf '  },\n'
printf '  "restore": {\n'
printf '    "durationMs": %s,\n' "$restore_duration_ms"
printf '    "publicTables": %s,\n' "$public_tables"
printf '    "totalRows": %s,\n' "$total_rows"
printf '    "rowFingerprint": %s,\n' "$fingerprint_json"
printf '    "publicTablesWithRls": %s\n' "$rls_json"
printf '  },\n'
printf '  "repeatRestore": %s,\n' "$repeat_json"
printf '  "recoveryEvidence": %s,\n' "$verified_json"
printf '  "rlsCoverageComplete": %s,\n' "$coverage_json"
printf '  "reason": "%s",\n' "$reason"
printf '  "totalDurationMs": %s\n' "$total_ms"
printf '}\n'

if [ "$empty" = true ]; then
  log "EMPTY ARCHIVE: $archive_name restored cleanly and contains nothing. No recovery evidence."
  exit 3
fi
if [ "$coverage_json" = "false" ]; then
  log "NOTE: $rls_tables of $public_tables public tables have row level security enabled. This does not affect the restore verdict; raise it on the access control gate."
fi
log "PASS: $reason"
