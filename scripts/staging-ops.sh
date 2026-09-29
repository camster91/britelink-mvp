#!/usr/bin/env bash
# VPS staging operations (run by .github/workflows/staging.yml from an archive of the dispatched
# commit). Staging holds synthetic data only; nothing here touches the production stack, and every
# mode refuses to run if the target looks like production.
#
#   rebuild   wipes the staging stack's volumes and rebuilds it with scripts/selfhosted-staging/up.sh
#             from this commit: all migrations, the private bucket, the synthetic seed, the four
#             staging identities and .env.staging. Needed because staging predates migration 038, so
#             it cannot be brought forward in place (apply-pending-migrations.sh starts at 039).
#   verify    builds a staging copy of the web image (the production Dockerfile, pointed at the
#             staging API), serves it on 127.0.0.1:${APP_PORT}, then runs the hosted isolation
#             verifier (D1 read + D2 mutation matrix, #3/#37) and the parent + educator journeys
#             (#39) in a Playwright container. Prints both results; exits non-zero if either fails.
#
# Secrets (the staging service key, minted JWTs) stay on the VPS: they move through 0600 env files
# inside a temp directory that is removed on exit, and are never printed.
set -euo pipefail
MODE="${1:?usage: staging-ops.sh rebuild|verify}"
case "$MODE" in rebuild|verify) ;; *) echo "usage: staging-ops.sh rebuild|verify" >&2; exit 2 ;; esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
DB_CONTAINER="${STAGING_DB_CONTAINER:-britelink-staging-db-1}"
APP_PORT="${APP_PORT:-8097}"
APP_URL="http://127.0.0.1:${APP_PORT}"
WEB_CONTAINER="britelink-web-staging"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v$(node -p 'require(process.argv[1]).packages["node_modules/playwright"].version' "$repo/package-lock.json" 2>/dev/null || python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["packages"]["node_modules/playwright"]["version"])' "$repo/package-lock.json")-noble"
PRODUCTION_HOSTS="britelink.ashbi.ca britelink-api.ashbi.ca"

fail() { echo "FAIL: $*" >&2; exit 1; }
label() { docker inspect "$DB_CONTAINER" --format "{{index .Config.Labels \"$1\"}}" 2>/dev/null || true; }
env_val() { grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'\r" || true; }

# --- locate the staging stack from its own compose labels, and refuse anything production-like ---
project="$(label com.docker.compose.project)"
stack_dir="$(label com.docker.compose.project.working_dir)"
[ -n "$project" ] && [ -n "$stack_dir" ] || fail "no running $DB_CONTAINER; is the staging stack up? (docker ps | grep staging)"
case "$project" in *staging*) ;; *) fail "compose project '$project' is not a staging project; refusing" ;; esac
case "$stack_dir" in *production*) fail "stack dir $stack_dir looks like production; refusing" ;; esac
stack_env="$stack_dir/.env"
[ -f "$stack_env" ] || fail "no $stack_env"
public_url="$(env_val "$stack_env" PUBLIC_URL)"
for host in $PRODUCTION_HOSTS; do case "$public_url" in *"$host"*) fail "staging PUBLIC_URL points at production ($host); refusing" ;; esac; done
echo "staging project: $project   dir: $stack_dir   api: $public_url   app: $APP_URL"

work="$(mktemp -d /root/bl-staging.XXXXXX)"; chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

