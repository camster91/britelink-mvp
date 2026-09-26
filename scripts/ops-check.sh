#!/usr/bin/env bash
# Production diagnostics for the VPS (run by .github/workflows/ops-check.yml). Prints facts only:
# never a key or a secret. Usage: ops-check.sh [check|fix-anon-key]
#
#   check         the web build's anon key vs the production stack's (same key? does each verify
#                 under the secret PostgREST actually uses? do GoTrue and PostgREST share one? does
#                 the served bundle carry the .env key?), and whether Traefik writes an access log.
#   fix-anon-key  copies the production stack's own ANON_KEY into the web .env (after a backup),
#                 only if it verifies under PostgREST's secret and is role=anon. No rebuild: run
#                 Deploy afterwards.
#
# Overridable for tests: WEB_ENV, WEB_ORIGIN, REST_CONTAINER, AUTH_CONTAINER, STORAGE_CONTAINER,
# TRAEFIK_CONTAINER, TRAEFIK_CONFIGS.
set -euo pipefail
set +x
MODE="${1:-check}"
case "$MODE" in check|fix-anon-key) ;; *) echo "usage: $0 [check|fix-anon-key]" >&2; exit 2 ;; esac
WEB_ENV="${WEB_ENV:-/docker/britelink-web/.env}"
WEB_ORIGIN="${WEB_ORIGIN:-http://127.0.0.1:8088}"
REST_CONTAINER="${REST_CONTAINER:-britelink-production-rest-1}"
AUTH_CONTAINER="${AUTH_CONTAINER:-britelink-production-auth-1}"
STORAGE_CONTAINER="${STORAGE_CONTAINER:-britelink-production-storage-1}"
TRAEFIK_CONTAINER="${TRAEFIK_CONTAINER:-traefik}"
TRAEFIK_CONFIGS="${TRAEFIK_CONFIGS:-/etc/traefik/traefik.yml /etc/traefik/traefik.yaml /etc/traefik/traefik.toml /opt/traefik/traefik.yml /opt/traefik/traefik.yaml /opt/traefik/traefik.toml}"

# Secrets travel through the environment, never argv, so they do not appear in the process list.
jwt_claims() { JWT="$1" python3 -c '
import os, json, base64
p = os.environ["JWT"].split(".")[1]; p += "=" * (-len(p) % 4)
c = json.loads(base64.urlsafe_b64decode(p))
print(json.dumps({k: c[k] for k in ("role", "iss", "iat", "exp") if k in c}, sort_keys=True))'; }
jwt_verifies() { JWT="$1" SECRET="$2" python3 -c '
import os, hmac, hashlib, base64
h, p, s = os.environ["JWT"].split(".")
mac = hmac.new(os.environ["SECRET"].encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
print("yes" if hmac.compare_digest(base64.urlsafe_b64encode(mac).rstrip(b"=").decode(), s) else "no")'; }
env_of() { docker exec "$1" printenv "$2" 2>/dev/null || true; }
yn() { if "$@"; then echo yes; else echo no; fi; }

web_key="$(grep -E '^VITE_SUPABASE_ANON_KEY=' "$WEB_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' \r" || true)"
rest_secret="$(env_of "$REST_CONTAINER" PGRST_JWT_SECRET)"
auth_secret="$(env_of "$AUTH_CONTAINER" GOTRUE_JWT_SECRET)"
stack_key="$(env_of "$STORAGE_CONTAINER" ANON_KEY)"

echo "== anon key =="
echo "web .env has a key:                 $(yn test -n "$web_key")"
echo "production stack exposes a key:     $(yn test -n "$stack_key")"
echo "PostgREST secret readable:          $(yn test -n "$rest_secret")"
[ -n "$web_key" ] && echo "web key claims:                     $(jwt_claims "$web_key")"
[ -n "$stack_key" ] && echo "stack key claims:                   $(jwt_claims "$stack_key")"
echo "web key == stack key:               $(yn test -n "$web_key" -a "$web_key" = "$stack_key")"
[ -n "$rest_secret" ] && [ -n "$web_key" ] && echo "web key verifies under PostgREST:   $(jwt_verifies "$web_key" "$rest_secret")"
[ -n "$rest_secret" ] && [ -n "$stack_key" ] && echo "stack key verifies under PostgREST: $(jwt_verifies "$stack_key" "$rest_secret")"
echo "GoTrue and PostgREST share secret:  $(yn test -n "$rest_secret" -a "$rest_secret" = "$auth_secret")"
bundle_has=no
for js in $(curl -s --max-time 10 "$WEB_ORIGIN/" | grep -o 'assets/[^"]*\.js' || true); do
  if [ -n "$web_key" ] && curl -s --max-time 10 "$WEB_ORIGIN/$js" | grep -qF "$web_key"; then bundle_has=yes; fi
done
echo "served bundle carries the .env key: $bundle_has"

echo "== traefik access log =="
args="$(docker inspect "$TRAEFIK_CONTAINER" --format '{{join .Args " "}}' 2>/dev/null || true)"
if printf '%s' "$args" | grep -qi accesslog; then
  echo "container args: $(printf '%s' "$args" | tr ' ' '\n' | grep -i accesslog | tr '\n' ' ')"
else
  echo "container args: no accesslog flag"
fi
for f in $TRAEFIK_CONFIGS; do
  [ -f "$f" ] || continue
  echo "static config $f:"
  grep -niE 'accesslog|access_log|filepath|defaultmode|fields' "$f" | sed 's/^/  /' || echo "  (no accessLog section)"
done

if [ "$MODE" = "fix-anon-key" ]; then
  echo "== fix-anon-key =="
  if [ -z "$stack_key" ] || [ -z "$rest_secret" ]; then echo "FAIL: stack key or PostgREST secret unavailable; nothing changed" >&2; exit 1; fi
  if [ "$(jwt_verifies "$stack_key" "$rest_secret")" != yes ]; then echo "FAIL: the stack's ANON_KEY does not verify under PostgREST's secret; nothing changed" >&2; exit 1; fi
  if ! jwt_claims "$stack_key" | grep -q '"role": "anon"'; then echo "FAIL: the stack key is not role=anon; nothing changed" >&2; exit 1; fi
  if [ "$web_key" = "$stack_key" ]; then echo "already correct; nothing changed"; exit 0; fi
  backup="$WEB_ENV.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$WEB_ENV" "$backup"
  tmp="$(mktemp)"
  STACK_KEY="$stack_key" awk '/^VITE_SUPABASE_ANON_KEY=/ { if (!done) print "VITE_SUPABASE_ANON_KEY=" ENVIRON["STACK_KEY"]; done = 1; next } { print } END { if (!done) print "VITE_SUPABASE_ANON_KEY=" ENVIRON["STACK_KEY"] }' "$backup" > "$tmp"
  cat "$tmp" > "$WEB_ENV"; rm -f "$tmp"
  now="$(grep -E '^VITE_SUPABASE_ANON_KEY=' "$WEB_ENV" | head -1 | cut -d= -f2-)"
  if [ "$now" = "$stack_key" ]; then
    echo "updated $WEB_ENV (backup: $backup); every other line unchanged. Run Deploy to rebuild the bundle with it."
  else
    cp -p "$backup" "$WEB_ENV"; echo "FAIL: the write did not verify; restored the backup" >&2; exit 1
  fi
fi
