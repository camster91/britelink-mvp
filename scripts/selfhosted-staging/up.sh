#!/usr/bin/env bash
# Boot the self-hosted staging stack, then apply the real migrations to it.
#
# Why this exists: supabase/migrations/*.sql have never been applied to a real Supabase target.
# The migration harness (scripts/migration-harness) applies them to a plain Postgres behind a
# *shim* that fakes auth.users, auth.uid(), storage.objects, storage.foldername and the three
# roles. That proves the plpgsql parses, but the shim is a stand-in: it cannot disagree with the
# real thing, so it also cannot catch a migration that assumes the wrong shape for any of them.
# This applies them to the genuine articles with no shim in the path.
#
# Nothing here touches an existing service. The stack is its own compose project, its own network
# and its own database, so britelink-web, britelink-postgres, Coolify and the media stack are not
# connected to it in any way. Every port is bound to 127.0.0.1 (see the threat model in
# supabase/selfhosted/docker-compose.yml) because this host has no firewall.
#
# Usage:  bash scripts/selfhosted-staging/up.sh
#         bash scripts/selfhosted-staging/up.sh --bootstrap-only \
#              --stack-dir /opt/britelink-production/supabase/selfhosted \
#              --override /opt/britelink-production/supabase/selfhosted/docker-compose.production.yml
# Teardown:  docker compose -f supabase/selfhosted/docker-compose.yml down -v
#
# The flags exist so production reuses this file's proven bootstrap rather than a copy of it that
# drifts. Everything through the private-bucket assertion is shared; everything after it is
# staging fixture (seed identities, synthetic households, sentinel objects, minted tokens) and
# --bootstrap-only is what draws that line.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

bootstrap_only=false
stack="$repo/supabase/selfhosted"
project=""
overrides=()

