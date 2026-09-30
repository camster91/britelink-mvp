#!/usr/bin/env bash
# Production diagnostics for the VPS (run by .github/workflows/ops-check.yml). Prints facts only:
# never a key or a secret. Usage: ops-check.sh [check|fix-anon-key]
#
#   check         the web build's anon key vs the production stack's (same key? does each verify
#                 under the secret PostgREST actually uses? do GoTrue and PostgREST share one? does
#                 the served bundle carry the .env key?), and whether Traefik writes an access log.
#   reconcile-stack
#                 recreates the production stack's auth/rest/storage containers from its own compose
#                 files and .env (docker compose up -d --no-deps; the db is untouched), so every
#                 service uses the .env JWT_SECRET that signed ANON_KEY. Refuses unless that key
#                 verifies under it and is role=anon. Signs out existing sessions.
#   restore-secret
#                 puts the secret that actually signed the stack's ANON_KEY and SERVICE_KEY (the one
#                 the storage container still runs with) back into the stack .env as JWT_SECRET,
#                 after a backup, then force-recreates auth/rest/storage so all three use it. Refuses
#                 unless both keys verify under that secret. No web rebuild: the web key is unchanged.
#   feed-route    adds a Traefik router for britelink.ashbi.ca/feed/ with access logging off (router
#                 observability, Traefik >= 3.1), so calendar feed tokens never reach the access log.
#                 Backs up the dynamic file first, proves the result with a real request (the feed
#                 path must be absent from the log, a control request present, the site still up),
#                 and restores the backup on any failure.
#   set-notice-version VALUE
#                 records the counsel-approved privacy notice version as VITE_PRIVACY_NOTICE_VERSION
#                 in the web .env (after a backup), which unlocks guardian intake on the next Deploy.
#                 Owner-confirmed approval only; VALUE is 1-80 of [A-Za-z0-9._-].
#   fix-anon-key  copies the production stack's own ANON_KEY into the web .env (after a backup),
#                 only if it verifies under PostgREST's secret and is role=anon. No rebuild: run
#                 Deploy afterwards.
#
# Overridable for tests: WEB_ENV, WEB_ORIGIN, REST_CONTAINER, AUTH_CONTAINER, STORAGE_CONTAINER,
# TRAEFIK_CONTAINER, TRAEFIK_CONFIGS.
set -euo pipefail
set +x
MODE="${1:-check}"
case "$MODE" in check|fix-anon-key|reconcile-stack|restore-secret|feed-route|set-notice-version) ;; *) echo "usage: $0 [check|fix-anon-key|reconcile-stack|restore-secret|feed-route|set-notice-version VALUE]" >&2; exit 2 ;; esac
WEB_ENV="${WEB_ENV:-/docker/britelink-web/.env}"
WEB_ORIGIN="${WEB_ORIGIN:-http://127.0.0.1:8088}"
REST_CONTAINER="${REST_CONTAINER:-britelink-production-rest-1}"
AUTH_CONTAINER="${AUTH_CONTAINER:-britelink-production-auth-1}"
STORAGE_CONTAINER="${STORAGE_CONTAINER:-britelink-production-storage-1}"
TRAEFIK_CONTAINER="${TRAEFIK_CONTAINER:-traefik}"
TRAEFIK_DYNAMIC="${TRAEFIK_DYNAMIC:-/opt/traefik/dynamic/britelink.yml}"
TRAEFIK_ACCESS_LOG="${TRAEFIK_ACCESS_LOG:-/var/log/traefik/access.log}"
SITE_HOST="${SITE_HOST:-britelink.ashbi.ca}"
BACKUP_DIR="${BACKUP_DIR:-/root/britelink-backups}"
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
env_file_val() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' \r" || true; }
label_of() { docker inspect "$1" --format "{{index .Config.Labels \"$2\"}}" 2>/dev/null || true; }
# Anonymous REST call through the public API origin with an all-zero (never valid) feed token:
# 401 means the key is rejected; 400/403/404 means it was accepted. The key goes in a 0600
# header file, never argv.
rest_probe() {
  local url hdr body code
  url="$(env_file_val "$WEB_ENV" VITE_SUPABASE_URL)"
  [ -n "$url" ] && [ -n "$1" ] || { echo "skipped"; return; }
  hdr="$(mktemp)"; body="$(mktemp)"; chmod 600 "$hdr" "$body"
  printf 'apikey: %s\nAuthorization: Bearer %s\n' "$1" "$1" >"$hdr"
  code="$(curl -s -o "$body" -w '%{http_code}' --max-time 10 -H @"$hdr" -H 'Accept: text/calendar' "$url/rest/v1/rpc/calendar_feed?token=$(printf '0%.0s' $(seq 64))" || true)"
  # The status alone is ambiguous: the RPC refuses an unknown token with 42501, which PostgREST
  # answers as 401 for an anonymous caller. Only a JWT error code (PGRST301/302) means the key
  # itself was rejected. The body is error JSON and holds no secret; only its code is printed.
  err="$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("code",""))
except Exception: print("")' "$body")"
  rm -f "$hdr" "$body"
  case "$err" in
    PGRST30*) echo "HTTP $code $err (key rejected)";;
    "") echo "HTTP ${code:-none} (no error code)";;
    *) echo "HTTP $code $err (key accepted; the RPC refused the dummy token as expected)";;
  esac
}
env_of() { docker inspect "$1" --format '{{json .Config.Env}}' 2>/dev/null | NAME="$2" python3 -c '
import json, os, sys
try: env = json.load(sys.stdin) or []
except Exception: sys.exit(0)
p = os.environ["NAME"] + "="
for e in env:
    if e.startswith(p): print(e[len(p):]); break' || true; }
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
echo "privacy notice version (web .env):  $(env_file_val "$WEB_ENV" VITE_PRIVACY_NOTICE_VERSION | grep . || echo "unset (guardian intake locked)")"

echo "== production stack secrets =="
stack_dir="$(label_of "$REST_CONTAINER" com.docker.compose.project.working_dir)"
stack_project="$(label_of "$REST_CONTAINER" com.docker.compose.project)"
stack_files="$(label_of "$REST_CONTAINER" com.docker.compose.project.config_files)"
stack_env="${STACK_ENV:-${stack_dir:+$stack_dir/.env}}"
env_secret="$(env_file_val "$stack_env" JWT_SECRET)"
env_anon="$(env_file_val "$stack_env" ANON_KEY)"
storage_secret="$(env_of "$STORAGE_CONTAINER" PGRST_JWT_SECRET)"
same() { yn test -n "$1" -a "$1" = "$2"; }
echo "compose project / dir:              ${stack_project:-unknown} / ${stack_dir:-unknown}"
echo "compose files:                      ${stack_files:-unknown}"
echo "stack .env has JWT_SECRET:          $(yn test -n "$env_secret")"
echo ".env JWT_SECRET == PostgREST's:     $(same "$env_secret" "$rest_secret")"
echo ".env JWT_SECRET == GoTrue's:        $(same "$env_secret" "$auth_secret")"
echo ".env JWT_SECRET == storage's:       $(same "$env_secret" "$storage_secret")"
echo ".env ANON_KEY == running stack's:   $(same "$env_anon" "$stack_key")"
echo ".env ANON_KEY == web .env key:      $(same "$env_anon" "$web_key")"
[ -n "$env_secret" ] && [ -n "$env_anon" ] && echo ".env ANON_KEY verifies under .env:  $(jwt_verifies "$env_anon" "$env_secret")"
[ -n "$auth_secret" ] && [ -n "$web_key" ] && echo "web key verifies under GoTrue:      $(jwt_verifies "$web_key" "$auth_secret")"
env_service="$(env_file_val "$stack_env" SERVICE_KEY)"
echo ".env JWT_SECRET / ANON_KEY lines:   $(grep -cE '^JWT_SECRET=' "$stack_env" 2>/dev/null || echo 0) / $(grep -cE '^ANON_KEY=' "$stack_env" 2>/dev/null || echo 0)"
echo ".env modified:                      $(date -u -r "$stack_env" +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo unknown)"
echo "PostgREST secret == storage's:      $(same "$rest_secret" "$storage_secret")"
# Which running secret signed the keys? (yes/no per secret; the secrets themselves are never printed)
for pair in "anon:$env_anon" "service:$env_service"; do
  name="${pair%%:*}"; key="${pair#*:}"
  [ -n "$key" ] || continue
  printf '.env %-7s key verifies under: GoTrue %s, PostgREST %s, storage %s\n' "$name" \
    "$(jwt_verifies "$key" "$auth_secret")" "$(jwt_verifies "$key" "$rest_secret")" "$(jwt_verifies "$key" "$storage_secret")"
done
if [ -n "$env_service" ]; then echo ".env SERVICE_KEY claims:            $(jwt_claims "$env_service")"; fi
for c in "$AUTH_CONTAINER" "$REST_CONTAINER" "$STORAGE_CONTAINER"; do
  echo "created $c: $(docker inspect "$c" --format '{{.Created}}' 2>/dev/null | cut -c1-19 || true)"
done
compose_args=()
if [ -n "$stack_project" ] && [ -n "$stack_dir" ] && [ -n "$stack_files" ]; then
  compose_args=(-p "$stack_project" --project-directory "$stack_dir")
  IFS=, read -r -a compose_files <<<"$stack_files"
  for f in "${compose_files[@]}"; do compose_args+=(-f "$f"); done
  hashes="$(docker compose "${compose_args[@]}" config --hash='*' 2>/dev/null || true)"
  # What the compose files + .env would give each service now, compared without printing anything.
  docker compose "${compose_args[@]}" config --format json 2>/dev/null | ENV_SECRET="$env_secret" REST_S="$rest_secret" AUTH_S="$auth_secret" python3 -c '
import json, os, sys
try: svcs = json.load(sys.stdin)["services"]
except Exception: print("compose-rendered secrets:           unreadable"); sys.exit(0)
yn = lambda b: "yes" if b else "no"
r = (svcs.get("rest", {}).get("environment") or {}).get("PGRST_JWT_SECRET", "")
a = (svcs.get("auth", {}).get("environment") or {}).get("GOTRUE_JWT_SECRET", "")
e = os.environ["ENV_SECRET"]
print("compose renders rest == auth secret:", yn(r and r == a))
print("compose rest secret == running rest:", yn(r and r == os.environ["REST_S"]), "| == .env:", yn(r and r == e))
print("compose auth secret == running auth:", yn(a and a == os.environ["AUTH_S"]), "| == .env:", yn(a and a == e))' || true
  for svc in auth rest storage; do
    want="$(printf '%s\n' "$hashes" | awk -v s="$svc" '$1 == s {print $2}')"
    have="$(label_of "${stack_project}-${svc}-1" com.docker.compose.config-hash)"
    if [ -z "$want" ]; then state="unknown"; elif [ "$want" = "$have" ]; then state="matches compose files + .env"; else state="STALE (differs from compose files + .env)"; fi
    printf 'container %-8s                   %s\n' "$svc:" "$state"
  done
fi
echo "anon REST probe (public API):       $(rest_probe "$web_key")"

echo "== web feed proxy =="
WEB_CONTAINER="${WEB_CONTAINER:-britelink-web-web-1}"
api_origin="$(env_file_val "$WEB_ENV" VITE_SUPABASE_URL)"
api_host="${api_origin#*://}"; api_host="${api_host%%/*}"
echo "web container networks:             $(docker inspect "$WEB_CONTAINER" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null || echo unknown)"
if [ -n "$api_host" ]; then
  echo "API resolves inside web container:  $(docker exec "$WEB_CONTAINER" nslookup "$api_host" 127.0.0.11 2>&1 | awk '/^Address/ && !/127.0.0.11/ {print $NF}' | tr '\n' ' ' || true)"
  echo "API reachable from web container:   $(docker exec "$WEB_CONTAINER" wget -q -T 8 -O /dev/null -S "$api_origin/rest/v1/" 2>&1 | awk '/HTTP\// {print $2}' | tail -1 || true) (any HTTP status means reachable; empty means no connection)"
fi
# Recent nginx errors for the feed route. A 64-hex feed token in a logged path is blanked.
echo "recent feed proxy errors (tokens redacted):"
docker logs --since 24h "$WEB_CONTAINER" 2>&1 | grep -iE 'calendar_feed|feed_api|upstream|resolver|ssl' | sed -E 's/[0-9a-f]{64}/<token>/g' | tail -8 | sed 's/^/  /' || true

echo "== traefik access log =="
args="$(docker inspect "$TRAEFIK_CONTAINER" --format '{{join .Args " "}}' 2>/dev/null || true)"
if printf '%s' "$args" | grep -qi accesslog; then
  echo "container args: $(printf '%s' "$args" | tr ' ' '\n' | grep -i accesslog | tr '\n' ' ')"
else
  echo "container args: no accesslog flag"
fi
echo "traefik image: $(docker inspect "$TRAEFIK_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || echo unknown)"
traefik_version="$(docker exec "$TRAEFIK_CONTAINER" traefik version 2>/dev/null | awk '/^Version:/ {print $2}' || true)"
echo "traefik version: ${traefik_version:-unknown}"
if [ -f "$TRAEFIK_DYNAMIC" ] && grep -q 'britelink-feed:' "$TRAEFIK_DYNAMIC"; then echo "feed route (no access log):         present"; else echo "feed route (no access log):         absent"; fi
if [ -f "$TRAEFIK_DYNAMIC" ]; then
  echo "dynamic route $TRAEFIK_DYNAMIC:"
  grep -vE '^[[:space:]]*(#|$)' "$TRAEFIK_DYNAMIC" | grep -viE 'password|secret|token|users|key' | sed 's/^/  /' || true
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

