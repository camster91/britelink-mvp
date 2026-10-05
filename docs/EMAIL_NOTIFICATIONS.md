# Email notifications

Short emails tell people something new is waiting in BriteLink (issue #99, migration 058).

| Event | Who gets the email |
| --- | --- |
| A plan is delivered | Every guardian in the household |
| Staff write a message | Every guardian in the household |
| A parent writes a message | The assigned educator, or the household's admins if no one is assigned |
| A revision request is accepted, declined or completed | The guardian who asked |

The person who caused the event never gets an email about it.

## What the email says

A subject line, one sentence such as "Your educator sent you a message.", and a link to the site.
It **never** includes a child's name, plan content or message text. Replies should go through
BriteLink, not email.

## How it works

1. Database triggers put a row in `notification_outbox` for each recipient. The table is sealed:
   no client can read it.
2. The **Notifications** workflow runs every 10 minutes. It runs `scripts/send-notifications.sh`
   on the VPS, which:
   - sends through the Mailgun SMTP account that sign-in emails already use, read from the auth
     container (no new secret);
   - skips people who turned emails off;
   - never sends anything older than two days;
   - retries a failed send up to three times.
3. A run fails, and GitHub emails the owner, only when nothing at all could be sent.

## Turning it on

Sending is **off** until counsel approves the wording. Then:

1. Apply migration 058 with the Migrate workflow (`mode: apply`,
   `db_container: britelink-production-db-1`), after the owner's go.
2. In GitHub, go to Settings → Secrets and variables → Actions → Variables and set
   `NOTIFICATIONS_ENABLED` to `true`.
3. Watch the first Notifications run. It prints only counts, never addresses.

To stop sending, set the variable to anything else. Waiting notices expire after two days.

## People's choice

Everyone has an **Email me about updates** switch, on by default:
- parents find it under Your data;
- staff find it on the workbench.

It is stored in `notification_preferences`, and each person sees and changes only their own.
