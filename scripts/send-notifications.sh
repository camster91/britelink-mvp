#!/usr/bin/env bash
# Email notices for new plans, messages and revision answers (migration 058, issue #99). Run on the
# VPS by .github/workflows/notifications.yml, which stays OFF until counsel approves the wording and
# the owner sets the NOTIFICATIONS_ENABLED repository variable to "true".
#
#   1. Claims up to $MAX_ITEMS waiting notices with public.notification_claim(), which also skips
#      anyone who turned emails off and anything older than two days.
#   2. Sends each as a short plain-text email through the SMTP account GoTrue already uses
#      (Mailgun), read from the auth container's environment. No new secret is stored anywhere.
#   3. Reports each result with public.notification_finish(); a failed send is retried on a later
#      run, at most three attempts in all.
#
# The emails never contain a child's name, plan content or message text: only that something new is
# waiting, and a link. Addresses and the SMTP password are never printed.
set -euo pipefail
DB_CONTAINER="${DB_CONTAINER:-britelink-production-db-1}"
AUTH_CONTAINER="${AUTH_CONTAINER:-britelink-production-auth-1}"
SITE_URL="${SITE_URL:-https://britelink.ashbi.ca}"
MAX_ITEMS="${MAX_ITEMS:-50}"

fail() { echo "FAIL: $1" >&2; exit 1; }
[[ "$MAX_ITEMS" =~ ^[0-9]+$ ]] && [ "$MAX_ITEMS" -ge 1 ] && [ "$MAX_ITEMS" -le 500 ] || fail "MAX_ITEMS must be 1-500"
psql_do() { docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -tA -q -U postgres -d postgres "$@"; }
auth_env() { docker inspect "$AUTH_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$1=//p" | head -n 1; }

smtp_host="$(auth_env GOTRUE_SMTP_HOST)"
smtp_port="$(auth_env GOTRUE_SMTP_PORT)"; smtp_port="${smtp_port:-587}"
smtp_user="$(auth_env GOTRUE_SMTP_USER)"
smtp_pass="$(auth_env GOTRUE_SMTP_PASS)"
from_address="$(auth_env GOTRUE_SMTP_ADMIN_EMAIL)"
from_name="$(auth_env GOTRUE_SMTP_SENDER_NAME)"; from_name="${from_name:-BriteLink}"
[ -n "$smtp_host" ] && [ -n "$smtp_user" ] && [ -n "$smtp_pass" ] && [ -n "$from_address" ] || fail "the auth container has no SMTP settings"
[[ "$smtp_host" =~ ^[A-Za-z0-9.-]+$ ]] && [[ "$smtp_port" =~ ^[0-9]+$ ]] || fail "SMTP host or port is malformed"

work="$(mktemp -d)"; chmod 700 "$work"
trap 'rm -rf "$work"' EXIT
# The password goes to curl through a 0600 netrc file, never on the command line.
umask 077
printf 'machine %s\nlogin %s\npassword %s\n' "$smtp_host" "$smtp_user" "$smtp_pass" > "$work/netrc"

subject_for() {
  case "$1" in
    plan_delivered) echo "Your BriteLink plan is ready" ;;
    message_to_guardian) echo "You have a new message in BriteLink" ;;
    message_to_staff) echo "A family sent a message in BriteLink" ;;
    revision_decided) echo "An update on your plan change request" ;;
    *) return 1 ;;
  esac
}
line_for() {
  case "$1" in
    plan_delivered) echo "A new learning plan has been delivered to your family." ;;
    message_to_guardian) echo "Your educator sent you a message." ;;
    message_to_staff) echo "A family sent a message on one of your cases. Please sign in to read and reply." ;;
    revision_decided) echo "There is an update on the plan change you asked for." ;;
  esac
}

sent=0; failed=0
claims="$(psql_do -F $'\t' -c "select notice_id, notice_kind, recipient_email from public.notification_claim(${MAX_ITEMS})")"
while IFS=$'\t' read -r notice kind to; do
  [ -n "${notice:-}" ] || continue
  [[ "$notice" =~ ^[0-9]+$ ]] || continue
  subject="$(subject_for "$kind")" || { psql_do -c "select public.notification_finish(${notice}, false, 'unknown notice kind')" >/dev/null; failed=$((failed + 1)); continue; }
  # One plain address only: anything else could smuggle extra mail headers.
  if ! [[ "$to" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    psql_do -c "select public.notification_finish(${notice}, false, 'recipient address is not usable')" >/dev/null
    failed=$((failed + 1)); continue
  fi
  {
    printf 'From: %s <%s>\r\n' "$from_name" "$from_address"
    printf 'To: <%s>\r\n' "$to"
    printf 'Subject: %s\r\n' "$subject"
    printf 'Date: %s\r\n' "$(LC_ALL=C date -R)"
    printf 'Message-ID: <britelink-notice-%s-%s@%s>\r\n' "$notice" "$(date +%s)" "${from_address#*@}"
    printf 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nAuto-Submitted: auto-generated\r\n\r\n'
    printf 'Hello,\r\n\r\n%s\r\n\r\nSign in to see it: %s\r\n\r\n' "$(line_for "$kind")" "$SITE_URL"
    printf 'For privacy, this email never includes details about your child. Please reply inside BriteLink, not to this email.\r\n\r\n'
    printf 'You can turn these emails off in BriteLink: switch off "Email me about updates".\r\n'
  } > "$work/message.eml"
  if curl --silent --show-error --max-time 30 --ssl-reqd --url "smtp://${smtp_host}:${smtp_port}" \
       --netrc-file "$work/netrc" --mail-from "$from_address" --mail-rcpt "$to" \
       --upload-file "$work/message.eml" >/dev/null 2>"$work/curl.err"; then
    psql_do -c "select public.notification_finish(${notice}, true)" >/dev/null
    sent=$((sent + 1))
  else
    reason="$(head -c 200 "$work/curl.err" | tr -d "'\\\\\r\n" )"
    psql_do -c "select public.notification_finish(${notice}, false, 'smtp: ${reason:-send failed}')" >/dev/null
    failed=$((failed + 1))
  fi
done <<< "$claims"

echo "notices sent: ${sent}, failed: ${failed}"
# Alert (a failed run emails the repository owner) only when nothing at all could be sent.
if [ "$failed" -gt 0 ] && [ "$sent" -eq 0 ]; then exit 1; fi