if [ "$MODE" = "reconcile-stack" ]; then
  echo "== reconcile-stack =="
  refuse() { echo "FAIL: $*; nothing changed" >&2; exit 1; }
  [ "${#compose_args[@]}" -gt 0 ] || refuse "could not read the stack's compose project from $REST_CONTAINER labels"
  [ -n "$env_secret" ] && [ -n "$env_anon" ] || refuse "the stack .env has no JWT_SECRET or ANON_KEY"
  [ "$(jwt_verifies "$env_anon" "$env_secret")" = yes ] || refuse "the .env ANON_KEY does not verify under the .env JWT_SECRET"
  jwt_claims "$env_anon" | grep -q '"role": "anon"' || refuse "the .env ANON_KEY is not role=anon"
  docker compose "${compose_args[@]}" up -d --no-deps auth rest storage
  now_rest=""; now_auth=""
  for _ in $(seq 30); do
    now_rest="$(env_of "$REST_CONTAINER" PGRST_JWT_SECRET)"; now_auth="$(env_of "$AUTH_CONTAINER" GOTRUE_JWT_SECRET)"
    [ "$now_rest" = "$env_secret" ] && [ "$now_auth" = "$env_secret" ] && break
    sleep 2
  done
  echo "PostgREST now uses .env secret:     $(same "$env_secret" "$now_rest")"
  echo "GoTrue now uses .env secret:        $(same "$env_secret" "$now_auth")"
  echo "web key verifies under PostgREST:   $(jwt_verifies "$web_key" "$now_rest")"
  sleep 5
  echo "anon REST probe (public API):       $(rest_probe "$web_key")"
  [ "$now_rest" = "$env_secret" ] && [ "$now_auth" = "$env_secret" ] || { echo "FAIL: services did not converge on the .env secret" >&2; exit 1; }