# GoTrue must be allowed to redirect magic links to the staging app, and its links must carry the
# gateway's /auth/v1 prefix to be reachable. Staging-only; production has its own override file.
override="$stack_dir/docker-compose.staging-app.yml"
write_override() {
  cat > "$override" <<EOF
# Written by scripts/staging-ops.sh: lets staging magic links land in the staging app ($APP_URL).
services:
  auth:
    environment:
      API_EXTERNAL_URL: \${PUBLIC_URL}/auth/v1
      GOTRUE_SITE_URL: $APP_URL
      GOTRUE_URI_ALLOW_LIST: $APP_URL,$APP_URL/**
EOF
}

if [ "$MODE" = "rebuild" ]; then
  echo "== rebuild: current staging state =="
  docker exec "$DB_CONTAINER" psql -X -tA -U postgres -d postgres -c "select 'households='||count(*) from public.households" 2>/dev/null || true
  # Synthetic data only, by design (docs/STAGING_HANDOFF.md). Refuse if anything that is not the
  # synthetic seed is present, so a staging stack that someone repurposed is never wiped.
  foreign="$(docker exec "$DB_CONTAINER" psql -X -tA -U postgres -d postgres -c "select count(*) from auth.users where email not like '%@britelink.invalid'" 2>/dev/null || echo 0)"
  [ "${foreign:-0}" = 0 ] || fail "staging has ${foreign} non-synthetic auth user(s); refusing to wipe it"

  # Bring the stack's compose definition up to this commit (backing up what was there).
  backup="$stack_dir/.pre-rebuild-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup"
  for f in docker-compose.yml gateway.conf; do [ -f "$stack_dir/$f" ] && cp -p "$stack_dir/$f" "$backup/"; done
  [ -d "$stack_dir/init" ] && cp -rp "$stack_dir/init" "$backup/"
  cp "$repo/supabase/selfhosted/docker-compose.yml" "$repo/supabase/selfhosted/gateway.conf" "$stack_dir/"
  [ -d "$repo/supabase/selfhosted/init" ] && cp -r "$repo/supabase/selfhosted/init" "$stack_dir/"
  write_override
  echo "  ok   compose files updated from this commit (previous copies in $backup)"

  echo "== tearing down staging (volumes included) =="
  docker compose -p "$project" --project-directory "$stack_dir" -f "$stack_dir/docker-compose.yml" -f "$override" down -v --remove-orphans
  rm -f "$stack_dir/.env.staging"

  echo "== rebuilding with up.sh from this commit =="
  set +e
  bash "$repo/scripts/selfhosted-staging/up.sh" --stack-dir "$stack_dir" --project "$project" --override "$override"
  rc=$?
  set -e
  # 3 = the stack is up but the host has no node to run the verifier; verify mode runs it in a container.
  case "$rc" in 0|3) echo "  ok   staging rebuilt (up.sh exit $rc)";; *) fail "up.sh exited $rc";; esac
  [ -f "$stack_dir/.env.staging" ] || fail "up.sh did not write $stack_dir/.env.staging"
  echo "Rebuilt. Run the verify mode next."
  exit 0
fi

# --- verify ---
staging_env="$stack_dir/.env.staging"
[ -f "$staging_env" ] || fail "no $staging_env; run the rebuild mode first"
anon="$(env_val "$stack_env" ANON_KEY)"; service="$(env_val "$stack_env" SERVICE_KEY)"
[ -n "$anon" ] && [ -n "$service" ] || fail "staging .env lacks ANON_KEY or SERVICE_KEY"

echo "== building the staging web image from this commit =="
docker build -q -t britelink-web:staging \
  --build-arg "VITE_SUPABASE_URL=$public_url" --build-arg "VITE_SUPABASE_ANON_KEY=$anon" \
  --build-arg "BRITELINK_BUILD_COMMIT=${SHA:-}" "$repo" >/dev/null
echo "  ok   britelink-web:staging"

echo "== serving it on $APP_URL =="
# Host networking so the /feed/ proxy reaches the staging API on 127.0.0.1; the listen address is
# moved off :80 (Traefik's) to 127.0.0.1:$APP_PORT. The template is otherwise the production one.
sed "s/listen 80;/listen 127.0.0.1:${APP_PORT};/" "$repo/nginx.conf.template" > "$work/default.conf.template"
docker rm -f "$WEB_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$WEB_CONTAINER" --network host \
  -v "$work/default.conf.template:/etc/nginx/templates/default.conf.template:ro" \
  britelink-web:staging >/dev/null
for _ in $(seq 30); do curl -fsS -o /dev/null "$APP_URL/" && break; sleep 1; done
curl -fsS -o /dev/null "$APP_URL/" || { docker logs "$WEB_CONTAINER" 2>&1 | tail -20; fail "the staging app did not start"; }
echo "  ok   staging app answers"

echo "== magic-link shape (origin and path only) =="
link="$(curl -s -X POST "$public_url/auth/v1/admin/generate_link" -H "apikey: $service" -H "Authorization: Bearer $service" \
  -H 'Content-Type: application/json' -d "{\"type\":\"magiclink\",\"email\":\"seed-guardian-a@britelink.invalid\",\"redirect_to\":\"$APP_URL\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("action_link",""))' 2>/dev/null || true)"
echo "  link: ${link%%\?*}"
if [ -n "$link" ]; then
  echo "  follows to: $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$link" | sed 's/#.*//; s/?.*//')"
fi

echo "== running the isolation verifier and the journeys (Playwright ${PLAYWRIGHT_IMAGE##*:}) =="
{
  cat "$staging_env"
  echo "BRITELINK_STAGING_APP_URL=$APP_URL"
  echo "BRITELINK_STAGING_SERVICE_ROLE_KEY=$service"
} > "$work/journey.env"
chmod 600 "$work/journey.env"
cp -r "$repo" "$work/app"
set +e
docker run --rm --network host --ipc=host --env-file "$work/journey.env" -v "$work/app:/app" -w /app "$PLAYWRIGHT_IMAGE" \
  bash -c 'npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1 || { echo "npm ci failed"; exit 9; }
           echo "--- hosted isolation verifier (D1 + D2) ---"; node scripts/hosted-isolation-check.mjs; iso=$?
           echo "--- staging journeys ---"; node scripts/staging-journey.mjs; journey=$?
           echo "isolation exit $iso, journeys exit $journey"; [ $iso -eq 0 ] && [ $journey -eq 0 ]'
rc=$?
set -e
[ -f "$work/app/qa/staging/journey-report.json" ] && { echo "--- journey report ---"; cat "$work/app/qa/staging/journey-report.json"; }
docker rm -f "$WEB_CONTAINER" >/dev/null 2>&1 || true
[ "$rc" = 0 ] || fail "staging verification failed (exit $rc)"
echo "PASS: isolation verifier and staging journeys both passed."