while [ $# -gt 0 ]; do
  case "$1" in
    --bootstrap-only) bootstrap_only=true; shift ;;
    --stack-dir) stack="$2"; shift 2 ;;
    --project) project="$2"; shift 2 ;;
    --override) overrides+=("$2"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

compose=(docker compose)
[ -n "$project" ] && compose+=(-p "$project")
compose+=(-f "$stack/docker-compose.yml")
# Guarded rather than "${overrides[@]:-}": an empty array expanded under `set -u` is an unbound
# variable error on bash 4.3 and older, and this host is not the only place this runs.
if [ "${#overrides[@]}" -gt 0 ]; then
  for extra in "${overrides[@]}"; do compose+=(-f "$extra"); done
fi

command -v docker >/dev/null 2>&1 || { echo "FAIL: docker is not available." >&2; exit 1; }

if [ ! -f "$stack/.env" ]; then
  echo "== no .env yet, generating one =="
  node "$here/gen-env.mjs"
fi
# shellcheck disable=SC1091
set -a; . "$stack/.env"; set +a

port="${GATEWAY_PORT:-8099}"
api="http://127.0.0.1:${port}"

# Refuse to run into a port already in use. On this host that is not hypothetical -- nine services
# already listen on 0.0.0.0 -- and the failure otherwise surfaces as a confusing 502 from whatever
# container happens to hold the port.
if ss -ltn 2>/dev/null | grep -q ":${port} "; then
  echo "FAIL: port ${port} is already in use on this host; set GATEWAY_PORT in $stack/.env" >&2
  exit 1
fi

echo "== starting the stack (project: ${STACK_NAME:-britelink-staging}) =="
"${compose[@]}" up -d --wait

db() { "${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }

# ---------------------------------------------------------------------------
# Ordering, and why it is not just "compose up then psql".
#
# The migrations are written against Supabase's schemas, not Supabase's containers. `auth.users`
# and `auth.uid()` do not exist until GoTrue has run its own migrations, and `storage.objects` /
# `storage.foldername()` do not exist until storage-api has run its. Compose's `depends_on` waits
# for the *container* to be healthy, which happens well before either service has finished
# building its schema -- so waiting on compose alone would apply our migrations into a database
# missing the objects they reference, and fail somewhere confusing several files in.
#
# So: wait for the two schemas by name, with a deadline.
# ---------------------------------------------------------------------------
echo "== waiting for the auth and storage schemas to be built by their own services =="
for _ in $(seq 1 90); do
  have="$(db -tAc "select
      (to_regclass('auth.users')        is not null)::int
    + (to_regclass('storage.objects')    is not null)::int
    + (to_regprocedure('auth.uid()')     is not null)::int
    + (to_regprocedure('storage.foldername(text)') is not null)::int" 2>/dev/null || echo 0)"
  [ "$have" = "4" ] && break
  sleep 2
done
if [ "${have:-0}" != "4" ]; then
  echo "FAIL: auth/storage schemas never appeared (got ${have:-0}/4 of auth.users, storage.objects, auth.uid(), storage.foldername)." >&2
  echo "      GoTrue and storage-api each run their own migrations on first boot; check their logs:" >&2
  echo "      docker compose -f $stack/docker-compose.yml logs auth storage" >&2
  exit 1
fi
echo "  ok   auth.users, storage.objects, auth.uid() and storage.foldername all present"

# The three roles the migrations grant to. These come from the image, not from us, so assert them
# rather than assume: every policy in the schema is written `to authenticated`, and a policy
# created against a role that does not exist fails at CREATE time, not at query time.
echo "== asserting the Supabase roles exist =="
for role in anon authenticated service_role authenticator; do
  got="$(db -tAc "select 1 from pg_roles where rolname='${role}'")"
  [ "$got" = "1" ] || { echo "FAIL: role ${role} is missing from the image." >&2; exit 1; }
done
echo "  ok   anon, authenticated, service_role, authenticator"

echo "== applying migrations in order (no shim) =="
applied=0
for file in "$repo"/supabase/migrations/*.sql; do
  name="$(basename "$file")"
  if db <"$file" >/tmp/sh-out 2>/tmp/sh-err; then
    applied=$((applied + 1))
    printf '  ok   %s\n' "$name"
  else
    printf '  FAIL %s\n' "$name" >&2
    cat /tmp/sh-err >&2
    echo "FAIL: $name did not apply to a real Supabase Postgres." >&2
    exit 1
  fi
done
printf '  %d migrations applied\n' "$applied"

echo "== creating the private case-attachments bucket =="
# Created through the Storage API, not by an INSERT into storage.buckets: the API is what applies
# the file-size limit and the MIME allow-list, and going around it would create a bucket that
# looks right and enforces nothing. The limits mirror supabase/storage-policies.sql's header.
status="$(curl -sS -o /tmp/sh-bucket -w '%{http_code}' -X POST "$api/storage/v1/bucket" \
  -H "Authorization: Bearer ${SERVICE_KEY}" -H 'Content-Type: application/json' \
  -d '{"id":"case-attachments","name":"case-attachments","public":false,
       "file_size_limit":10485760,
       "allowed_mime_types":["application/pdf","image/jpeg","image/png","text/plain"]}')"
case "$status" in
  200|201) echo "  ok   bucket created private with a 10 MB limit and a MIME allow-list" ;;
  400|409) echo "  ok   bucket already exists" ;;
  *) echo "FAIL: bucket creation returned HTTP $status:" >&2; cat /tmp/sh-bucket >&2; exit 1 ;;
esac

echo "== applying storage policies =="
db <"$repo/supabase/storage-policies.sql"

echo "== asserting the bucket is NOT public =="
# A public bucket would make every attachment readable by anyone who can guess a path, and the
# whole D1/D2 storage contract assumes otherwise. Cheap to check, catastrophic to get wrong.
public="$(db -tAc "select public from storage.buckets where id='case-attachments'")"
[ "$public" = "f" ] || { echo "FAIL: case-attachments is public (public=${public})." >&2; exit 1; }
echo "  ok   case-attachments is private"

if [ "$bootstrap_only" = true ]; then
  echo
  echo "PASS (--bootstrap-only): the stack is up at ${api}, ${applied} migrations applied, and the"
  echo "      case-attachments bucket exists and is private."
  echo "      Skipped: seed identities, the synthetic seed, sentinel objects, minted tokens and the"
  echo "      isolation verifier -- every one of those is a staging fixture and must never run"
  echo "      against a stack that will hold real family data."
  exit 0
fi

echo
# ---------------------------------------------------------------------------
# Staging fixtures: identities, seed, storage sentinels, tokens -- then the verdict.
#
# Every stage here is idempotent, because the useful thing is to re-run this after a failure without
# wiping the database. Re-applying 23 migrations is the expensive part and there is no reason to pay
# it twice.
# ---------------------------------------------------------------------------
seed_password='staging-seed-password'

echo "== creating the four staging identities through the GoTrue admin API =="
# Real GoTrue users, not rows INSERTed into auth.users. Only a real identity can be signed in, and
# the verifier needs tokens GoTrue actually issued -- which is exactly why the seed's
# create_auth_users escape hatch is not used here. That hatch exists for the migration harness,
# where there is no Auth service to ask.
for who in admin-a guardian-a educator-a admin-b; do
  curl -s -o /dev/null -X POST "$api/auth/v1/admin/users" \
    -H "Authorization: Bearer ${SERVICE_KEY}" -H 'Content-Type: application/json' \
    -d "{\"email\":\"seed-${who}@britelink.invalid\",\"password\":\"${seed_password}\",\"email_confirm\":true}" || true
done

# Resolve the ids from the database rather than from the create response. On a second run the create
# fails with "already registered", so response-derived ids would silently differ between runs.
admin_a="$(db -tAc "select id from auth.users where email='seed-admin-a@britelink.invalid'")"
guardian_a="$(db -tAc "select id from auth.users where email='seed-guardian-a@britelink.invalid'")"
educator_a="$(db -tAc "select id from auth.users where email='seed-educator-a@britelink.invalid'")"
admin_b="$(db -tAc "select id from auth.users where email='seed-admin-b@britelink.invalid'")"
for pair in "admin-a:${admin_a}" "guardian-a:${guardian_a}" "educator-a:${educator_a}" "admin-b:${admin_b}"; do
  [ -n "${pair#*:}" ] || { echo "FAIL: GoTrue never produced an id for ${pair%%:*}." >&2; exit 1; }
done
echo "  ok   admin-a, guardian-a, educator-a, admin-b"

echo "== applying the synthetic seed =="
if [ "$(db -tAc "select count(*) from public.households where id in ('5eed0000-0000-4000-8000-0000000000a1','5eed0000-0000-4000-8000-0000000000b1')")" != "0" ]; then
  echo "  ok   already seeded (the seed refuses a partial re-seed by design, so this is skipped)"
else
  db -v seed_confirm=yes \
     -v "admin_a=${admin_a}" -v "guardian_a=${guardian_a}" \
     -v "educator_a=${educator_a}" -v "admin_b=${admin_b}" \
     <"$repo/supabase/seed/synthetic-staging.sql" >/dev/null
  echo "  ok   two synthetic households, with their learners, cases, messages and staff"
fi

echo "== uploading one storage object per CLEAN attachment =="
# Only clean attachments are reachable through case_attachment_clean_download, and D1 refuses to
# report anything until EVERY administrator can list an own-household object -- so the objects have
# to exist, and they have to exist for the rows that policy lets through. Paths are read from the
# database rather than hardcoded, so adding a clean row to the seed is enough to get its object.
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' >/tmp/bl-sentinel.pdf
uploaded=0
for path in $(db -tAc "select object_path from public.case_attachments where status='clean' order by object_path"); do
  # x-upsert so a re-run overwrites instead of failing with 409 Duplicate.
  code="$(curl -s -o /tmp/bl-upload -w '%{http_code}' -X POST "$api/storage/v1/object/case-attachments/${path}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" -H 'x-upsert: true' \
    -H 'Content-Type: application/pdf' --data-binary @/tmp/bl-sentinel.pdf)"
  [ "$code" = "200" ] || { echo "FAIL: uploading ${path} returned HTTP ${code}:" >&2; cat /tmp/bl-upload >&2; exit 1; }
  uploaded=$((uploaded + 1))
done
echo "  ok   ${uploaded} sentinel object(s) behind the clean attachments"

echo "== minting the four staging JWTs =="
# On hosted Supabase these cannot be minted locally and have to be copied out of the dashboard.
# Here the signing secret is this stack's own, so GoTrue issues them on request.
mint() {
  local tok
  tok="$(curl -s -X POST "$api/auth/v1/token?grant_type=password" \
    -H "apikey: ${ANON_KEY}" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"${seed_password}\"}" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
  [ -n "$tok" ] || { echo "FAIL: GoTrue issued no token for $1." >&2; exit 1; }
  printf '%s' "$tok"
}
jwt_admin_a="$(mint seed-admin-a@britelink.invalid)"
jwt_guardian_a="$(mint seed-guardian-a@britelink.invalid)"
jwt_educator_a="$(mint seed-educator-a@britelink.invalid)"
jwt_admin_b="$(mint seed-admin-b@britelink.invalid)"
echo "  ok   four tokens, signed by this stack's own JWT_SECRET"

envfile="$stack/.env.staging"
echo "== writing ${envfile} =="
# Named .env.staging so the repo's existing `.env*` ignore rule already covers it. These are live
# tokens for an anon-key-guarded API -- disposable, but still not something to commit.
{
  echo "BRITELINK_SUPABASE_URL=${api}"
  echo "BRITELINK_SUPABASE_ANON_KEY=${ANON_KEY}"
  echo "BRITELINK_TEST_ENVIRONMENT=staging"
  echo "BRITELINK_TEST_HOUSEHOLD_A_ID=5eed0000-0000-4000-8000-0000000000a1"
  echo "BRITELINK_TEST_HOUSEHOLD_B_ID=5eed0000-0000-4000-8000-0000000000b1"
  echo "BRITELINK_TEST_ADMIN_A_USER_ID=${admin_a}"
  echo "BRITELINK_TEST_GUARDIAN_A_USER_ID=${guardian_a}"
  echo "BRITELINK_TEST_EDUCATOR_A_USER_ID=${educator_a}"
  echo "BRITELINK_TEST_HOUSEHOLD_B_LEARNER_ID=5eed0000-0000-4000-8000-000000000b10"
  echo "BRITELINK_TEST_HOUSEHOLD_B_CASE_ID=5eed0000-0000-4000-8000-000000000b20"
  echo "BRITELINK_TEST_HOUSEHOLD_B_PLAN_ID=5eed0000-0000-4000-8000-000000000b30"
  echo "BRITELINK_TEST_HOUSEHOLD_B_LESSON_ID=5eed0000-0000-4000-8000-000000000b50"
  echo "BRITELINK_TEST_HOUSEHOLD_B_ACTIVITY_ID=5eed0000-0000-4000-8000-000000000b51"
  echo "BRITELINK_TEST_HOUSEHOLD_B_MESSAGE_ID=5eed0000-0000-4000-8000-000000000b70"
  echo "BRITELINK_TEST_HOUSEHOLD_B_DELIVERY_ID=5eed0000-0000-4000-8000-000000000ba0"
  echo "BRITELINK_TEST_HOUSEHOLD_B_REVISION_ID=5eed0000-0000-4000-8000-000000000bb0"
  echo "BRITELINK_TEST_HOUSEHOLD_B_ATTACHMENT_ID=5eed0000-0000-4000-8000-000000000b80"
  echo "BRITELINK_TEST_HOUSEHOLD_B_CONSENT_ID=5eed0000-0000-4000-8000-000000000b61"
  echo "BRITELINK_TEST_HOUSEHOLD_B_CAPTURE_ID=5eed0000-0000-4000-8000-000000000b91"
  echo "BRITELINK_TEST_HOUSEHOLD_B_SHARED_ACTIVITY_ID=5eed0000-0000-4000-8000-000000000b93"
  echo "BRITELINK_TEST_HOUSEHOLD_B_OBJECT_PATH=5eed0000-0000-4000-8000-0000000000b1/5eed0000-0000-4000-8000-000000000b20/5eed0000-0000-4000-8000-000000000b80.pdf"
  echo "BRITELINK_TEST_ATTACHMENT_BUCKET=case-attachments"
  echo "BRITELINK_TEST_ADMIN_A_JWT=${jwt_admin_a}"
  echo "BRITELINK_TEST_GUARDIAN_A_JWT=${jwt_guardian_a}"
  echo "BRITELINK_TEST_EDUCATOR_A_JWT=${jwt_educator_a}"
  echo "BRITELINK_TEST_ADMIN_B_JWT=${jwt_admin_b}"
} >"$envfile"
chmod 600 "$envfile"
echo "  ok   $(wc -l <"$envfile" | tr -d ' ') variables"

echo "== running the isolation verifier =="
# Exit codes are the verifier's own and they are load-bearing: 0 every check passed, 2 a check
# failed, 3 read isolation passed but the mutation matrix could not run for lack of configuration.
# 3 must never be reported as success -- "we could not check" is not "we checked and it was clean".
if ! command -v node >/dev/null 2>&1; then
  echo "  SKIP node is not installed on this host. Run the verifier where it is:" >&2
  echo "       set -a; . ${envfile}; set +a; node scripts/hosted-isolation-check.mjs" >&2
  exit 3
fi
set +e
( set -a; . "$envfile"; set +a; node "$repo/scripts/hosted-isolation-check.mjs" )
verifier_rc=$?
set -e
case "$verifier_rc" in
  0) echo "  ok   read isolation (D1) and the mutation matrix (D2) both passed" ;;
  2) echo "FAIL: the verifier reported a failed isolation check." >&2 ;;
  3) echo "FAIL: D1 passed but D2 could not run for lack of configuration." >&2 ;;
  *) echo "FAIL: the verifier exited ${verifier_rc}." >&2 ;;
esac

echo
if [ "$verifier_rc" = "0" ]; then
  echo "PASS: $applied migrations, the storage policies, the synthetic seed and the isolation"
  echo "      verifier all ran against a real self-hosted Supabase stack at $api (127.0.0.1 only)."
else
  echo "The stack is up and migrated at $api, but the isolation evidence did not pass."
fi
exit "$verifier_rc"