fi

if [ "$MODE" = "restore-secret" ]; then
  echo "== restore-secret =="
  refuse() { echo "FAIL: $*; nothing changed" >&2; exit 1; }
  [ "${#compose_args[@]}" -gt 0 ] || refuse "could not read the stack's compose project from $REST_CONTAINER labels"
  [ -f "$stack_env" ] || refuse "no stack .env at $stack_env"
  [ -n "$storage_secret" ] && [ -n "$env_anon" ] && [ -n "$env_service" ] || refuse "storage secret or .env keys unavailable"
  [ "$(jwt_verifies "$env_anon" "$storage_secret")" = yes ] || refuse "the .env ANON_KEY does not verify under storage's secret"
  [ "$(jwt_verifies "$env_service" "$storage_secret")" = yes ] || refuse "the .env SERVICE_KEY does not verify under storage's secret"
  jwt_claims "$env_anon" | grep -q '"role": "anon"' || refuse "the .env ANON_KEY is not role=anon"
  [ "$(grep -cE '^JWT_SECRET=' "$stack_env")" = 1 ] || refuse "the stack .env does not have exactly one JWT_SECRET line"
  backup="$stack_env.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$stack_env" "$backup"; chmod 600 "$backup"
  tmp="$(mktemp)"
  NEW_SECRET="$storage_secret" awk '/^JWT_SECRET=/ { print "JWT_SECRET=" ENVIRON["NEW_SECRET"]; next } { print }' "$backup" > "$tmp"
  cat "$tmp" > "$stack_env"; rm -f "$tmp"
  if [ "$(env_file_val "$stack_env" JWT_SECRET)" != "$storage_secret" ] || [ "$(grep -cvE '^JWT_SECRET=' "$stack_env")" != "$(grep -cvE '^JWT_SECRET=' "$backup")" ]; then
    cp -p "$backup" "$stack_env"; echo "FAIL: the .env write did not verify; restored the backup; nothing recreated" >&2; exit 1
  fi
  echo "updated $stack_env JWT_SECRET (backup: $backup); every other line unchanged"
  docker compose "${compose_args[@]}" up -d --no-deps --force-recreate auth rest storage
  now_rest=""; now_auth=""; now_storage=""
  for _ in $(seq 30); do
    now_rest="$(env_of "$REST_CONTAINER" PGRST_JWT_SECRET)"; now_auth="$(env_of "$AUTH_CONTAINER" GOTRUE_JWT_SECRET)"; now_storage="$(env_of "$STORAGE_CONTAINER" PGRST_JWT_SECRET)"
    [ "$now_rest" = "$storage_secret" ] && [ "$now_auth" = "$storage_secret" ] && [ "$now_storage" = "$storage_secret" ] && break
    sleep 2
  done
  echo "PostgREST uses the key-signing secret: $(same "$storage_secret" "$now_rest")"
  echo "GoTrue uses the key-signing secret:    $(same "$storage_secret" "$now_auth")"
  echo "storage uses the key-signing secret:   $(same "$storage_secret" "$now_storage")"
  echo "web key verifies under PostgREST:      $(jwt_verifies "$web_key" "$now_rest")"
  sleep 5
  echo "anon REST probe (public API):          $(rest_probe "$web_key")"
  [ "$now_rest" = "$storage_secret" ] && [ "$now_auth" = "$storage_secret" ] && [ "$now_storage" = "$storage_secret" ] || { echo "FAIL: services did not converge; the .env backup is $backup" >&2; exit 1; }
