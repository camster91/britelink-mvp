#!/usr/bin/env bash
# Manages the BriteLink staff team (migration 060, issue #100). Run on the VPS by
# .github/workflows/staff.yml. Everyone on the team is added to every family's household, so they
# can see and work on each family's case.
#
#   staff-team.sh list
#   staff-team.sh add EMAIL educator|admin [CASE_LIMIT]
#   staff-team.sh remove EMAIL
#
# The person needs a BriteLink sign-in account first (sign-up is invite-only). Removing someone
# is refused while they still hold an open case; reassign those first.
#
# The repository is public, so its Actions logs are too: this script never prints a full email
# address, only a masked one (c***@example.com).
set -euo pipefail
DB_CONTAINER="${DB_CONTAINER:-britelink-production-db-1}"

fail() { echo "FAIL: $1" >&2; exit 1; }
mask() { sed -E 's/^([^@])[^@]*@/\1***@/'; }
psql_do() { docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -tA -q -U postgres -d postgres "$@"; }
valid_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] && [ "${#1}" -le 254 ]; }

action="${1:-}"
case "$action" in
  list)
    rows="$(psql_do -F $'\t' -c "select email, role, max_active_cases, families from public.staff_team_list()")"
    if [ -z "$rows" ]; then echo "The staff team is empty."; exit 0; fi
    echo "email	role	case limit	families"
    while IFS=$'\t' read -r email role limit families; do
      printf '%s\t%s\t%s\t%s\n' "$(printf '%s' "$email" | mask)" "$role" "$limit" "$families"
    done <<<"$rows"
    ;;
  add)
    email="${2:-}"; role="${3:-}"; limit="${4:-10}"
    valid_email "$email" || fail "that does not look like an email address"
    [ "$role" = educator ] || [ "$role" = admin ] || fail "role must be educator or admin"
    [[ "$limit" =~ ^[0-9]+$ ]] && [ "$limit" -le 100 ] || fail "case limit must be 0-100"
    # The address is validated above, and psql quotes it again as a literal (:'email'). psql only
    # substitutes variables in what it reads from stdin, not in -c.
    shared="$(psql_do -v email="$email" -v role="$role" -v lim="$limit" \
      <<<"select public.staff_team_add(:'email', :'role', :'lim'::integer);")" || fail "could not add them (see the error above)"
    echo "Added $(printf '%s' "$email" | mask) as ${role}; shared ${shared} existing famil$([ "$shared" = 1 ] && echo y || echo ies) with them."
    ;;
  remove)
    email="${2:-}"
    valid_email "$email" || fail "that does not look like an email address"
    removed="$(psql_do -v email="$email" <<<"select public.staff_team_remove(:'email');")" || fail "could not remove them (see the error above)"
    echo "Removed $(printf '%s' "$email" | mask) from the staff team and from ${removed} famil$([ "$removed" = 1 ] && echo y || echo ies)."
    ;;
  *) echo "usage: $0 list | add EMAIL educator|admin [CASE_LIMIT] | remove EMAIL" >&2; exit 2 ;;
esac
