#!/usr/bin/env bash
# Bring an existing BriteLink database up to date: apply whichever of migrations 039-052 it is
# missing, in order, each in its own transaction, after a pg_dump backup.
#
# Why this exists: supabase/selfhosted up.sh applies every migration once, at bootstrap, and
# nothing records which files a database has since received. Several of these migrations create
# tables (043, 046, 048-050) and fail if run twice, so "run the new files" by hand is guesswork.
# Each migration is detected here by an object it creates, not by a history table.
#
# Usage (on the VPS, from a copy of current main -- see docs/APPLYING_MIGRATIONS.md):
#   DB_CONTAINER=<supabase db container> bash scripts/apply-pending-migrations.sh           # report only
#   DB_CONTAINER=<supabase db container> bash scripts/apply-pending-migrations.sh --apply   # backup + apply
#
# BACKUP_DIR defaults to /root/britelink-backups. Nothing is applied without --apply.
set -euo pipefail

container="${DB_CONTAINER:?set DB_CONTAINER to the Supabase Postgres container (docker ps --format '{{.Names}}' | grep db)}"
mode="${1:---check}"
[ "$mode" = "--check" ] || [ "$mode" = "--apply" ] || { echo "usage: $0 [--check|--apply]" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
migrations="$here/../supabase/migrations"
backup_dir="${BACKUP_DIR:-/root/britelink-backups}"

psql_do() { docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }
probe() { psql_do -tA -c "select ($1)::int" | tr -d '[:space:]'; }

# Migration number -> a boolean SQL expression that is true once that migration has been applied.
order=(039 040 041 042 043 044 045 046 047 048 049 050 051 052)
declare -A check=(
  [039]="to_regprocedure('public.diagnose_caller_identity(uuid)') is not null"
  [040]="exists(select 1 from pg_policies where schemaname='public' and tablename='lesson_activities' and policyname='activities_member_select' and qual ilike '%is null%')"
  [041]="to_regprocedure('public.provision_beta_household(text,text,text)') is not null"
  # Both halves: the hand-run revokes shared earlier only did the anon part.
  [042]="not has_table_privilege('anon','public.households','SELECT') and not has_table_privilege('authenticated','public.households','INSERT')"
  [043]="to_regclass('public.plan_schedules') is not null"
  [044]="exists(select 1 from information_schema.columns where table_schema='public' and table_name='lessons' and column_name='estimated_minutes')"
  [045]="pg_get_functiondef('public.submit_guardian_intake(uuid,uuid,text,text[],jsonb)'::regprocedure) ilike '%planning structure is invalid%'"
  [046]="to_regclass('public.learning_captures') is not null"
  [047]="exists(select 1 from information_schema.columns where table_schema='public' and table_name='plan_schedules' and column_name='paused_subjects')"
  [048]="to_regclass('public.weekly_notes') is not null"
  [049]="to_regclass('public.shared_activities') is not null"
  [050]="to_regclass('public.calendar_feeds') is not null"
  [051]="exists(select 1 from information_schema.columns where table_schema='public' and table_name='lesson_activities' and column_name='first_completed_at')"
  [052]="to_regtype('public.\"text/calendar\"') is not null"
)
# Re-runnable files (create or replace / drop if exists / revoke / grant): safe to apply when
# missing even if a later migration is present, so they are exempt from the ordering check.
rerunnable=" 039 040 041 042 045 "
file_for() { local hit; for hit in "$migrations"/202608280"$1"_*.sql; do [ -f "$hit" ] && { echo "$hit"; return; }; done; }

echo "== database: container ${container} =="
if [ "$(probe "to_regprocedure('public.guardian_add_learner(uuid,text,text,text,text)') is not null")" != "1" ]; then
  echo "FAIL: migration 038 is not present. This database is older than this script covers;" >&2
  echo "      bootstrap it with scripts/selfhosted-staging/up.sh instead." >&2
  exit 1
fi
echo "  ok   001-038 present (guardian_add_learner exists)"

missing=()
seen_missing=""
for n in "${order[@]}"; do
  f="$(file_for "$n")"
  [ -n "$f" ] || { echo "FAIL: no file for migration ${n} in ${migrations}" >&2; exit 1; }
  if [ "$(probe "${check[$n]}")" = "1" ]; then
    if [ -n "$seen_missing" ] && [[ "$rerunnable" != *" $seen_missing "* ]]; then
      echo "FAIL: ${n} is present but ${seen_missing} is not -- the database is out of order; stop and investigate." >&2
      exit 1
    fi
    printf '  have %s\n' "$(basename "$f")"
  else
    printf '  MISS %s\n' "$(basename "$f")"
    missing+=("$n")
    [[ "$rerunnable" == *" $n "* ]] || seen_missing="${seen_missing:-$n}"
  fi
done

if [ "${#missing[@]}" -eq 0 ]; then echo "Up to date: nothing to apply."; exit 0; fi
if [ "$mode" != "--apply" ]; then
  echo "${#missing[@]} migration(s) missing. Re-run with --apply to back up and apply them."
  exit 0
fi

mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$backup_dir/pre-migrate-${stamp}.dump"
echo "== backing up to ${dump} =="
docker exec "$container" pg_dump -U postgres -d postgres -Fc >"$dump"
[ -s "$dump" ] || { echo "FAIL: the backup is empty; nothing was applied." >&2; exit 1; }
echo "  ok   $(du -h "$dump" | cut -f1) (restore: docker exec -i ${container} pg_restore -U postgres -d postgres --clean --if-exists < ${dump})"

echo "== applying ${#missing[@]} migration(s), each in its own transaction =="
for n in "${missing[@]}"; do
  f="$(file_for "$n")"
  if ! psql_do --single-transaction <"$f"; then
    echo "FAIL: $(basename "$f") failed and was rolled back. Everything before it is applied; nothing after it was attempted." >&2
    exit 1
  fi
  [ "$(probe "${check[$n]}")" = "1" ] || { echo "FAIL: $(basename "$f") ran but its check is still false." >&2; exit 1; }
  printf '  ok   %s\n' "$(basename "$f")"
done
# PostgREST caches the schema; tell it to reload so the new RPCs are callable at once.
psql_do -c "notify pgrst, 'reload schema'"
echo "Done. PostgREST was asked to reload its schema cache."