fi

if [ "$MODE" = "feed-route" ]; then
  echo "== feed-route =="
  refuse() { echo "FAIL: $*; nothing changed" >&2; exit 1; }
  [ -f "$TRAEFIK_DYNAMIC" ] || refuse "no dynamic route file at $TRAEFIK_DYNAMIC"
  if grep -q 'britelink-feed:' "$TRAEFIK_DYNAMIC"; then echo "already present; nothing changed"; exit 0; fi
  grep -qF "Host(\`$SITE_HOST\`)" "$TRAEFIK_DYNAMIC" || refuse "the route file has no Host(\`$SITE_HOST\`) router"
  [ "$(grep -cE '^[[:space:]]*routers:[[:space:]]*$' "$TRAEFIK_DYNAMIC")" = 1 ] || refuse "the route file does not have exactly one 'routers:' line"
  major="${traefik_version%%.*}"; rest="${traefik_version#*.}"; minor="${rest%%.*}"
  case "$major.$minor" in *[!0-9.]*|.|"") refuse "could not read the Traefik version";; esac
  { [ "$major" -gt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -ge 1 ]; }; } || refuse "Traefik $traefik_version has no per-router access-log switch (needs 3.1+)"
  docker exec "$TRAEFIK_CONTAINER" test -f "$TRAEFIK_ACCESS_LOG" || refuse "cannot read $TRAEFIK_ACCESS_LOG inside $TRAEFIK_CONTAINER, so the result could not be proven"

  mkdir -p "$BACKUP_DIR"
  backup="$BACKUP_DIR/traefik-britelink.yml.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$TRAEFIK_DYNAMIC" "$backup"
  # Temp file in the same directory (atomic rename) but without a .yml/.yaml/.toml extension, so the
  # file provider never loads a half-written copy.
  tmp="$(dirname "$TRAEFIK_DYNAMIC")/.britelink-feed.tmp"
  # The router block follows the file's own indentation: two spaces deeper than "routers:".
  SITE_HOST="$SITE_HOST" awk '
    { print }
    /^[[:space:]]*routers:[[:space:]]*$/ && !done {
      match($0, /^[[:space:]]*/); base = substr($0, 1, RLENGTH); a = base "  "; b = a "  "; c = b "  "
      print a "# Calendar feed URLs carry a private token in the path: keep them out of the access log."
      print a "britelink-feed:"
      print b "rule: \"Host(`" ENVIRON["SITE_HOST"] "`) && PathPrefix(`/feed/`)\""
      print b "priority: 1000"
      print b "entryPoints:"
      print c "- websecure"
      print b "service: britelink-web"
      print b "tls:"
      print c "certResolver: letsencrypt"
      print b "observability:"
      print c "accessLogs: false"
      done = 1
    }' "$backup" > "$tmp"
  chmod --reference="$backup" "$tmp" 2>/dev/null || true
  mv "$tmp" "$TRAEFIK_DYNAMIC"
  echo "added the britelink-feed router (backup: $backup)"

  restore() { cp -p "$backup" "$TRAEFIK_DYNAMIC"; echo "FAIL: $*; restored the previous route file" >&2; exit 1; }
  sleep 5
  nonce="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  control="$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
  site_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$SITE_HOST/?opscheck=$control" || true)"
  feed_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$SITE_HOST/feed/$nonce.ics" || true)"
  sleep 3
  in_log() { docker exec "$TRAEFIK_CONTAINER" grep -c "$1" "$TRAEFIK_ACCESS_LOG" 2>/dev/null || true; }
  control_hits="$(in_log "opscheck=$control")"; feed_hits="$(in_log "$nonce")"
  echo "site responds:                      HTTP $site_code"
  echo "feed path served through Traefik:   HTTP $feed_code"
  echo "control request in access log:      ${control_hits:-0}"
  echo "feed request in access log:         ${feed_hits:-0}"
  [ "$site_code" = 200 ] || restore "the site answered HTTP $site_code after the change"
  case "$feed_code" in 000|502|503|504) restore "the feed path answered HTTP $feed_code through the new router";; esac
  [ "${control_hits:-0}" -ge 1 ] || restore "the control request never reached the access log, so the test proves nothing"
  [ "${feed_hits:-0}" = 0 ] || restore "the feed request was still logged"
  echo "OK: feed paths are routed and no longer logged."
