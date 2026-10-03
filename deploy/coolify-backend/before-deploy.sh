#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ ${1:-} =~ ^[a-z0-9]{20,40}$ ]] || { echo 'Invalid Coolify resource identity' >&2; exit 2; }
install -d -m 700 /run/ashbi-docker-capacity
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
flock -x /run/ashbi-docker-capacity/maintenance.lock python3 "$here/backup.py" "$1"
