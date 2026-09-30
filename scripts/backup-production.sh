#!/usr/bin/env bash
# Nightly production database backup with a real restore check (#8). Run on the VPS by
# .github/workflows/backup.yml. Nothing here writes to the production database.
#
#   1. pg_dump (custom format) of the whole production database -- public, auth and storage schemas
#      -- to $BACKUP_DIR/nightly-<UTC time>.dump, mode 0600, after checking there is disk room.
#   2. Records row counts of every public table and auth.users at dump time.
#   3. Restores the dump into a throwaway container of the SAME image as production (no network,
#      removed on exit) and requires the same row counts there. A dump that cannot be restored, or
#      restores different data, fails the run -- a failed run is the alert.
#   4. Keeps the newest $KEEP nightly dumps and deletes older ones (only files named nightly-*.dump).
#
# Exit 0 = backed up and verified; 1 = backup failed; 2 = backup written but verification failed.
# Row counts are printed; no row content ever is.
set -euo pipefail
DB_CONTAINER="${DB_CONTAINER:-britelink-production-db-1}"
BACKUP_DIR="${BACKUP_DIR:-/root/britelink-backups}"
KEEP="${KEEP:-14}"
CHECK_CONTAINER="britelink-backup-restore-check"

fail() { echo "FAIL: $*" >&2; exit "${2:-1}"; }
project="$(docker inspect "$DB_CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
[ "$project" = "britelink-production" ] || fail "$DB_CONTAINER is not the britelink-production database (project: ${project:-none})"
image="$(docker inspect "$DB_CONTAINER" --format '{{.Config.Image}}')"
psql_prod() { docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -tA -U postgres -d postgres "$@"; }

# One line per table: "<schema.table> <rows>", sorted. Exact counts; the beta database is small.
COUNT_SQL="select string_agg(format('%s %s', t, n), E'\n' order by t) from (
  select 'auth.users' t, (select count(*) from auth.users) n
  union all
  select format('public.%I', c.relname), (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', c.relname), false, true, '')))[1]::text::bigint
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r') x"

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$BACKUP_DIR/nightly-$stamp.dump"

db_bytes="$(psql_prod -c "select pg_database_size('postgres')")"
free_bytes="$(df -PB1 "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
[ "$free_bytes" -gt $((db_bytes * 3)) ] || fail "not enough disk for a safe backup: ${free_bytes} bytes free, database ${db_bytes} bytes"

echo "== backup =="
before="$(psql_prod -c "$COUNT_SQL")"
umask 077
docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres -Fc > "$dump" || { rm -f "$dump"; fail "pg_dump failed"; }
[ -s "$dump" ] || { rm -f "$dump"; fail "the dump is empty"; }
entries="$(docker exec -i "$DB_CONTAINER" pg_restore --list < "$dump" | grep -vc '^;' || true)"
echo "  ok   $dump ($(du -h "$dump" | cut -f1), $entries archive entries)"
echo "  tables and rows at dump time: $(printf '%s\n' "$before" | wc -l) tables, $(printf '%s\n' "$before" | awk '{s+=$2} END {print s+0}') rows"

echo "== restore check (throwaway $image, no network) =="
docker rm -f "$CHECK_CONTAINER" >/dev/null 2>&1 || true
trap 'docker rm -f "$CHECK_CONTAINER" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$CHECK_CONTAINER" --network none \
  -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')" "$image" >/dev/null
ready=""
for _ in $(seq 90); do
  if docker exec "$CHECK_CONTAINER" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 \
     && docker exec "$CHECK_CONTAINER" psql -X -tA -U postgres -h 127.0.0.1 -d postgres -c 'select 1' >/dev/null 2>&1; then
    ready=1; sleep 5; break
  fi
  sleep 2
done
[ -n "$ready" ] || fail "the restore-check database never became ready" 2
# --clean --if-exists replaces what the image's own init created with the backup's version. Some
# "already exists"/ownership notices are expected against a fresh Supabase image; the row counts
# below are the verdict, not pg_restore's exit status.
docker exec -i "$CHECK_CONTAINER" pg_restore -U postgres -h 127.0.0.1 -d postgres --clean --if-exists --no-owner < "$dump" \
  > /dev/null 2> "$BACKUP_DIR/.restore-check-$stamp.log" || true
after="$(docker exec -i "$CHECK_CONTAINER" psql -X -tA -U postgres -h 127.0.0.1 -d postgres -c "$COUNT_SQL" 2>/dev/null || true)"
if [ -n "$after" ] && [ "$before" = "$after" ]; then
  echo "  ok   restored copy has identical row counts in every table"
  rm -f "$BACKUP_DIR/.restore-check-$stamp.log"
else
  echo "  row count differences (table live restored):"
  join -a1 -a2 -e missing -o 0,1.2,2.2 <(printf '%s\n' "$before" | sort) <(printf '%s\n' "$after" | sort) | awk '$2 != $3' | head -20 | sed 's/^/    /'
  echo "  pg_restore messages: $BACKUP_DIR/.restore-check-$stamp.log ($(wc -l < "$BACKUP_DIR/.restore-check-$stamp.log") lines)"
  fail "the backup did not restore to identical data" 2
fi

echo "== retention (keep newest $KEEP) =="
mapfile -t old < <(ls -1t "$BACKUP_DIR"/nightly-*.dump 2>/dev/null | tail -n +$((KEEP + 1)))
for f in "${old[@]}"; do rm -f -- "$f"; echo "  removed $(basename "$f")"; done
echo "  $(ls -1 "$BACKUP_DIR"/nightly-*.dump | wc -l) nightly dump(s) kept, $(du -ch "$BACKUP_DIR"/nightly-*.dump | tail -1 | cut -f1) total"
echo "PASS: backed up and verified by restore."
