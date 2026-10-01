#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ ${GITHUB_ACTIONS:-} == true && ${RELEASE_SHA:-} =~ ^[a-f0-9]{40}$ ]]
[[ ${GITHUB_RUN_ID:-} =~ ^[0-9]+$ && ${GITHUB_RUN_ATTEMPT:-} =~ ^[0-9]+$ ]]
[[ ${BRITELINK_CHECKED_BUILD_MODE:-} == qa-configured ]]
[[ ! -e supabase/selfhosted/.env && ! -e supabase/selfhosted/.env.staging ]] || { echo 'Refusing existing stack configuration' >&2; exit 1; }
project="britelink-checked-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
export BRITELINK_CONFIGURED_CHECKED_IMAGE="britelink-configured-checked-runtime:$RELEASE_SHA"
work=$(mktemp -d)
compose=(docker compose -p "$project" -f supabase/selfhosted/docker-compose.yml -f .github/scripts/configured-ci-compose.yml)
cleanup() {
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f supabase/selfhosted/.env supabase/selfhosted/.env.staging
  rm -rf "$work"
}
trap cleanup EXIT
node .github/scripts/configured-qa-env.mjs
if ! timeout --signal=TERM 600 bash scripts/selfhosted-staging/up.sh --project "$project" --override .github/scripts/configured-ci-compose.yml >"$work/bootstrap.log" 2>&1; then
  echo 'Disposable real Supabase bootstrap/isolation failed' >&2
  python3 .github/scripts/sanitize-fixture-log.py "$work/bootstrap.log" >&2
  "${compose[@]}" logs --no-color --tail 40 auth storage db >"$work/services.log" 2>&1 || true
  python3 .github/scripts/sanitize-fixture-log.py "$work/services.log" >&2
  exit 1
fi
set -a
source supabase/selfhosted/.env
source supabase/selfhosted/.env.staging
set +a
export BRITELINK_STAGING_APP_URL=http://127.0.0.1:8099
export BRITELINK_STAGING_SERVICE_ROLE_KEY="$SERVICE_KEY"
node --input-type=module -e 'const r=await fetch(process.env.BRITELINK_STAGING_APP_URL+"/version.json");const b=await r.json();if(!r.ok||b.commit!==process.env.RELEASE_SHA)process.exit(1)'
if ! node scripts/staging-journey.mjs >"$work/journey.log" 2>&1; then
  echo 'Imported configured image authenticated journey failed' >&2
  python3 .github/scripts/sanitize-fixture-log.py "$work/journey.log" >&2
  exit 1
fi
node --input-type=module <<'JS'
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const report=JSON.parse(await readFile('qa/staging/journey-report.json','utf8'));
if(report.passed!==true||!Array.isArray(report.steps)||!report.steps.length||report.steps.some(step=>step.ok!==true))throw new Error('Every configured browser step must pass');
if(report.transport?.guardedNodeFetch!==true||report.transport?.guardedBrowserRequests!==true||report.transport?.browserWebSocketsBlocked!==true||report.transport?.blockedRequests!==0)throw new Error('Fixture journey transport boundary missing or violated');
await mkdir('.verification',{recursive:true});
await writeFile('.verification/britelink-configured-image.json',JSON.stringify({schema:1,revision:process.env.RELEASE_SHA,buildMode:'qa-configured',configuredSavedImageVerified:true,realIsolatedSupabase:true,syntheticHouseholds:true,authenticatedJourneySteps:report.steps.length,steps:report.steps.map(({name,ok,ms})=>({name,ok,ms})),transport:report.transport,productionImageEligible:false,productionTouched:false,externalEmailSent:false},null,2));
console.log(`Imported configured image: ${report.steps.length} authenticated browser journey steps passed against real isolated Supabase`);
JS