fi

if [ "$MODE" = "set-notice-version" ]; then
  echo "== set-notice-version =="
  value="${2:-}"
  printf '%s' "$value" | grep -qE '^[A-Za-z0-9._-]{1,80}$' || { echo "FAIL: the notice version must be 1-80 of [A-Za-z0-9._-]; nothing changed" >&2; exit 1; }
  [ -f "$WEB_ENV" ] || { echo "FAIL: no $WEB_ENV; nothing changed" >&2; exit 1; }
  current="$(env_file_val "$WEB_ENV" VITE_PRIVACY_NOTICE_VERSION)"
  if [ "$current" = "$value" ]; then echo "already $value; nothing changed"; exit 0; fi
  backup="$WEB_ENV.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$WEB_ENV" "$backup"
  tmp="$(mktemp)"
  VALUE="$value" awk '/^VITE_PRIVACY_NOTICE_VERSION=/ { if (!done) print "VITE_PRIVACY_NOTICE_VERSION=" ENVIRON["VALUE"]; done = 1; next } { print } END { if (!done) print "VITE_PRIVACY_NOTICE_VERSION=" ENVIRON["VALUE"] }' "$backup" > "$tmp"
  cat "$tmp" > "$WEB_ENV"; rm -f "$tmp"
  if [ "$(env_file_val "$WEB_ENV" VITE_PRIVACY_NOTICE_VERSION)" = "$value" ] \
     && [ "$(grep -cv '^VITE_PRIVACY_NOTICE_VERSION=' "$WEB_ENV")" = "$(grep -cv '^VITE_PRIVACY_NOTICE_VERSION=' "$backup")" ]; then
    echo "set VITE_PRIVACY_NOTICE_VERSION=$value (was: ${current:-unset}; backup: $backup); every other line unchanged. Run Deploy to rebuild."
  else
    cp -p "$backup" "$WEB_ENV"; echo "FAIL: the write did not verify; restored the backup" >&2; exit 1
  fi
fi
