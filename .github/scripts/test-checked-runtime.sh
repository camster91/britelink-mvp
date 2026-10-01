#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RELEASE_SHA:-} =~ ^[a-f0-9]{40}$ ]]
image="britelink-checked-runtime:$RELEASE_SHA"
container="britelink-checked-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$container" -p 127.0.0.1::80 "$image" >/dev/null
port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}' "$container")
export BRITELINK_CHECKED_RUNTIME_URL="http://127.0.0.1:$port"
export BRITELINK_CHECKED_RUNTIME_MODE=unconfigured-demo
for attempt in $(seq 1 60); do
  if curl -fsS "$BRITELINK_CHECKED_RUNTIME_URL/version.json" >/dev/null; then break; fi
  [[ $attempt != 60 ]] || exit 1
  sleep 1
done
node .github/scripts/test-checked-runtime.mjs
docker restart "$container" >/dev/null
port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}' "$container")
export BRITELINK_CHECKED_RUNTIME_URL="http://127.0.0.1:$port"
for attempt in $(seq 1 60); do
  if curl -fsS "$BRITELINK_CHECKED_RUNTIME_URL/version.json" >/dev/null; then break; fi
  [[ $attempt != 60 ]] || exit 1
  sleep 1
done
node --input-type=module -e 'const r=await fetch(process.env.BRITELINK_CHECKED_RUNTIME_URL+"/version.json");const b=await r.json();if(!r.ok||b.commit!==process.env.RELEASE_SHA)process.exit(1)'
echo 'Imported unconfigured demo image restart revision check passed; no production image eligibility is claimed'
